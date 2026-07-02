import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { uploadObject } from '@savr/shared/src/r2/upload.js';
import { requireStaff } from '@/lib/api-auth.js';

// POST /api/v1/admin/uploads/logo — upload d'un logo (association / organisation)
// vers R2. Réservé staff (admin/ops). Retourne la clé de stockage canonique
// "bucket/key" à stocker dans `logo_url`. Fail-open côté form : le logo est
// optionnel (Val 2026-07-02), un échec upload ne bloque pas la création de fiche.
//
// Contraintes CDC : JPG/PNG, ≤ 2 Mo.

const TYPES_AUTORISES = new Set(['image/png', 'image/jpeg']);
const TAILLE_MAX = 2 * 1024 * 1024; // 2 Mo

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

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
      { error: 'Format non supporté (JPG ou PNG uniquement)' },
      { status: 422 },
    );
  }
  if (file.size > TAILLE_MAX) {
    return NextResponse.json(
      { error: 'Fichier trop volumineux (2 Mo maximum)' },
      { status: 422 },
    );
  }

  const bucket = process.env['R2_BUCKET_NAME'] || 'savr-dev';
  const ext = file.type === 'image/png' ? 'png' : 'jpg';
  const key = `logos/${randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const storageKey = await uploadObject(bucket, key, buffer, file.type);
    return NextResponse.json({ logo_url: storageKey }, { status: 201 });
  } catch {
    // R2 indisponible (ex. env local sans credentials) — non bloquant côté form.
    return NextResponse.json(
      { error: 'Upload indisponible (stockage non configuré)' },
      { status: 503 },
    );
  }
}
