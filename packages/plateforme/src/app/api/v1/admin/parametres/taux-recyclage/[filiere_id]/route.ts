import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireAdmin, requireStaff } from '@/lib/api-auth.js';
import {
  idempotencyKeyOrError,
  findIdempotentReplay,
  recordIdempotentResult,
} from '@/lib/idempotency.js';
import { typedRpcError, withApiTrace } from '@/lib/api-helpers.js';

async function putHandler(
  req: NextRequest,
  { params }: { params: Promise<{ filiere_id: string }> },
): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  const { filiere_id } = await params;
  // Scope de dédup PAR filière : une même Idempotency-Key sur deux filières
  // distinctes ne doit pas rejouer la réponse de l'autre (revue sécu R22a).
  const scope = `admin_taux_recyclage:${filiere_id}`;

  // CDC §9 l.800 : `Idempotency-Key` OBLIGATOIRE sur PUT (422 si absente) +
  // dédup 24h via `integrations_logs` (l.734 : « si déjà reçu dans les 24h →
  // renvoie le résultat précédent »). Rejeu AVANT toute mutation → aucune 2ᵉ
  // ligne `parametres_taux_recyclage_history`.
  const idem = idempotencyKeyOrError(req);
  if ('error' in idem) return idem.error;

  const supabase = createAdminSupabaseClient();
  const replay = await findIdempotentReplay(supabase, scope, idem.key);
  if (replay) return replay;

  const body = (await req.json()) as Record<string, unknown>;
  const { taux_captation, commentaire_modif } = body;

  if (taux_captation === undefined || taux_captation === null) {
    return NextResponse.json(
      { error: 'taux_captation est obligatoire' },
      { status: 422 },
    );
  }
  const taux = Number(taux_captation);
  if (isNaN(taux) || taux < 0 || taux > 1) {
    return NextResponse.json(
      { error: 'taux_captation doit être compris entre 0 et 1' },
      { status: 422 },
    );
  }
  if (!commentaire_modif || String(commentaire_modif).length < 5) {
    return NextResponse.json(
      { error: 'commentaire_modif est obligatoire (≥ 5 caractères)' },
      { status: 422 },
    );
  }

  // R3 / divergence M2.4 : passe par la RPC SECURITY DEFINER (auteur + motif en
  // contexte d'audit). La table principale n'a PAS de colonnes modifie_par/
  // modifie_le/commentaire_modif — l'historique va dans parametres_taux_recyclage_history
  // via le trigger fn_audit_taux_recyclage.
  const { data, error } = await supabase.rpc('rpc_maj_taux_recyclage', {
    p_auteur: auth.ctx.userId,
    p_commentaire: String(commentaire_modif),
    p_id: filiere_id,
    p_taux: taux,
  });

  // Erreur typée sans fuite Postgres (BL-P2-31) : P0002 (filière introuvable) →
  // 404, 22023/23514 → 422, sinon 500 générique.
  if (error)
    return typedRpcError(error, 'admin.taux_recyclage.maj', {
      message404: 'Filière introuvable',
      message422: 'Taux de captation invalide (0 ≤ x ≤ 1)',
    });

  // Persiste la réponse pour rejeu 24h (CDC §9 l.734/800, dédup Idempotency-Key).
  await recordIdempotentResult(supabase, {
    scope,
    key: idem.key,
    endpoint: `/api/v1/admin/parametres/taux-recyclage/${filiere_id}`,
    methode: 'PUT',
    statutHttp: 200,
    payloadOut: data,
  });
  return NextResponse.json(data);
}

async function getHandler(
  req: NextRequest,
  { params }: { params: Promise<{ filiere_id: string }> },
): Promise<NextResponse> {
  // Lecture historique = admin_savr + ops_savr (CDC §9 l.803), cohérent avec les
  // autres routes history (tarifs-ag, templates). L'écriture (PUT) reste admin-only.
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const { filiere_id } = await params;
  const supabase = createAdminSupabaseClient();

  // Historique antéchronologique (CDC §9 l.796-800). Colonnes taux/prestataire/
  // source avant-après + commentaire + auteur, alimentées par le trigger
  // fn_audit_taux_recyclage.
  const { data, error } = await supabase
    .from('parametres_taux_recyclage_history')
    .select('*')
    .eq('parametre_id', filiere_id)
    .order('modifie_le', { ascending: false });

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = data ?? [];

  // Résout « Modifié par » en nom lisible via une 2e requête (pas d'embed
  // PostgREST — évite les 400 de jointure ; volumétrie ≤ 10 modifs/an).
  const auteurIds = [...new Set(rows.map((r) => r.modifie_par))];
  const nameById = new Map<string, string>();
  if (auteurIds.length > 0) {
    const { data: users } = await supabase
      .from('users')
      .select('id, prenom, nom')
      .in('id', auteurIds);
    for (const u of users ?? []) {
      nameById.set(u.id, `${u.prenom ?? ''} ${u.nom ?? ''}`.trim());
    }
  }

  const enriched = rows.map((r) => ({
    ...r,
    modifie_par_nom: nameById.get(r.modifie_par) || r.modifie_par,
  }));

  return NextResponse.json({ data: enriched });
}

export const PUT = withApiTrace(putHandler);
export const GET = withApiTrace(getHandler);
