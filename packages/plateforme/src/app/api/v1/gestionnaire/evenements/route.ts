import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { serverError } from '@/lib/api-helpers.js';
import { statutEvenementConsolide } from '@/lib/libelles/evenement.js';
import {
  lireTypesCollecte,
  passeTypesCollecte,
} from '@/lib/evenements-type-collecte.js';

const ROLES: ClientRole[] = ['gestionnaire_lieux'];

// GET /api/v1/gestionnaire/evenements
// Liste agrégée par événement (1 ligne = 1 événement) — §06.05 §2.
// Filtres : from, to, lieu_ids[], traiteur_ids[], type_evenement_ids[],
//           taille_evenements[], types_collecte[] (ancien type_collecte),
//           statut_consolide[]
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;

  const supabase = createSupabaseServerClient();
  const sp = new URL(req.url).searchParams;
  const from = sp.get('from');
  const to = sp.get('to');
  const lieuIds = sp.getAll('lieu_ids[]');
  const traiteurIds = sp.getAll('traiteur_ids[]');
  const typeEvtIds = sp.getAll('type_evenement_ids[]');
  const tailleEvts = sp.getAll('taille_evenements[]');
  const typesCollecte = lireTypesCollecte(sp);
  const statutFiltres = sp.getAll('statut_consolide[]');

  // Lieux du périmètre
  const { data: orgLieux } = await supabase
    .from('organisations_lieux')
    .select('lieu_id');
  const perimetreLieuIds = (orgLieux ?? []).map((r) => r.lieu_id as string);
  const lieuFilter =
    lieuIds.length > 0
      ? lieuIds.filter((id) => perimetreLieuIds.includes(id))
      : perimetreLieuIds;

  if (lieuFilter.length === 0) {
    return NextResponse.json({ data: [], total: 0 });
  }

  let q = supabase
    .from('evenements')
    .select(
      `id, nom_evenement, date_evenement, pax,
       organisation_id,
       lieu_id,
       lieux!lieu_id(id, nom, ville),
       traiteur_operationnel_organisation_id,
       organisations:v_traiteurs_gestionnaire!traiteur_operationnel_organisation_id(id, nom),
       type_evenement_id,
       types_evenements!type_evenement_id(id, libelle),
       collectes(id, type, statut, date_collecte,
         collecte_flux(poids_reel_kg),
         attributions_antgaspi:v_attributions_gestionnaire(volume_repas_realise))`,
    )
    .in('lieu_id', lieuFilter)
    .order('date_evenement', { ascending: false });

  if (traiteurIds.length > 0)
    q = q.in('traiteur_operationnel_organisation_id', traiteurIds);
  if (typeEvtIds.length > 0) q = q.in('type_evenement_id', typeEvtIds);

  const { data: evts, error } = await q;
  if (error) return serverError(error, 'gestionnaire.evenements.list');

  const orgId = auth.ctx.organisationId;
  const filteredRows = (evts ?? [])
    .map((e) => {
      const collectes = (Array.isArray(e.collectes) ? e.collectes : []) as ({
        id: string;
        type: string;
        statut: string;
        date_collecte: string;
        collecte_flux: { poids_reel_kg?: number }[];
      } & EmbedsRepas)[];

      const pax = (e.pax as number) ?? 0;
      const bracket = tailleBracket(pax);

      // Filtres post-fetch
      if (tailleEvts.length > 0 && !tailleEvts.includes(bracket)) return null;
      if (from && e.date_evenement && e.date_evenement < from) return null;
      if (to && e.date_evenement && e.date_evenement > to) return null;

      const zbCollectes = collectes.filter((c) => c.type === 'zero_dechet');
      const agCollectes = collectes.filter((c) => c.type === 'anti_gaspi');

      if (
        !passeTypesCollecte(
          typesCollecte,
          zbCollectes.length > 0,
          agCollectes.length > 0,
        )
      )
        return null;

      // Statut consolidé (décision F2 2026-06-07) : `lib/libelles/evenement`.
      const consolide = statutEvenementConsolide(collectes);
      if (statutFiltres.length > 0 && !statutFiltres.includes(consolide))
        return null;

      const tonnageKg = zbCollectes.reduce(
        (s, c) =>
          s +
          (c.collecte_flux ?? []).reduce(
            (sf, f) => sf + (f.poids_reel_kg ?? 0),
            0,
          ),
        0,
      );
      const repasDonnes = agCollectes.reduce((s, c) => s + repasCollecte(c), 0);
      const nbZd = zbCollectes.length;
      const nbAg = agCollectes.length;

      // Aplatir les embeds to-one (PostgREST renvoie objet, parfois tableau) →
      // champs plats consommés directement par la liste (fix mismatch latent :
      // la page lisait lieu_nom/traiteur_nom que la route ne renvoyait pas).
      const lieu = pickOne(e.lieux) as {
        nom?: string | null;
        ville?: string | null;
      } | null;
      const traiteur = pickOne(e.organisations) as {
        nom?: string | null;
      } | null;
      const typeEvt = pickOne(e.types_evenements) as {
        libelle?: string | null;
      } | null;

      return {
        id: e.id as string,
        nom_evenement: e.nom_evenement,
        date_evenement: e.date_evenement,
        pax,
        taille_bracket: bracket,
        lieu_nom: lieu?.nom ?? null,
        lieu_ville: lieu?.ville ?? null,
        traiteur_nom: traiteur?.nom ?? null,
        type_evenement_libelle: typeEvt?.libelle ?? null,
        nb_collectes_zd: nbZd,
        nb_collectes_ag: nbAg,
        tonnage_zd_kg: tonnageKg,
        repas_donnes: repasDonnes,
        statut_consolide: consolide,
        programmee_par_moi: e.organisation_id === orgId,
      };
    })
    .filter(Boolean) as Array<{
    id: string;
    nom_evenement: unknown;
    date_evenement: unknown;
    pax: number;
    taille_bracket: string;
    lieu_nom: string | null;
    lieu_ville: string | null;
    traiteur_nom: string | null;
    type_evenement_libelle: string | null;
    nb_collectes_zd: number;
    nb_collectes_ag: number;
    tonnage_zd_kg: number;
    repas_donnes: number;
    statut_consolide: string;
    programmee_par_moi: boolean;
  }>;

  // dechets_labo_kg via SECURITY DEFINER (coefficient jamais exposé) — parallèle.
  // Seulement pour un événement qui a au moins une collecte ZD (arbitrage Val
  // 2026-10-07 : « la notion ne tient pas pour les collectes AG ») : un
  // événement aux seules collectes anti-gaspi n'a pas d'estimation — l'écran
  // rend « — » — et la fonction n'est pas appelée pour lui. Même règle que la
  // liste Collectes du rôle, où seule une ligne ZD porte l'estimation.
  const dechetsCalls = await Promise.all(
    filteredRows.map(async (row) => {
      if (row.nb_collectes_zd === 0) return null;
      const { data } = await supabase.rpc('f_dechets_labo_estimes', {
        p_evenement_id: row.id,
      });
      return data as number | null;
    }),
  );

  const rows = filteredRows.map((row, i) => ({
    ...row,
    dechets_labo_kg: dechetsCalls[i] ?? null,
  }));

  return NextResponse.json({ data: rows, total: rows.length });
}

