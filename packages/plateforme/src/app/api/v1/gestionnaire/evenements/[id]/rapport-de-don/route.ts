// POST /api/v1/gestionnaire/evenements/[id]/rapport-de-don
// Rapport de don cumulé des collectes Anti-Gaspi réalisées de l'événement :
// récapitulatif sans valeur fiscale
// (décision Val 2026-10-26), fabriqué au clic, réponse = le PDF. Logique et
// gardes communes : `repondreRapportEvenement` (lib/evenements/reponses-cumul.ts).

import { NextRequest, NextResponse } from 'next/server';

import { requireUser, type ClientRole } from '@/lib/api-auth.js';
import { repondreRapportEvenement } from '@/lib/evenements/reponses-cumul.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Le rendu Puppeteer prend quelques secondes (délai du client de rendu : 30 s).
export const maxDuration = 60;

const ROLES: ClientRole[] = ['gestionnaire_lieux'];

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;
  const { id } = await params;
  return repondreRapportEvenement(
    req,
    id,
    auth.ctx,
    'anti_gaspi',
    'gestionnaire.evenements.rapport_de_don',
  );
}
