import { NextRequest, NextResponse } from 'next/server';
import { requireAnyUser, type UserAuthContext } from '@/lib/api-auth.js';
import { espaceFicheDuRole } from '@/lib/evenements/espace-fiche.js';
import { repondreRapportEvenement } from '@/lib/evenements/reponses-cumul.js';

// POST /api/v1/evenements/[id]/rapport-rse
// Rapport de recyclage cumulé des collectes Zéro Déchet réalisées de l'événement, radar au choix du gestionnaire seul (décisions Val 2026-10-26 et 2026-10-29 : pour tous les rôles qui ont
// la fiche), fabriqué au clic, réponse = le PDF. Logique et gardes communes :
// `repondreRapportEvenement` (lib/evenements/reponses-cumul.ts), sous la
// session de l'appelant.

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
  const espace = espaceFicheDuRole(auth.ctx.role);
  if (!espace)
    return NextResponse.json({ error: 'Rôle insuffisant' }, { status: 403 });
  const { id } = await params;
  return repondreRapportEvenement(
    req,
    id,
    // Le staff n'a pas d'organisation : seul le radar (gestionnaire) la lit.
    auth.ctx as UserAuthContext,
    'zero_dechet',
    'evenements.rapport_rse',
    espace === 'gestionnaire',
  );
}
