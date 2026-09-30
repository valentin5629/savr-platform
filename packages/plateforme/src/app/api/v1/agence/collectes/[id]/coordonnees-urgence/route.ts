import { NextRequest, NextResponse } from 'next/server';
import { requireUser, type ClientRole } from '@/lib/api-auth.js';
import { repondreDemandeCoordonneesUrgence } from '@/lib/collectes/coordonnees-urgence.js';

// POST — « Demander les coordonnées en urgence » (§06.04 fiche collecte,
// décision Val 2026-09-29) : alerte in-app Ops seule, 1 par collecte. Aucun
// corps de requête lu (pas de texte libre). Logique commune aux 3 espaces.
const AGENCE_ROLES: ClientRole[] = ['agence'];

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUser(req, AGENCE_ROLES);
  if (auth.error) return auth.error;
  const { id } = await params;
  return repondreDemandeCoordonneesUrgence(
    id,
    'agence.collectes.coordonnees_urgence',
  );
}
