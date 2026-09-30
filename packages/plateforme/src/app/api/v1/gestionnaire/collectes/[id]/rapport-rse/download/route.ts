import { NextRequest, NextResponse } from 'next/server';
import { requireUser, type ClientRole } from '@/lib/api-auth.js';
import { repondreTelechargementRapport } from '@/lib/collectes/rapport-download.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET — rapport de la collecte depuis la fiche (Rapport RSE ZD, Rapport de don
// AG, rapport « Événement sans excédent »), embargo H+24 côté serveur.
// Gestionnaire : documents lus sous SA RLS (rr_select / att_gestionnaire_select),
// jamais en service-role.
const GESTIONNAIRE_ROLES: ClientRole[] = ['gestionnaire_lieux'];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUser(req, GESTIONNAIRE_ROLES);
  if (auth.error) return auth.error;
  const { id } = await params;
  return repondreTelechargementRapport(id, 'rls');
}
