import { NextRequest, NextResponse } from 'next/server';
import { requireUser, type ClientRole } from '@/lib/api-auth.js';
import { repondreBenchmarkEvenement } from '@/lib/evenements/reponses-cumul.js';

// GET /api/v1/evenements/[id]/benchmark
// Radar du bilan consolidé ZD de la fiche événement (décision Val 2026-10-26) :
// kg par convive de l'événement face au repère parc des filtres réglés.
// Réservé au gestionnaire (la fiche est commune depuis le 2026-10-29, le
// benchmark comparatif non). Logique et gardes : `repondreBenchmarkEvenement`.
const ROLES: ClientRole[] = ['gestionnaire_lieux'];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;
  const { id } = await params;
  return repondreBenchmarkEvenement(req, id, auth.ctx, 'evenements.benchmark');
}
