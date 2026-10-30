import { NextRequest, NextResponse } from 'next/server';
import { requireAnyUser, type UserAuthContext } from '@/lib/api-auth.js';
import { espaceEvenementsDuRole } from '@/lib/evenements/liste-evenements.js';
import { repondreBenchmarkEvenement } from '@/lib/evenements/reponses-cumul.js';

// GET /api/v1/evenements/[id]/benchmark
// Radar du bilan consolidé ZD de la fiche événement (décision Val 2026-10-26) :
// kg par convive de l'événement face au repère parc des filtres réglés.
// Pour tous les rôles qui ont la fiche, client organisateur compris (décision
// Val 2026-10-30 : même fiche pour tous, radar compris). Logique et gardes :
// `repondreBenchmarkEvenement`, sous la session de l'appelant.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireAnyUser(req);
  if (auth.error) return auth.error;
  if (!espaceEvenementsDuRole(auth.ctx.role))
    return NextResponse.json({ error: 'Rôle insuffisant' }, { status: 403 });
  const { id } = await params;
  return repondreBenchmarkEvenement(
    req,
    id,
    // Le staff n'a pas d'organisation : le repère parc ne lit que le rôle.
    auth.ctx as UserAuthContext,
    'evenements.benchmark',
  );
}
