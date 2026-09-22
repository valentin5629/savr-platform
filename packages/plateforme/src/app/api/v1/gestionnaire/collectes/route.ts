import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { serverError } from '@/lib/api-helpers.js';

const ROLES: ClientRole[] = ['gestionnaire_lieux'];

// GET /api/v1/gestionnaire/collectes
// Liste des collectes sur les lieux du gestionnaire. On interroge `collectes`
// DIRECTEMENT avec l'embed `evenements!inner` (même pattern éprouvé que la route
// /gestionnaire/filtres) : la RLS col_select (f_collecte_visible) scope au parc du
// gestionnaire, identique à la vue v_collectes_gestionnaire_lieux (= SELECT nu sur
// collectes, security_invoker). Bénéfice : les filtres lieu / traiteur (drill-down
// des Top listes du dashboard) sont applicables ET les noms lieu/événement sont
// enfin renvoyés (la vue ne les portait pas → colonnes « — »).
// Paramètres : type, statut, from, to, lieu_id, traiteur_id, page
//
// Pagination SERVEUR (`count: 'exact'` + `range`), pattern §06.06 admin/lieux.
// Décision Val 2026-09-22 : le §06.05 ne spécifiait pas la taille de cette liste
// et la route coupait à 100 lignes SANS le dire — un parc de plus de 100
// collectes affichait une liste d'apparence complète qui ne l'était pas. Le
// total exact renvoyé ici est ce qui rend vérifiable le miroir du drill-down des
// Top listes du dashboard (§06.05 l.203 : « nombre de lignes = chiffre du Top
// liste ») : au-delà d'une page, seul `total` porte cette égalité.
export const PAGE_SIZE = 50;

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
  // `page` hors bornes (0, -3, « abc ») retombe sur 1 plutôt que de produire un
  // range négatif que PostgREST rejetterait en 416.
  const pageParam = Number.parseInt(sp.get('page') ?? '1', 10);
  const page = Number.isFinite(pageParam) ? Math.max(1, pageParam) : 1;
  const offset = (page - 1) * PAGE_SIZE;

  let q = supabase
    .from('collectes')
    .select(
      `id, evenement_id, type, statut, statut_tms, date_collecte,
       heure_collecte, taux_recyclage, co2_evite_kg, realisee_at,
       evenements!inner(
         nom_evenement, lieu_id, traiteur_operationnel_organisation_id,
         lieux!lieu_id(nom)
       )`,
      { count: 'exact' },
    )
    // `date_collecte` seule n'est pas unique (plusieurs collectes le même jour) :
    // sans départage, deux pages successives peuvent réordonner les ex æquo et
    // faire disparaître une ligne d'une page à l'autre. `id` fige l'ordre.
    .order('date_collecte', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  if (type) q = q.eq('type', type);
  if (statut) q = q.eq('statut', statut);
  if (from) q = q.gte('date_collecte', from);
  if (to) q = q.lte('date_collecte', to);
  if (lieuId) q = q.eq('evenements.lieu_id', lieuId);
  if (traiteurId)
    q = q.eq('evenements.traiteur_operationnel_organisation_id', traiteurId);

  const { data, error, count } = await q;
  if (error) return serverError(error, 'gestionnaire.collectes.list');

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

  return NextResponse.json({ data: rows, total: count ?? rows.length, page });
}
