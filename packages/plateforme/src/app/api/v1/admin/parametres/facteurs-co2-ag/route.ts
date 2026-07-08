import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff, requireAdmin } from '@/lib/api-auth.js';
import { typedRpcError } from '@/lib/api-helpers.js';
import {
  idempotencyKeyOrError,
  findIdempotentReplay,
  recordIdempotentResult,
} from '@/lib/idempotency.js';

const IDEMPOTENCY_SCOPE = 'admin_co2_ag';

// GET — facteur CO₂ évité par repas donné AG (1 ligne)
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from('parametres_facteurs_co2_ag')
    .select('id, cle, facteur_co2_evite_par_repas_kg, source_donnee, actif')
    .limit(1)
    .single();

  if (error?.code === 'PGRST116') {
    return NextResponse.json({ data: null });
  }
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data });
}

// PUT — mise à jour du facteur AG (admin uniquement, commentaire obligatoire).
export async function PUT(req: NextRequest): Promise<NextResponse> {
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
    id?: string;
    facteur_co2_evite_par_repas_kg?: number;
    commentaire_modif?: string;
  };

  if (!body.id || body.facteur_co2_evite_par_repas_kg === undefined) {
    return NextResponse.json(
      { error: 'id et facteur_co2_evite_par_repas_kg sont obligatoires' },
      { status: 422 },
    );
  }
  // CDC §9ter.5 : facteur ≥ 0 (422 sinon).
  if (Number(body.facteur_co2_evite_par_repas_kg) < 0) {
    return NextResponse.json(
      { error: 'facteur_co2_evite_par_repas_kg doit être ≥ 0' },
      { status: 422 },
    );
  }
  if (!body.commentaire_modif || body.commentaire_modif.trim().length < 5) {
    return NextResponse.json(
      { error: 'commentaire_modif est obligatoire (≥ 5 caractères)' },
      { status: 422 },
    );
  }

  const { data, error } = await supabase.rpc('rpc_maj_facteur_co2_ag', {
    p_auteur: auth.ctx.userId,
    p_commentaire: body.commentaire_modif,
    p_id: body.id,
    p_facteur: body.facteur_co2_evite_par_repas_kg,
  });

  // Erreur typée sans fuite Postgres (BL-P2-31, CDC §9ter.6) : 22023/23514 → 422,
  // P0002 (facteur AG introuvable) → 404.
  if (error)
    return typedRpcError(error, 'admin.co2_ag.maj', {
      message422: 'Facteur CO2 AG invalide (≥ 0 requis)',
      message404: 'Paramètre facteur CO2 AG introuvable',
    });

  const payload = { data };
  await recordIdempotentResult(supabase, {
    scope: IDEMPOTENCY_SCOPE,
    key: idem.key,
    endpoint: '/api/v1/admin/parametres/facteurs-co2-ag',
    methode: 'PUT',
    statutHttp: 200,
    payloadOut: payload,
  });
  return NextResponse.json(payload);
}
