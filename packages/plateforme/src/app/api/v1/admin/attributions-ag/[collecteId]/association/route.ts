import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';
import { withApiTrace, serverError } from '@/lib/api-helpers.js';
import { calculerAlgoAttributionAg } from '@/lib/attribution-ag/algo.js';
import { envoyerOrdresSansAttendre } from '@/lib/envoi-immediat.js';

// Envoi immédiat après la réponse : limite exigée de toute route qui le
// déclenche, la moitié du bail de réservation des ordres. Elle ne borne pas
// seule la durée de vie du passage (cf. lib/envoi-immediat.ts).
export const maxDuration = 60;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Refus métier levés par fn_changer_association_ag : messages écrits par nous.
const REFUS: Record<string, { status: number; error: string }> = {
  P0002: { status: 404, error: 'Collecte introuvable' },
  P0042: {
    status: 422,
    error: 'Changement d’association réservé aux collectes Anti-Gaspi',
  },
  P0043: {
    status: 409,
    error:
      'L’association ne se modifie que sur une collecte programmée ou validée',
  },
  P0045: { status: 422, error: 'Aucune attribution à modifier' },
  P0046: { status: 422, error: 'Association inchangée' },
  P0047: { status: 422, error: 'Association inconnue ou inactive' },
};

// POST /api/v1/admin/attributions-ag/[collecteId]/association
// Change l'association d'une collecte AG déjà attribuée (décisions Val
// 2026-11-13) : collecte programmée ou validée ; association différente du n°1
// de l'algo = admin Savr seul, comme le choix du transporteur (route de
// dispatch). Aucun motif demandé (décision Val 2026-11-13). La fonction SQL renvoie le changement au
// prestataire (MTS-1 : commande annulée puis recréée) et prévient la nouvelle
// association par l'email d'attribution.
async function postHandler(
  req: NextRequest,
  { params }: { params: Promise<{ collecteId: string }> },
): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const { collecteId } = await params;
  if (!UUID_RE.test(collecteId)) {
    return NextResponse.json(
      { error: 'Collecte introuvable' },
      { status: 404 },
    );
  }
  const body = (await req.json().catch(() => null)) as {
    association_id?: unknown;
    envoi_differe?: unknown;
  } | null;
  const associationId = body?.association_id;
  if (typeof associationId !== 'string' || !UUID_RE.test(associationId)) {
    return NextResponse.json(
      { error: 'association_id obligatoire' },
      { status: 422 },
    );
  }
  // N°1 de l'algo calculé côté serveur, jamais fourni par le client. Algo
  // indisponible ou sans association : pas de référence, pas de motif requis
  // (même règle que le choix du transporteur).
  let top1: string | null = null;
  try {
    top1 =
      (await calculerAlgoAttributionAg(collecteId)).associations[0]?.id ?? null;
  } catch {
    top1 = null;
  }
  const override = top1 != null && associationId !== top1;
  if (override && auth.ctx.role === 'ops_savr') {
    return NextResponse.json(
      {
        error:
          'Le choix d’une association différente de la recommandation est réservé aux admin Savr',
      },
      { status: 403 },
    );
  }

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase.rpc('fn_changer_association_ag', {
    p_collecte_id: collecteId,
    p_association_id: associationId,
    p_modifie_par: auth.ctx.userId,
  });
  if (error) {
    const refus = error.code ? REFUS[error.code] : undefined;
    if (refus) {
      return NextResponse.json(
        { error: refus.error },
        { status: refus.status },
      );
    }
    return serverError(error, 'admin.attributions_ag.association');
  }

  // L'ordre éventuel est en file : il part sans attendre le passage planifié
  // (décision Val 2026-10-12). Sauf quand la fiche change aussi le
  // transporteur dans le même geste (décision Val 2026-11-13) : la route de
  // dispatch, appelée juste après, déclenchera l'envoi, une fois le nouveau
  // transporteur posé — sinon la commande pourrait être recréée chez l'ancien.
  if (body?.envoi_differe !== true) {
    envoyerOrdresSansAttendre(collecteId);
  }

  return NextResponse.json({ ok: true, event_type: data as string });
}

export const POST = withApiTrace(postHandler);
