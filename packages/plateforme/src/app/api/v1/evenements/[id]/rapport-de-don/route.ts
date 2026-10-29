import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/api-auth.js';
import { ROLES_FICHE_EVENEMENT } from '@/lib/evenements/espace-fiche.js';
import { repondreRapportEvenement } from '@/lib/evenements/reponses-cumul.js';

// POST /api/v1/evenements/[id]/rapport-de-don
// Rapport de don cumulé des collectes Anti-Gaspi réalisées de l'événement, sans radar (décisions Val 2026-10-26 et 2026-10-29 : pour tous les rôles qui ont
// la fiche), fabriqué au clic, réponse = le PDF. Logique et gardes communes :
// `repondreRapportEvenement` (lib/evenements/reponses-cumul.ts).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Le rendu Puppeteer prend quelques secondes (délai du client de rendu : 30 s).
export const maxDuration = 60;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES_FICHE_EVENEMENT);
  if (auth.error) return auth.error;
  const { id } = await params;
  return repondreRapportEvenement(
    req,
    id,
    auth.ctx,
    'anti_gaspi',
    'evenements.rapport_de_don',
    auth.ctx.role === 'gestionnaire_lieux',
  );
}
