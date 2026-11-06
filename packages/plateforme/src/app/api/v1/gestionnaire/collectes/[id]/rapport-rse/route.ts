// POST /api/v1/gestionnaire/collectes/[id]/rapport-rse
// Rapport de recyclage d'une collecte ZD, fabriqué au clic depuis la fiche
// collecte du gestionnaire de lieux (décision Val 2026-10-16) : le corps choisit s'il porte le radar
// de comparaison, la réponse est le PDF. Logique et gardes communes aux espaces
// clients : `repondreRapportClient` (lib/collectes/rapport-a-la-demande.ts).

import { NextRequest, NextResponse } from 'next/server';

import { requireUser, type ClientRole } from '@/lib/api-auth.js';
import { repondreRapportClient } from '@/lib/collectes/rapport-a-la-demande.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Le rendu Puppeteer prend quelques secondes (délai du client de rendu : 30 s).
export const maxDuration = 60;

const GESTIONNAIRE_ROLES: ClientRole[] = ['gestionnaire_lieux'];

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUser(req, GESTIONNAIRE_ROLES);
  if (auth.error) return auth.error;
  const { id } = await params;
  return repondreRapportClient(
    req,
    id,
    auth.ctx,
    'gestionnaire.collectes.rapport.fabrication',
  );
}
