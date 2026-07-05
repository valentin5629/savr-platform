import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { uploadObject, getObject } from '@savr/shared/src/r2/upload.js';
import { requireUser, type ClientRole } from '@/lib/api-auth.js';

// CDC §06.04 §6 (l.663) — Logo de l'organisation (upload, affiché dans les
// rapports). Upload = MANAGER only ; affichage (proxy) = manager + commercial.
// Le logo est stocké sur R2 ; la clé "bucket/key" retournée est écrite dans
// `organisations.logo_url` via la route profil (PATCH). Contraintes : JPG/PNG ≤ 2 Mo.
// Aligné sur la route admin `admin/uploads/logo` (même R2, même garde-traversée).

const READ_ROLES: ClientRole[] = ['traiteur_manager', 'traiteur_commercial'];
const MANAGER_ROLE: ClientRole[] = ['traiteur_manager'];

const TYPES_AUTORISES = new Set(['image/png', 'image/jpeg']);
const TAILLE_MAX = 2 * 1024 * 1024; // 2 Mo

// GET ?key=<bucket/logos/...> — proxy d'affichage (R2 non public).
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, READ_ROLES);
  if (auth.error) return auth.error;

  const storageKey = new URL(req.url).searchParams.get('key') ?? '';
  const slash = storageKey.indexOf('/');
  if (slash < 1)
    return NextResponse.json({ error: 'Clé invalide' }, { status: 422 });
  const bucket = storageKey.slice(0, slash);
  const key = storageKey.slice(slash + 1);
  // Garde anti-traversée : on ne sert que des logos.
  if (!key.startsWith('logos/'))
    return NextResponse.json({ error: 'Clé non autorisée' }, { status: 403 });

  try {
    const { body, contentType } = await getObject(bucket, key);
    return new NextResponse(Buffer.from(body), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Logo introuvable' }, { status: 404 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, MANAGER_ROLE);
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

  const bucket = process.env['R2_BUCKET_NAME'] || 'savr-dev';
  const ext = file.type === 'image/png' ? 'png' : 'jpg';
  const key = `logos/${randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const storageKey = await uploadObject(bucket, key, buffer, file.type);
    return NextResponse.json({ logo_url: storageKey }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: 'Upload indisponible (stockage non configuré)' },
      { status: 503 },
    );
  }
}
