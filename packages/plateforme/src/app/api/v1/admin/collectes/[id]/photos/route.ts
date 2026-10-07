// POST /api/v1/admin/collectes/[id]/photos
// Import manuel d'une photo de collecte par l'Admin/Ops (§06.06 Bloc 3 « Importer
// des photos » + actions l.279 « Importer des photos (sans passer par le TMS) »).
// Upload R2 → enregistrement dans shared.fichiers (polymorphe collectes) + audit_log.
// Accès : admin_savr + ops_savr (requireStaff). Calqué sur /admin/uploads/logo.
//
// Une photo importée à la main est choisie d'office pour le client (décision Val
// 2026-10-07) tant qu'il reste une des 2 places ; sinon elle est enregistrée non
// choisie, et la réponse le dit (`visible_client: false`).

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { uploadObject } from '@savr/shared/src/r2/upload.js';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';
import { serverError } from '@/lib/api-helpers.js';
import {
  CODE_RANG_DEJA_PRIS,
  ENTITE_PHOTO_COLLECTE,
  rangClientLibre,
  type RangClient,
} from '@/lib/collectes/photos-client.js';

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

  const ext =
    file.type === 'image/png'
      ? 'png'
      : file.type === 'image/webp'
        ? 'webp'
        : 'jpg';
  const key = `photos/collectes/${id}/${randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  // Bucket = celui de l'environnement, rendu par l'upload (aucun repli : sans
  // R2_BUCKET_NAME l'upload lève, comme sans identifiants).
  let bucket: string;
  try {
    ({ bucket } = await uploadObject(key, buffer, file.type));
  } catch {
    return NextResponse.json(
      { error: 'Upload indisponible (stockage non configuré)' },
      { status: 503 },
    );
  }

  // Référencer le fichier dans shared.fichiers (source de vérité — colonnes réelles :
  // storage_provider/bucket/key/content_type/size_bytes/entity_type/entity_id).
  const enregistrer = (rang: RangClient | null) =>
    supabase
      .schema('shared')
      .from('fichiers')
      .insert({
        storage_provider: 'r2',
        bucket,
        key,
        content_type: file.type,
        size_bytes: buffer.length,
        entity_type: ENTITE_PHOTO_COLLECTE,
        entity_id: id,
        created_by: auth.ctx.userId,
        rang_client: rang,
      })
      .select('id, content_type, created_at, rang_client')
      .single();

  let rang: RangClient | null;
  try {
    rang = await rangClientLibre(supabase, id);
  } catch (e) {
    return serverError(e, 'admin.collectes.photos.rang');
  }
  let { data: fichier, error: insErr } = await enregistrer(rang);
  // Une autre sélection a pris la place entre la lecture et l'écriture : la
  // photo est quand même enregistrée, non choisie.
  if (insErr?.code === CODE_RANG_DEJA_PRIS && rang !== null) {
    ({ data: fichier, error: insErr } = await enregistrer(null));
  }

  if (insErr || !fichier) {
    return serverError(
      insErr ?? new Error('insert shared.fichiers sans ligne'),
      'admin.collectes.photos.create',
    );
  }
  const visibleClient =
    (fichier as { rang_client: number | null }).rang_client !== null;

  // Audit (photo importée hors TMS).
  await supabase.from('audit_log').insert({
    table_name: 'collectes',
    record_id: id,
    action: 'photo_importee',
    user_id: auth.ctx.userId,
    role: auth.ctx.role ?? null,
    new_values: {
      fichier_id: (fichier as { id: string }).id,
      key,
      visible_client: visibleClient,
    },
  });

  const {
    id: fichierId,
    content_type,
    created_at,
  } = fichier as {
    id: string;
    content_type: string;
    created_at: string;
  };
  return NextResponse.json(
    {
      fichier: {
        id: fichierId,
        content_type,
        created_at,
        visible_client: visibleClient,
      },
    },
    { status: 201 },
  );
}
