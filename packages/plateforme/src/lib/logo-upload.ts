import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { uploadObject } from '@savr/shared/src/r2/upload.js';

// Upload d'un logo vers R2, partagé par les routes admin, traiteur et
// gestionnaire (chacune garde sa garde de rôle). Contraintes CDC : JPG/PNG,
// ≤ 2 Mo. Retourne { logo_url: "bucket/logos/<uuid>.<ext>" } à écrire dans
// `logo_url`. Ce fichier est le seul à connaître le format de la clé.

const TYPES_AUTORISES = new Set(['image/png', 'image/jpeg']);
const TAILLE_MAX = 2 * 1024 * 1024; // 2 Mo
const CLE_LOGO = /^logos\/[0-9a-f-]{36}\.(png|jpg)$/;

function bucketLogos(): string {
  return process.env['R2_BUCKET_NAME'] || 'savr-dev';
}

/** Vrai si `v` est une clé produite par uploadLogo dans le bucket courant. */
export function estCleLogo(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  const prefixe = `${bucketLogos()}/`;
  return v.startsWith(prefixe) && CLE_LOGO.test(v.slice(prefixe.length));
}

export async function uploadLogo(req: NextRequest): Promise<NextResponse> {
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
  if (!(file instanceof File))
    return NextResponse.json(
      { error: 'Champ "file" manquant' },
      { status: 422 },
    );
  if (!TYPES_AUTORISES.has(file.type))
    return NextResponse.json(
      { error: 'Format non supporté (JPG ou PNG uniquement)' },
      { status: 422 },
    );
  if (file.size > TAILLE_MAX)
    return NextResponse.json(
      { error: 'Fichier trop volumineux (2 Mo maximum)' },
      { status: 422 },
    );

  const ext = file.type === 'image/png' ? 'png' : 'jpg';
  const key = `logos/${randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const storageKey = await uploadObject(
      bucketLogos(),
      key,
      buffer,
      file.type,
    );
    return NextResponse.json({ logo_url: storageKey }, { status: 201 });
  } catch {
    // R2 indisponible (ex. env local sans credentials) — non bloquant côté form.
    return NextResponse.json(
      { error: 'Upload indisponible (stockage non configuré)' },
      { status: 503 },
    );
  }
}
