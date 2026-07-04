// POST /api/v1/admin/collectes/[id]/photos
// Import manuel d'une photo de collecte par l'Admin/Ops (§06.06 Bloc 3 « Importer
// des photos » + actions l.279 « Importer des photos (sans passer par le TMS) »).
// Upload R2 → enregistrement dans shared.fichiers (polymorphe collectes) + audit_log.
// Accès : admin_savr + ops_savr (requireStaff). Calqué sur /admin/uploads/logo.

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { uploadObject } from '@savr/shared/src/r2/upload.js';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TYPES_AUTORISES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const TAILLE_MAX = 5 * 1024 * 1024; // 5 Mo

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const { id } = await params;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: 'Requête multipart invalide' },
      { status: 400 },
    );
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: 'Champ "file" manquant' },
      { status: 422 },
    );
  }
  if (!TYPES_AUTORISES.has(file.type)) {
    return NextResponse.json(
      { error: 'Format non supporté (JPG, PNG ou WEBP uniquement)' },
      { status: 422 },
    );
  }
  if (file.size > TAILLE_MAX) {
    return NextResponse.json(
      { error: 'Fichier trop volumineux (5 Mo maximum)' },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();

  // Garde d'existence : refuse l'import sur une collecte inconnue (évite un fichier
  // orphelin dans shared.fichiers).
  const { data: collecte } = await supabase
    .from('collectes')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (!collecte) {
    return NextResponse.json(
      { error: 'Collecte introuvable' },
      { status: 404 },
    );
  }

  const bucket = process.env['R2_BUCKET_NAME'] || 'savr-dev';
  const ext =
    file.type === 'image/png'
      ? 'png'
      : file.type === 'image/webp'
        ? 'webp'
        : 'jpg';
  const key = `photos/collectes/${id}/${randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    await uploadObject(bucket, key, buffer, file.type);
  } catch {
    return NextResponse.json(
      { error: 'Upload indisponible (stockage non configuré)' },
      { status: 503 },
    );
  }

  // Référencer le fichier dans shared.fichiers (source de vérité — colonnes réelles :
  // storage_provider/bucket/key/content_type/size_bytes/entity_type/entity_id).
  const { data: fichier, error: insErr } = await supabase
    .schema('shared')
    .from('fichiers')
    .insert({
      storage_provider: 'r2',
      bucket,
      key,
      content_type: file.type,
      size_bytes: buffer.length,
      entity_type: 'plateforme.collectes',
      entity_id: id,
      created_by: auth.ctx.userId,
    })
    .select('id, content_type, created_at')
    .single();

  if (insErr || !fichier) {
    return NextResponse.json(
      { error: insErr?.message ?? 'Échec de l’enregistrement du fichier' },
      { status: 500 },
    );
  }

  // Audit (photo importée hors TMS).
  await supabase.from('audit_log').insert({
    table_name: 'collectes',
    record_id: id,
    action: 'photo_importee',
    user_id: auth.ctx.userId,
    role: auth.ctx.role ?? null,
    new_values: { fichier_id: (fichier as { id: string }).id, key },
  });

  return NextResponse.json({ fichier }, { status: 201 });
}
