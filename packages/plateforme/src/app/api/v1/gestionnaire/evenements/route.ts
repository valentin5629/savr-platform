import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@savr/shared/src/logger/index.js';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { serverError } from '@/lib/api-helpers.js';
import { lireFiltresCollectesGestionnaire } from '@/lib/collectes-gestionnaire.js';
import {
  EVENEMENTS_PAGE_SIZE as PAGE_SIZE,
  adresseLieu,
  co2EviteTotal,
  consoliderEvenement,
  un,
  type CollecteAConsolider,
  type UnOuListe,
} from '@/lib/evenements-gestionnaire.js';
import { parsePage } from '@/lib/pagination.js';
import { lireTri } from '@/lib/tri-liste.js';

const ROLES: ClientRole[] = ['gestionnaire_lieux'];

// Seule la date est triable : les autres colonnes sont des agrégats calculés
// après la requête, et la liste est paginée côté serveur.
const TRIS = { date: ['date_evenement'] } satisfies Record<string, string[]>;

const TYPES_COLLECTE = new Set(['zero_dechet', 'anti_gaspi']);

type LigneBrute = {
  id: string;
  nom_evenement: string | null;
  date_evenement: string | null;
  pax: number | null;
  nom_client_organisateur: string | null;
  lieux: UnOuListe<{
    nom: string | null;
    adresse_acces: string | null;
    code_postal: string | null;
    ville: string | null;
  }>;
  organisations: UnOuListe<{ nom: string | null }>;
  collectes: CollecteAConsolider[] | null;
};