function tailleBracket(pax: number): string {
  if (pax < 250) return 'XS';
  if (pax < 500) return 'S';
  if (pax < 750) return 'M';
  if (pax < 1000) return 'L';
  return 'XL';
}

// Embed to-one PostgREST : objet (ou tableau à 1 élément selon le contexte).
function pickOne(v: unknown): unknown {
  return Array.isArray(v) ? v[0] : v;
}

// L'embed d'où sortent les repas d'une collecte AG : la vue
// `v_attributions_gestionnaire`, sous la clé `attributions_antgaspi`. PostgREST
// la rend en OBJET (to-one par collecte_id) ; le tableau est accepté aussi, la
// forme dépendant du cache de schéma.
type UnOuListe<T> = T | T[] | null | undefined;
interface EmbedsRepas {
  attributions_antgaspi?: UnOuListe<{ volume_repas_realise?: number | null }>;
}
function enListe<T>(v: UnOuListe<T>): T[] {
  return Array.isArray(v) ? v : v ? [v] : [];
}

// Repas donnés d'une collecte AG — le volume de l'attribution, lu par la vue
// `v_attributions_gestionnaire` (§04) : sur une collecte programmée par un
// traiteur TIERS — le cas nominal du gestionnaire — aa_select refuse la table
// (C-1, jamais élargie), la vue rend le volume des collectes de SES lieux. Même
// source que le détail événement, le dashboard et l'export. Pas d'attribution, ou
// volume non saisi → 0, que l'écran rend « — ».
function repasCollecte(c: EmbedsRepas): number {
  return enListe(c.attributions_antgaspi)[0]?.volume_repas_realise ?? 0;
}
