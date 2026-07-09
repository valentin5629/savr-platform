import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';
import { withApiTrace } from '@/lib/api-helpers.js';
import { calculerAlgoAttributionAg } from '@/lib/attribution-ag/algo.js';
import { emettreAlertesAttributionSansOption } from '@/lib/attribution-ag/notif-alerte.js';

// GET /api/v1/admin/attributions-ag/[collecteId]/recommandation
// Lance le moteur algo et retourne les suggestions associations + branche transporteur
async function getHandler(
  req: NextRequest,
  { params }: { params: Promise<{ collecteId: string }> },
): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const { collecteId } = await params;

  try {
    const result = await calculerAlgoAttributionAg(collecteId);

    // BL-P2-30 (R22e) — Alerte Admin in-app quand l'algo n'a aucune option :
    // aucune association éligible (§05 l.61) ou aucun transporteur éligible /
    // branche aucun_prestataire (§05 l.83). Best-effort, idempotent — jamais
    // bloquant pour l'affichage de la recommandation.
    if (result.no_asso || result.no_prestataire) {
      await emettreAlertesAttributionSansOption(
        createAdminSupabaseClient(),
        collecteId,
        result,
      ).catch(() => undefined);
    }

    return NextResponse.json({ data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur algorithme';
    if (msg.includes('P0030') || msg.includes('introuvable')) {
      return NextResponse.json(
        { error: 'Collecte AG introuvable' },
        { status: 404 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const GET = withApiTrace(getHandler);
