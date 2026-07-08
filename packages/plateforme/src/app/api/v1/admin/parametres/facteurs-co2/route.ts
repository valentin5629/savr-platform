import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff, requireAdmin } from '@/lib/api-auth.js';
import { typedRpcError, withApiTrace } from '@/lib/api-helpers.js';
import {
  idempotencyKeyOrError,
  findIdempotentReplay,
  recordIdempotentResult,
} from '@/lib/idempotency.js';

const IDEMPOTENCY_SCOPE = 'admin_co2_facteurs';

// GET — facteurs CO₂ par flux ZD (lecture ops + admin)
async function getHandler(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from('parametres_facteurs_co2')
    .select(
      'id, code_flux, nom_flux, fe_induit_kg_t, fe_evite_kg_t, energie_primaire_evitee_kwh_t, source_donnee, actif',
    )
    .order('code_flux');

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: data ?? [] });
}

// PUT — mise à jour des facteurs (admin uniquement, commentaire obligatoire).
// Historique + auteur tracés par la RPC SECURITY DEFINER (R3 / divergence M2.4).
async function putHandler(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  // CDC §9ter.6 l.861 : `Idempotency-Key` OBLIGATOIRE sur PUT + dédup 24h
  // (« Pattern identique au §9 », l.811). Rejeu avant mutation.
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
    facteurs?: {
      id: string;
      fe_induit_kg_t?: number;
      fe_evite_kg_t?: number;
      energie_primaire_evitee_kwh_t?: number;
      source_donnee?: string;
    }[];
    commentaire_modif?: string;
  };

  if (!Array.isArray(body.facteurs) || body.facteurs.length === 0) {
    return NextResponse.json(
      { error: 'facteurs est obligatoire (tableau non vide)' },
      { status: 422 },
    );
  }
  if (!body.commentaire_modif || body.commentaire_modif.trim().length < 5) {
    return NextResponse.json(
      { error: 'commentaire_modif est obligatoire (≥ 5 caractères)' },
      { status: 422 },
    );
  }
  // CDC §9ter.1 : facteurs d'émission ≥ 0 (422 sinon). Contrôlé côté route pour
  // un 422 typé (sinon la contrainte DB `CHECK (fe_* >= 0)` remonte en erreur).
  const feNegatif = body.facteurs.some((f) =>
    [f.fe_induit_kg_t, f.fe_evite_kg_t, f.energie_primaire_evitee_kwh_t].some(
      (v) => v !== undefined && Number(v) < 0,
    ),
  );
  if (feNegatif) {
    return NextResponse.json(
      { error: 'Les facteurs (FE induit / évité / énergie) doivent être ≥ 0' },
      { status: 422 },
    );
  }

  const { data, error } = await supabase.rpc('rpc_maj_facteurs_co2', {
    p_auteur: auth.ctx.userId,
    p_commentaire: body.commentaire_modif,
    p_facteurs: body.facteurs,
  });

  // Erreur typée sans fuite Postgres (BL-P2-31) : 22023/23514 → 422, P0002 → 404.
  if (error)
    return typedRpcError(error, 'admin.co2_facteurs.maj', {
      message422: 'Facteur CO2 invalide (FE ≥ 0 requis)',
    });

  const payload = { data };
  await recordIdempotentResult(supabase, {
    scope: IDEMPOTENCY_SCOPE,
    key: idem.key,
    endpoint: '/api/v1/admin/parametres/facteurs-co2',
    methode: 'PUT',
    statutHttp: 200,
    payloadOut: payload,
  });
  return NextResponse.json(payload);
}

export const GET = withApiTrace(getHandler);
export const PUT = withApiTrace(putHandler);
