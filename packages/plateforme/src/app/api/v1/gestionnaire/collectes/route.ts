import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';

const ROLES: ClientRole[] = ['gestionnaire_lieux'];

// GET /api/v1/gestionnaire/collectes
// Liste des collectes sur les lieux du gestionnaire. On interroge `collectes`
// DIRECTEMENT avec l'embed `evenements!inner` (même pattern éprouvé que la route
// /gestionnaire/filtres) : la RLS col_select (f_collecte_visible) scope au parc du
// gestionnaire, identique à la vue v_collectes_gestionnaire_lieux (= SELECT nu sur
// collectes, security_invoker). Bénéfice : les filtres lieu / traiteur (drill-down
// des Top listes du dashboard) sont applicables ET les noms lieu/événement sont
// enfin renvoyés (la vue ne les portait pas → colonnes « — »).
// Paramètres : type, statut, from, to, lieu_id, traiteur_id
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;

  const supabase = createSupabaseServerClient();
  const sp = new URL(req.url).searchParams;
  const type = sp.get('type');
  const statut = sp.get('statut');
  const from = sp.get('from');
  const to = sp.get('to');
  const lieuId = sp.get('lieu_id');
  const traiteurId = sp.get('traiteur_id');

  let q = supabase
    .from('collectes')
    .select(
      `id, evenement_id, type, statut, statut_tms, date_collecte,
       heure_collecte, taux_recyclage, co2_evite_kg, realisee_at,
       evenements!inner(
         nom_evenement, lieu_id, traiteur_operationnel_organisation_id,
         lieux!lieu_id(nom)
       )`,
    )
    .order('date_collecte', { ascending: false })
    .limit(100);

  if (type) q = q.eq('type', type);
  if (statut) q = q.eq('statut', statut);
  if (from) q = q.gte('date_collecte', from);
  if (to) q = q.lte('date_collecte', to);
  if (lieuId) q = q.eq('evenements.lieu_id', lieuId);
  if (traiteurId)
    q = q.eq('evenements.traiteur_operationnel_organisation_id', traiteurId);

  const { data, error } = await q;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  // Aplatissement des noms (to-one PostgREST = objet ou tableau selon le cache).
  const rows = (data ?? []).map((c) => {
    const { evenements, ...rest } = c as typeof c & {
      evenements:
        | {
            nom_evenement: string | null;
            lieux: { nom: string | null } | { nom: string | null }[] | null;
          }
        | {
            nom_evenement: string | null;
            lieux: { nom: string | null } | { nom: string | null }[] | null;
          }[]
        | null;
    };
    const evt = Array.isArray(evenements) ? evenements[0] : evenements;
    const lieu = evt
      ? Array.isArray(evt.lieux)
        ? evt.lieux[0]
        : evt.lieux
      : null;
    return {
      ...rest,
      evenement_nom: evt?.nom_evenement ?? null,
      lieu_nom: lieu?.nom ?? null,
    };
  });

  return NextResponse.json({ data: rows });
}
