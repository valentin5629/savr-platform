import { NextRequest, NextResponse } from 'next/server';
import { getObject } from '@savr/shared/src/r2/upload.js';
import { requireStaff } from '@/lib/api-auth.js';
import { uploadLogo } from '@/lib/logo-upload.js';

// POST /api/v1/admin/uploads/logo — upload d'un logo (association / organisation)
// vers R2. Réservé staff (admin/ops). Retourne la clé de stockage canonique
// "bucket/key" à stocker dans `logo_url`. Fail-open côté form : le logo est
// optionnel (Val 2026-07-02), un échec upload ne bloque pas la création de fiche.
//
// GET /api/v1/admin/uploads/logo?key=<bucket/key> — proxy d'affichage : streame
// l'image depuis R2 (pas d'URL publique R2 requise). Réservé staff (cookie de
// session sur la requête <img>). Clé restreinte au préfixe "logos/".
//
// Contraintes CDC : JPG/PNG, ≤ 2 Mo (lib/logo-upload.ts).

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const storageKey = new URL(req.url).searchParams.get('key') ?? '';
  // storageKey = "bucket/logos/<uuid>.<ext>" (retour d'uploadObject).
  const slash = storageKey.indexOf('/');
  if (slash < 1) {
    return NextResponse.json({ error: 'Clé invalide' }, { status: 422 });
  }
  const bucket = storageKey.slice(0, slash);
  const key = storageKey.slice(slash + 1);
  // Garde anti-traversée : on ne sert que des logos.
  if (!key.startsWith('logos/')) {
    return NextResponse.json({ error: 'Clé non autorisée' }, { status: 403 });
  }

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
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;
  return uploadLogo(req);
}
