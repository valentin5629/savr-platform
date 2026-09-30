import { NextRequest, NextResponse } from 'next/server';
import { requireUser, type ClientRole } from '@/lib/api-auth.js';
import { repondreBenchmarkFiche } from '@/lib/collectes/benchmark-fiche.js';

// Radar ZD de la fiche collecte (§06.04, grain single_collecte) — logique et
// gardes communes aux 3 espaces clients dans `repondreBenchmarkFiche`.
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
  return repondreBenchmarkFiche(
    req,
    id,
    auth.ctx,
    'traiteur.collectes.benchmark',
  );
}
