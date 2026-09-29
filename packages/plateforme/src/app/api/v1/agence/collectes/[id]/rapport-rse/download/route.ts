import { NextRequest, NextResponse } from 'next/server';
import { requireUser, type ClientRole } from '@/lib/api-auth.js';
import { repondreTelechargementRapport } from '@/lib/collectes/rapport-download.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET — rapport de la collecte depuis la fiche (Rapport RSE ZD, Rapport de don
// AG, rapport « Événement sans excédent »), embargo H+24 côté serveur.
// Agence : documents lus sous SA RLS (rr_select / att_traiteur_select), jamais
// en service-role — revue sécurité 2026-09-29 (§06.11 : fiche identique au §06.04).
const AGENCE_ROLES: ClientRole[] = ['agence'];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUser(req, AGENCE_ROLES);
  if (auth.error) return auth.error;
  const { id } = await params;
  return repondreTelechargementRapport(id, 'rls');
}
