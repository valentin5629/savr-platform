// /api/v1/admin/collectes/[id]/logo-client
// Logo du client imprimé sur les rapports (onglet Documents de la fiche collecte,
// §06.06 « Importer le logo du client organisateur », décision Val 2026-10-30).
//   GET    : affiche le logo déposé sur l'événement de la collecte (404 sans logo)
//   POST   : dépose un logo (multipart, champ `file`, JPG/PNG ≤ 2 Mo)
//   DELETE : retire le logo
// Logique commune aux espaces : lib/evenements/logo-client-rapport.ts.

import { NextRequest } from 'next/server';
import { requireStaff } from '@/lib/api-auth.js';
import {
  acteurDepuis,
  deposerLogoClient,
  retirerLogoClient,
  servirLogoClient,
} from '@/lib/evenements/logo-client-rapport.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Le dépôt remet en fabrication les rapports de don de l'événement.
export const maxDuration = 60;

type Contexte = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Contexte) {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;
  return servirLogoClient(
    { collecteId: (await params).id },
    acteurDepuis(auth.ctx, true),
  );
}

export async function POST(req: NextRequest, { params }: Contexte) {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;
  return deposerLogoClient(
    req,
    { collecteId: (await params).id },
    acteurDepuis(auth.ctx, true),
  );
}

export async function DELETE(req: NextRequest, { params }: Contexte) {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;
  return retirerLogoClient(
    { collecteId: (await params).id },
    acteurDepuis(auth.ctx, true),
  );
}