// GET /api/v1/gestionnaire/evenements
// Liste des événements du gestionnaire, 1 ligne = 1 événement, résultats
// cumulés sur ses collectes (§06.05 §2, remise par Val le 2026-10-18). Ce que
// la session lit est borné par la RLS de `evenements` (evt_gestionnaire_select :
// les événements que son organisation a programmés, et les événements datés
// tenus sur ses lieux) et, pour les collectes imbriquées, par celle de
// `collectes`. Ce sont les événements des collectes de la liste Collectes, plus
// ceux qui n'ont aucune collecte visible (la liste Collectes, qui part des
// collectes, ne peut pas les montrer). Un brouillon (sans date) n'est pas un
// événement : écarté.
//
// Paramètres — ceux de la liste Collectes, pour que les deux barres de filtres
// se lisent pareil : from, to (sur la date de l'événement), lieu_ids,
// traiteur_ids (CSV), type_evenement_ids[], taille_evenements[], type
// (zero_dechet | anti_gaspi : événements ayant au moins une collecte de ce
// type), tri=date, ordre, page.
//
// Pagination SERVEUR, 50 événements par page (décision Val 2026-09-22 pour la
// liste Collectes, reprise ici) : tous les filtres sont en SQL, le total renvoyé
// est celui de la base. `f_dechets_labo_estimes` n'est appelée que pour les
// événements de la page.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;

  const supabase = createSupabaseServerClient();
  const sp = new URL(req.url).searchParams;
  const from = sp.get('from');
  const to = sp.get('to');
  const type = sp.get('type');
  const { lieuIds, traiteurIds, typeEvtIds, predicatsTaille, aucunResultat } =
    lireFiltresCollectesGestionnaire(sp);
  const tri = lireTri(sp, TRIS, { tri: 'date', ascendant: false });
  const page = parsePage(sp);
  const offset = (page - 1) * PAGE_SIZE;

  // Filtre demandé sans valeur lisible (dont un type de collecte inconnu) : la
  // réponse honnête est une liste vide, pas la liste non filtrée.
  if (aucunResultat || (type && !TYPES_COLLECTE.has(type))) {
    return NextResponse.json({ data: [], total: 0, page });
  }

  const filtree = () => {
    // `filtre_type` : second embed des collectes, `!inner`, qui ne sert qu'à
    // retenir les événements ayant au moins une collecte du type demandé. Le
    // premier embed, lui, garde TOUTES les collectes de l'événement : le bilan
    // reste celui de l'événement entier. Mesuré contre le PostgREST local
    // (2026-10-18) : un événement à 3 ZD + 6 AG filtré sur ZD rend ses 9
    // collectes, et compte pour 1 dans le total.
    let q = supabase.from('evenements').select(
      `id, nom_evenement, date_evenement, pax, nom_client_organisateur,
       lieux!lieu_id(nom, adresse_acces, code_postal, ville),
       organisations:v_traiteurs_gestionnaire!traiteur_operationnel_organisation_id(nom),
       collectes(id, type, statut, date_collecte, taux_recyclage, co2_evite_kg,
         collecte_flux(poids_reel_kg),
         attributions_antgaspi:v_attributions_gestionnaire(volume_repas_realise))
       ${type ? ', filtre_type:collectes!inner(id)' : ''}`,
      { count: 'exact' },
    );
    for (const c of tri.colonnes) q = q.order(c, { ascending: tri.ascendant });
    // `date_evenement` n'est pas unique : `id` fige l'ordre d'une page à l'autre.
    q = q.order('id', { ascending: tri.ascendant });

    q = q.not('date_evenement', 'is', null);
    if (type) q = q.eq('filtre_type.type', type);
    if (from) q = q.gte('date_evenement', from);
    if (to) q = q.lte('date_evenement', to);
    if (lieuIds.length > 0) q = q.in('lieu_id', lieuIds);
    if (traiteurIds.length > 0)
      q = q.in('traiteur_operationnel_organisation_id', traiteurIds);
    if (typeEvtIds.length > 0) q = q.in('type_evenement_id', typeEvtIds);
    // Mêmes prédicats que la liste Collectes (pax NULL = XS), ici sur la table
    // interrogée elle-même.
    if (predicatsTaille.length > 0) q = q.or(predicatsTaille.join(','));
    return q;
  };

  let { data, error, count } = await filtree().range(
    offset,
    offset + PAGE_SIZE - 1,
  );

  // Page demandée au-delà de la dernière (PGRST103) : 200 avec une page vide et
  // le vrai total, pour que l'écran ramène sur une page valide — même rattrapage
  // que la liste Collectes.
  if (error?.code === 'PGRST103') {
    const recompte = await filtree().range(0, 0);
    if (recompte.error)
      return serverError(recompte.error, 'gestionnaire.evenements.list');
    data = [];
    count = recompte.count;
    error = null;
  }

  if (error) return serverError(error, 'gestionnaire.evenements.list');

  const brutes = (data ?? []) as unknown as LigneBrute[];
  const bilans = brutes.map((e) => consoliderEvenement(e.collectes ?? []));

  // Déchets labo estimés (§05 R_dechets_labo_estimes) : seulement pour un
  // événement qui a au moins une collecte ZD (arbitrage Val 2026-10-07). NULL =
  // coefficient non communiqué → « — » ; un appel en échec vaut NULL aussi,
  // journalisé.
  const dechetsLabo = await Promise.all(
    brutes.map(async (e, i) => {
      if (bilans[i]!.nb_collectes_zd === 0) return null;
      const { data: kg, error: echec } = await supabase.rpc(
        'f_dechets_labo_estimes',
        { p_evenement_id: e.id },
      );
      if (echec) {
        logger.warn('gestionnaire.evenements.dechets_labo_echec', {
          evenement_id: e.id,
          code: echec.code,
        });
        return null;
      }
      return kg as number | null;
    }),
  );

  const rows = brutes.map((e, i) => {
    const b = bilans[i]!;
    return {
      id: e.id,
      nom_evenement: e.nom_evenement,
      date_evenement: e.date_evenement,
      pax: e.pax,
      client_nom: e.nom_client_organisateur?.trim() || null,
      lieu_nom: un(e.lieux)?.nom ?? null,
      lieu_adresse: adresseLieu(un(e.lieux)),
      traiteur_nom: un(e.organisations)?.nom ?? null,
      nb_collectes_zd: b.nb_collectes_zd,
      nb_collectes_ag: b.nb_collectes_ag,
      nb_realisees: b.nb_realisees_zd + b.nb_realisees_ag,
      nb_sans_excedent: b.nb_sans_excedent,
      tonnage_zd_kg: b.tonnage_zd_kg,
      taux_recyclage: b.taux_recyclage,
      repas_donnes: b.repas_donnes,
      co2_evite_kg: co2EviteTotal(b),
      dechets_labo_kg: dechetsLabo[i] ?? null,
      statut_consolide: b.statut_consolide,
    };
  });

  return NextResponse.json({ data: rows, total: count ?? rows.length, page });
}
