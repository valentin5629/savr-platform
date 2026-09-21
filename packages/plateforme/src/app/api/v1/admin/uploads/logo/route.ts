import { NextRequest, NextResponse } from 'next/server';
import { parseCleLogo } from '@/lib/logo-key.js';
import { servirLogo } from '@/lib/logo-proxy.js';
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
  // Bucket applicatif + logos/<uuid>.(png|jpg) seulement (lib/logo-key.ts) : le
  // paramètre vient du client, jamais un autre objet R2 ni un autre bucket.
  const cle = parseCleLogo(storageKey);
  if (!cle) {
    return NextResponse.json({ error: 'Clé non autorisée' }, { status: 403 });
  }

  return servirLogo(cle);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;
  return uploadLogo(req);
}
