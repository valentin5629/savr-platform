import { NextRequest, NextResponse } from 'next/server';
import { requireAnyUser, type UserAuthContext } from '@/lib/api-auth.js';
import { espaceEvenementsDuRole } from '@/lib/evenements/liste-evenements.js';
import { repondreRapportEvenement } from '@/lib/evenements/reponses-cumul.js';

// POST /api/v1/evenements/[id]/rapport-de-don
// Rapport de don cumulé des collectes Anti-Gaspi réalisées de l'événement,
// sans radar, fabriqué au clic ; réponse = le PDF (décisions Val 2026-10-26 et
// 2026-10-29 : pour tous les rôles qui ont la fiche, SAUF le client
// organisateur, à qui aa_select refuse les attributions : le rapport serait
// faux). Logique et gardes : `repondreRapportEvenement`, sous sa session.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Le rendu Puppeteer prend quelques secondes (délai du client de rendu : 30 s).
export const maxDuration = 60;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireAnyUser(req);
  if (auth.error) return auth.error;
  const espace = espaceEvenementsDuRole(auth.ctx.role);
  if (!espace || espace === 'organisateur')
    return NextResponse.json({ error: 'Rôle insuffisant' }, { status: 403 });
  const { id } = await params;
  return repondreRapportEvenement(
    req,
    id,
    auth.ctx as UserAuthContext,
    'anti_gaspi',
    'evenements.rapport_de_don',
  );
}
