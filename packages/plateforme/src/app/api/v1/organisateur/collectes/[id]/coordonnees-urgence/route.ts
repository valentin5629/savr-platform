import { NextRequest, NextResponse } from 'next/server';
import { requireUser, type ClientRole } from '@/lib/api-auth.js';
import { repondreDemandeCoordonneesUrgence } from '@/lib/collectes/coordonnees-urgence.js';

// POST — « Demander les coordonnées en urgence » depuis la fiche événement du
// client organisateur (décision Val 2026-11-12 : chauffeur et demande urgente
// pour tous les utilisateurs). Même logique que les 3 autres espaces : la
// collecte est lue sous la RLS de l'utilisateur avant toute écriture, alerte
// in-app Ops seule, 1 par collecte, aucun corps de requête lu.
const ORGANISATEUR_ROLES: ClientRole[] = ['client_organisateur'];

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUser(req, ORGANISATEUR_ROLES);
  if (auth.error) return auth.error;
  const { id } = await params;
  return repondreDemandeCoordonneesUrgence(
    id,
    'organisateur.collectes.coordonnees_urgence',
  );
}
