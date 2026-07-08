import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff, requireAdmin } from '@/lib/api-auth.js';
import { typedRpcError, withApiTrace } from '@/lib/api-helpers.js';
import {
  idempotencyKeyOrError,
  findIdempotentReplay,
  recordIdempotentResult,
} from '@/lib/idempotency.js';

const IDEMPOTENCY_SCOPE = 'admin_co2_divers';

// GET — paramètres CO₂ divers (clé-valeur : forfait collecte + équivalences)
async function getHandler(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from('parametres_co2_divers')
    .select('id, cle, valeur, unite, description, source_donnee')
    .order('cle');

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: data ?? [] });
}

// PUT — mise à jour des valeurs clé-valeur (admin uniquement, commentaire obligatoire).
// Audit via audit_log (auteur + motif) écrit par le trigger fn_audit_parametres_co2_divers.
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
    divers?: { id: string; valeur: number }[];
    commentaire_modif?: string;
  };

  if (!Array.isArray(body.divers) || body.divers.length === 0) {
    return NextResponse.json(
      { error: 'divers est obligatoire (tableau non vide {id, valeur})' },
      { status: 422 },
    );
  }
  if (!body.commentaire_modif || body.commentaire_modif.trim().length < 5) {
    return NextResponse.json(
      { error: 'commentaire_modif est obligatoire (≥ 5 caractères)' },
      { status: 422 },
    );
  }
  // CDC §9ter.3 : `valeur` > 0 (422 sinon). La table `parametres_co2_divers`
  // n'a PAS de CHECK DB (divergence tracée) → contrôle applicatif obligatoire,
  // sinon une valeur ≤ 0 serait acceptée silencieusement.
  const valeurInvalide = body.divers.some(
    (d) => d.valeur === undefined || d.valeur === null || Number(d.valeur) <= 0,
  );
  if (valeurInvalide) {
    return NextResponse.json(
      { error: 'Chaque valeur doit être strictement positive (> 0)' },
      { status: 422 },
    );
  }

  const { data, error } = await supabase.rpc('rpc_maj_co2_divers', {
    p_auteur: auth.ctx.userId,
    p_commentaire: body.commentaire_modif,
    p_divers: body.divers,
  });

  // Erreur typée sans fuite Postgres (BL-P2-31) : 22023/23514 → 422, P0002 → 404.
  if (error)
    return typedRpcError(error, 'admin.co2_divers.maj', {
      message422: 'Valeur CO2 invalide (> 0 requis)',
    });

  const payload = { data };
  await recordIdempotentResult(supabase, {
    scope: IDEMPOTENCY_SCOPE,
    key: idem.key,
    endpoint: '/api/v1/admin/parametres/co2-divers',
    methode: 'PUT',
    statutHttp: 200,
    payloadOut: payload,
  });
  return NextResponse.json(payload);
}

export const GET = withApiTrace(getHandler);
export const PUT = withApiTrace(putHandler);
