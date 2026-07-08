import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff, requireAdmin } from '@/lib/api-auth.js';
import { typedRpcError, withApiTrace } from '@/lib/api-helpers.js';
import {
  idempotencyKeyOrError,
  findIdempotentReplay,
  recordIdempotentResult,
} from '@/lib/idempotency.js';

const IDEMPOTENCY_SCOPE = 'admin_co2_mix';

// GET — composition du flux emballages par matériau (7 lignes)
async function getHandler(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from('parametres_mix_emballages')
    .select(
      'id, code_materiau, nom_materiau, part_pct, fe_induit_kg_t, fe_evite_kg_t, source_donnee, actif',
    )
    .order('code_materiau');

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: data ?? [] });
}

// PUT — mise à jour du mix (admin uniquement, commentaire obligatoire).
// La RPC applique le batch, valide Σ=100 et recalcule le FE emballage + history.
async function putHandler(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  // CDC §9ter.6 l.861 : `Idempotency-Key` OBLIGATOIRE sur PUT + dédup 24h.
  const idem = idempotencyKeyOrError(req);
  if ('error' in idem) return idem.error;

  const supabase = createAdminSupabaseClient();
  const replay = await findIdempotentReplay(
    supabase,
    IDEMPOTENCY_SCOPE,
    idem.key,
  );
  if (replay) return replay;

  const body = (await req.json()) as {
    mix?: {
      id: string;
      part_pct: number;
      fe_induit_kg_t?: number;
      fe_evite_kg_t?: number;
    }[];
    commentaire_modif?: string;
  };

  if (!Array.isArray(body.mix) || body.mix.length === 0) {
    return NextResponse.json(
      { error: 'mix est obligatoire (tableau non vide)' },
      { status: 422 },
    );
  }
  if (!body.commentaire_modif || body.commentaire_modif.trim().length < 5) {
    return NextResponse.json(
      { error: 'commentaire_modif est obligatoire (≥ 5 caractères)' },
      { status: 422 },
    );
  }

  // Contrôle somme = 100 (feedback immédiat ; la RPC revalide côté DB).
  const total = body.mix.reduce((acc, m) => acc + Number(m.part_pct), 0);
  if (Math.abs(total - 100) > 0.05) {
    return NextResponse.json(
      {
        error: `La somme des parts doit être égale à 100 % (reçu ${total.toFixed(2)} %)`,
      },
      { status: 422 },
    );
  }
  // CDC §9ter.2 : FE ≥ 0 et part ∈ [0,100] (422 sinon). Contrôlé côté route pour
  // un 422 typé (sinon les CHECK DB `fe_* >= 0` / `part_pct` remontent en erreur).
  const mixInvalide = body.mix.some(
    (m) =>
      Number(m.part_pct) < 0 ||
      (m.fe_induit_kg_t !== undefined && Number(m.fe_induit_kg_t) < 0) ||
      (m.fe_evite_kg_t !== undefined && Number(m.fe_evite_kg_t) < 0),
  );
  if (mixInvalide) {
    return NextResponse.json(
      { error: 'Part (≥ 0) et facteurs (FE ≥ 0) du mix invalides' },
      { status: 422 },
    );
  }

  const { data, error } = await supabase.rpc('rpc_maj_mix_emballages', {
    p_auteur: auth.ctx.userId,
    p_commentaire: body.commentaire_modif,
    p_mix: body.mix,
  });

  // Erreur typée sans fuite Postgres (BL-P2-31) : 22023/23514 → 422, P0002 → 404.
  if (error)
    return typedRpcError(error, 'admin.co2_mix.maj', {
      message422: 'Mix emballages invalide (Σ = 100 %, FE ≥ 0)',
    });

  const payload = { data };
  await recordIdempotentResult(supabase, {
    scope: IDEMPOTENCY_SCOPE,
    key: idem.key,
    endpoint: '/api/v1/admin/parametres/mix-emballages',
    methode: 'PUT',
    statutHttp: 200,
    payloadOut: payload,
  });
  return NextResponse.json(payload);
}

export const GET = withApiTrace(getHandler);
export const PUT = withApiTrace(putHandler);
