import { NextRequest, NextResponse } from 'next/server';
import { getObject } from '@savr/shared/src/r2/upload.js';
import { requireUser, type ClientRole } from '@/lib/api-auth.js';
import { uploadLogo } from '@/lib/logo-upload.js';

// CDC §06.04 §6 (l.663) — Logo de l'organisation (upload, affiché dans les
// rapports). Upload = MANAGER only ; affichage (proxy) = manager + commercial.
// Le logo est stocké sur R2 ; la clé "bucket/key" retournée est écrite dans
// `organisations.logo_url` via la route profil (PATCH). Contraintes : JPG/PNG ≤ 2 Mo.
// Aligné sur la route admin `admin/uploads/logo` (même R2, même garde-traversée).

const READ_ROLES: ClientRole[] = ['traiteur_manager', 'traiteur_commercial'];
const MANAGER_ROLE: ClientRole[] = ['traiteur_manager'];

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
  return uploadLogo(req);
}
