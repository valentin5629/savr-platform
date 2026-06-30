import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth.js';
import { evaluerAutoAcceptAg } from '@/lib/attribution-ag/auto-accept.js';

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
    return NextResponse.json({ data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur auto-accept';
    if (msg.includes('P0030') || msg.includes('introuvable')) {
      return NextResponse.json(
        { error: 'Collecte AG introuvable' },
        { status: 404 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
