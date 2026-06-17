import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';

const ROLES: ClientRole[] = ['gestionnaire_lieux'];

// Statut consolidé événement (décision F2 2026-06-07)
function statutConsolide(
  collectes: { statut: string }[],
): 'En cours' | 'Terminé' | 'Annulé' {
  if (collectes.length === 0) return 'En cours';
  const tous = collectes.every((c) => c.statut === 'annulee');
  if (tous) return 'Annulé';
  const terminaux = new Set(['realisee', 'cloturee', 'annulee']);
  const tousTerminaux = collectes.every((c) => terminaux.has(c.statut));
  const auMoinsUnRealise = collectes.some(
    (c) => c.statut === 'realisee' || c.statut === 'cloturee',
  );
  if (tousTerminaux && auMoinsUnRealise) return 'Terminé';
  return 'En cours';
}

// GET /api/v1/gestionnaire/evenements
// Liste agrégée par événement (1 ligne = 1 événement) — §06.05 §2.
// Filtres : from, to, lieu_ids[], traiteur_ids[], type_evenement_ids[],
//           taille_evenements[], type_collecte, statut_consolide
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
  const typeCollecte = sp.get('type_collecte'); // 'avec_zd'|'avec_ag'|'zd_et_ag'|null
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
       organisations!traiteur_operationnel_organisation_id(id, nom),
       type_evenement_id,
       types_evenements!type_evenement_id(id, libelle),
       collectes(id, type, statut, date_collecte,
         collecte_flux(poids_reel_kg),
         attributions_antgaspi(volume_repas_realise))`,
    )
    .in('lieu_id', lieuFilter)
    .order('date_evenement', { ascending: false });

  if (traiteurIds.length > 0)
    q = q.in('traiteur_operationnel_organisation_id', traiteurIds);
  if (typeEvtIds.length > 0) q = q.in('type_evenement_id', typeEvtIds);

  const { data: evts, error } = await q;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  const orgId = auth.ctx.organisationId;
  const filteredRows = (evts ?? [])
    .map((e) => {
      const collectes = (Array.isArray(e.collectes) ? e.collectes : []) as {
        id: string;
        type: string;
        statut: string;
        date_collecte: string;
        collecte_flux: { poids_reel_kg?: number }[];
        attributions_antgaspi: { volume_repas_realise?: number }[];
      }[];

      const pax = (e.pax as number) ?? 0;
      const bracket = tailleBracket(pax);

      // Filtres post-fetch
      if (tailleEvts.length > 0 && !tailleEvts.includes(bracket)) return null;
      if (from && e.date_evenement && e.date_evenement < from) return null;
      if (to && e.date_evenement && e.date_evenement > to) return null;

      const zbCollectes = collectes.filter((c) => c.type === 'zero_dechet');
      const agCollectes = collectes.filter((c) => c.type === 'anti_gaspi');

      if (typeCollecte === 'avec_zd' && zbCollectes.length === 0) return null;
      if (typeCollecte === 'avec_ag' && agCollectes.length === 0) return null;
      if (
        typeCollecte === 'zd_et_ag' &&
        (zbCollectes.length === 0 || agCollectes.length === 0)
      )
        return null;

      const consolide = statutConsolide(collectes);
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
      const repasDonnes = agCollectes.reduce(
        (s, c) =>
          s +
          (c.attributions_antgaspi ?? []).reduce(
            (sa, a) => sa + (a.volume_repas_realise ?? 0),
            0,
          ),
        0,
      );
      const nbZd = zbCollectes.length;
      const nbAg = agCollectes.length;

      return {
        id: e.id as string,
        nom_evenement: e.nom_evenement,
        date_evenement: e.date_evenement,
        pax,
        taille_bracket: bracket,
        lieu: e.lieux,
        traiteur: e.organisations,
        type_evenement: e.types_evenements,
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
    lieu: unknown;
    traiteur: unknown;
    type_evenement: unknown;
    nb_collectes_zd: number;
    nb_collectes_ag: number;
    tonnage_zd_kg: number;
    repas_donnes: number;
    statut_consolide: string;
    programmee_par_moi: boolean;
  }>;

  // dechets_labo_kg via SECURITY DEFINER (coefficient jamais exposé) — parallèle
  const dechetsCalls = await Promise.all(
    filteredRows.map(async (row) => {
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
