// POST /api/v1/traiteur/collectes/[id]/documents/[type]/regenerate
// Régénération du rapport de recyclage d'une collecte ZD depuis la fiche collecte
// du traiteur (§12 §1.2 : tout utilisateur qui peut télécharger le rapport).
// Le corps choisit la version du rapport : avec ou sans le radar de comparaison
// au parc. Logique et gardes communes aux 3 espaces clients dans
// `repondreRegenerationRapport` (lib/collectes/rapport-regeneration.ts).

import { NextRequest, NextResponse } from 'next/server';

import { requireUser, type ClientRole } from '@/lib/api-auth.js';
import { repondreRegenerationRapport } from '@/lib/collectes/rapport-regeneration.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TRAITEUR_ROLES: ClientRole[] = [
  'traiteur_manager',
  'traiteur_commercial',
];

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; type: string }> },
): Promise<NextResponse> {
  const auth = await requireUser(req, TRAITEUR_ROLES);
  if (auth.error) return auth.error;
  const { id, type } = await params;
  return repondreRegenerationRapport(
    req,
    id,
    type,
    auth.ctx,
    'traiteur.collectes.rapport.regeneration',
  );
}
