// GET /api/v1/traiteur/collectes/:id/rapport-rse/download
// Rapport de recyclage ZD (RSE) téléchargeable depuis la fiche collecte traiteur
// (CDC §06.04 l.403 « Télécharger le rapport RSE — si rapport disponible >= H+24 »).
// Miroir de la route admin (rapports-rse/[id]/download) mais keyée par COLLECTE et
// RLS-scopée : on confirme d'abord la visibilité de la collecte (cloisonnement org
// via le client RLS), puis on lit le rapport et on renvoie une URL pré-signée R2.
// BL-P1-TRAIT-03.
//
// Collecte AG (BL-P2-18 (3), arbitrage Val 2026-07-07 option a) : le « rapport RSE »
// d'une collecte anti_gaspi EST l'attestation de don standalone (§1.3). Le §1.2 « page 3
// attestation » / « page 1 Synthèse RSE AG » sont des fantômes non applicables au grain
// collecte AG (cf. _Divergences). On sert donc ici l'attestation pour une collecte AG.
//
// Exception AG realisee_sans_collecte (BL-P1-RPT-02, R21b) : pas d'attestation (pas de
// don) → on sert le rapport « Événement sans excédent alimentaire » (§1.3-bis), porté
// par une ligne rapports_rse standard SANS embargo H+24 (disponible_a = genere_at).

import { NextRequest, NextResponse } from 'next/server';
import { requireUser, type ClientRole } from '@/lib/api-auth.js';
import { repondreTelechargementRapport } from '@/lib/collectes/rapport-download.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TRAITEUR_ROLES: ClientRole[] = [
  'traiteur_manager',
  'traiteur_commercial',
];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUser(req, TRAITEUR_ROLES);
  if (auth.error) return auth.error;
  const { id } = await params;
  // Logique commune aux 3 espaces clients (lib/collectes/rapport-download.ts) :
  // contrôle RLS de la collecte puis lecture des documents sous la même RLS.
  return repondreTelechargementRapport(id);
}
