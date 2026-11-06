import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth.js';
import { evaluerAutoAcceptAg } from '@/lib/attribution-ag/auto-accept.js';
import { serverError } from '@/lib/api-helpers.js';
import { envoyerOrdresSansAttendre } from '@/lib/envoi-immediat.js';

// Envoi immédiat après la réponse : limite exigée de toute route qui le
// déclenche (cf. lib/envoi-immediat.ts).
export const maxDuration = 60;

// POST /api/v1/admin/attributions-ag/[collecteId]/auto-accept
// BL-P1-ALGO-06 — Déclenche l'évaluation auto-accept (CDC §06.09 §6) pour une
// collecte AG. Si une config_auto_accept_ag active correspond au top 1 + seuils
// pax, l'attribution est validée automatiquement (mode auto_accept, valide_par
// NULL). Sinon (branche SINON), la collecte reste en file de validation manuelle.
// Écriture d'attribution = admin only (§09 l.391 : override AG admin only).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ collecteId: string }> },
): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  const { collecteId } = await params;

  try {
    const result = await evaluerAutoAcceptAg(collecteId);
    // Attribution validée automatiquement : l'ordre est en file, il part sans
    // attendre le passage planifié (décision Val 2026-10-12).
    if (result.auto_accepted) envoyerOrdresSansAttendre(collecteId);
    return NextResponse.json({ data: result });
  } catch (err) {
    // P0030 = `RAISE EXCEPTION … USING ERRCODE = 'P0030'` de la RPC. Le CODE est
    // l'oracle (le message, lui, est neutralisé par `erreurInterne`).
    const code = (err as { code?: string } | null)?.code;
    if (code === 'P0030') {
      return NextResponse.json(
        { error: 'Collecte AG introuvable' },
        { status: 404 },
      );
    }
    return serverError(err, 'admin.attributions_ag.auto_accept');
  }
}
