// Liste Événements, commune à tous les rôles (décision Val 2026-10-29) : une
// ligne = un événement, résultats cumulés sur ses collectes. Née dans l'espace
// gestionnaire de lieux (§06.05 §2, remise par Val le 2026-10-18), elle sert
// désormais les six rôles avec UNE seule implémentation : toute évolution de la
// liste vaut pour tous.
//
// Ce que chaque rôle lit reste borné par ses droits existants, aucun n'est
// élargi : la requête part de `evenements` sous la session de l'appelant, donc
// de ses policies `evt_*_select` (traiteur : événements possédés ou opérés ;
// agence : programmés ; gestionnaire : programmés ou tenus sur ses lieux ;
// client organisateur : ceux dont il est le client rattaché). Le staff lit tout,
// en service_role comme les autres routes Admin. Seuls changent, d'un rôle à
// l'autre, les chemins de lecture que la RLS impose (cf. PROFILS) : nom du
// traiteur et repas donnés.
//
// Règles de la liste (celles de la liste gestionnaire, inchangées) :
//  - un brouillon n'est pas un événement : est écarté tout événement dont les
//    collectes sont toutes des brouillons ; un événement sans date aussi ;
//  - filtres = ceux de la liste Collectes : from, to (date de l'événement),
//    lieu_ids, traiteur_ids, client_ids (staff seul : organisation
//    programmatrice), type_evenement_ids[], taille_evenements[], type (ZD / AG :
//    au moins une collecte de ce type), tri=date, ordre, page ;
//  - pagination SERVEUR, 50 événements par page, total de la base.

import { logger } from '@savr/shared/src/logger/index.js';
import { lireFiltresCollectesGestionnaire } from '@/lib/collectes-gestionnaire';
import type { DbClient } from '@/lib/dashboards/loaders';
import {
  EVENEMENTS_PAGE_SIZE as PAGE_SIZE,
  adresseLieu,
  co2EviteTotal,
  consoliderEvenement,
  un,
  type CollecteAConsolider,
  type UnOuListe,
} from '@/lib/evenements-gestionnaire';
import { estUuid, listeCsv } from '@/lib/filtre-csv';
import { STATUT_BILAN } from '@/lib/collectes/fiche-client-types';
import { parsePage } from '@/lib/pagination';
import { lireTri } from '@/lib/tri-liste';
import type { Role } from '@/lib/roles';

/** Espace d'affichage d'un rôle : il fixe ce que la liste lit et montre. */
export type EspaceEvenements =
  | 'admin'
  | 'traiteur'
  | 'agence'
  | 'gestionnaire'
  | 'organisateur';

export function espaceEvenementsDuRole(role: Role): EspaceEvenements | null {
  switch (role) {
    case 'admin_savr':
    case 'ops_savr':
      return 'admin';
    case 'traiteur_manager':
    case 'traiteur_commercial':
      return 'traiteur';
    case 'agence':
      return 'agence';
    case 'gestionnaire_lieux':
      return 'gestionnaire';
    case 'client_organisateur':
      return 'organisateur';
    default:
      return null;
  }
}

/**
 * Chemins de lecture imposés par la RLS, par espace :
 *  - `repas` : embed des attributions AG. Le gestionnaire passe par la vue
 *    `v_attributions_gestionnaire` (aa_select lui refuse la table pour un
 *    traiteur tiers, C-1) ; le client organisateur n'a aucun embed et lit les
 *    repas par `f_volume_repas_realise` (helper C-1-safe, comme ses autres
 *    écrans) ; les autres lisent la table ;
 *  - `traiteur` : embed du nom du traiteur opérationnel. Le gestionnaire a sa
 *    vue `v_traiteurs_gestionnaire`, le staff lit `organisations` ; les autres
 *    rôles (RLS `organisations` = leur seule organisation) résolvent les noms
 *    par la vue `v_referentiel_traiteurs`, ouverte à tout rôle client.
 */
const PROFILS: Record<
  EspaceEvenements,
  { repas: string | null; traiteur: string | null }
> = {
  admin: {
    repas: 'attributions_antgaspi(volume_repas_realise)',
    traiteur:
      'organisations:organisations!traiteur_operationnel_organisation_id(nom, raison_sociale)',
  },
  traiteur: {
    repas: 'attributions_antgaspi(volume_repas_realise)',
    traiteur: null,
  },
  agence: {
    repas: 'attributions_antgaspi(volume_repas_realise)',
    traiteur: null,
  },
  gestionnaire: {
    repas:
      'attributions_antgaspi:v_attributions_gestionnaire(volume_repas_realise)',
    traiteur:
      'organisations:v_traiteurs_gestionnaire!traiteur_operationnel_organisation_id(nom)',
  },
  organisateur: { repas: null, traiteur: null },
};

// Seule la date est triable : les autres colonnes sont des agrégats calculés
// après la requête, et la liste est paginée côté serveur.
const TRIS = { date: ['date_evenement'] } satisfies Record<string, string[]>;

const TYPES_COLLECTE = new Set(['zero_dechet', 'anti_gaspi']);

type CollecteBrute = CollecteAConsolider & { id: string };

type LigneBrute = {
  id: string;
  nom_evenement: string | null;
  date_evenement: string | null;
  pax: number | null;
  nom_client_organisateur: string | null;
  traiteur_operationnel_organisation_id: string | null;
  lieux: UnOuListe<{
    nom: string | null;
    adresse_acces: string | null;
    code_postal: string | null;
    ville: string | null;
  }>;
  organisations?: UnOuListe<{
    nom: string | null;
    raison_sociale?: string | null;
  }>;
  collectes: CollecteBrute[] | null;
};

/** Une ligne de la liste, telle que l'écran la reçoit. */
export interface LigneEvenement {
  id: string;
  nom_evenement: string | null;
  date_evenement: string | null;
  pax: number | null;
  client_nom: string | null;
  lieu_nom: string | null;
  lieu_adresse: string | null;
  traiteur_nom: string | null;
  nb_collectes_zd: number;
  nb_collectes_ag: number;
  nb_realisees: number;
  nb_sans_excedent: number;
  tonnage_zd_kg: number | null;
  taux_recyclage: number | null;
  repas_donnes: number | null;
  co2_evite_kg: number | null;
  dechets_labo_kg: number | null;
  statut_consolide: string;
}

export type ResultatListe =
  | {
      ok: true;
      data: LigneEvenement[];
      total: number;
      page: number;
    }
  | { ok: false; error: unknown };

/**
 * Noms des traiteurs par la vue `v_referentiel_traiteurs` (traiteurs actifs,
 * non-shadow : un traiteur hors référentiel reste sans nom, « — »). Lecture en
 * échec = noms absents, journalisée : la liste reste servie.
 */
async function nomsTraiteursReferentiel(
  supabase: DbClient,
  ids: string[],
  evenement: string,
): Promise<Map<string, string>> {
  const noms = new Map<string, string>();
  if (ids.length === 0) return noms;
  const { data, error } = await supabase
    .from('v_referentiel_traiteurs')
    .select('id, nom')
    .in('id', ids);
  if (error) {
    logger.warn(evenement, { code: error.code });
    return noms;
  }
  for (const t of (data ?? []) as { id: string; nom: string | null }[])
    if (t.nom) noms.set(t.id, t.nom);
  return noms;
}

export async function listerEvenements(
  supabase: DbClient,
  espace: EspaceEvenements,
  sp: URLSearchParams,
): Promise<ResultatListe> {
  const profil = PROFILS[espace];
  const from = sp.get('from');
  const to = sp.get('to');
  const type = sp.get('type');
  const { lieuIds, traiteurIds, typeEvtIds, predicatsTaille, aucunResultat } =
    lireFiltresCollectesGestionnaire(sp);
  // Client = organisation programmatrice, filtre du staff seul : ailleurs, le
  // paramètre est ignoré (le périmètre RLS le borne déjà).
  const clientsDemandes =
    espace === 'admin' ? listeCsv(sp.get('client_ids'), Boolean) : [];
  const clientIds = clientsDemandes.filter(estUuid);
  const tri = lireTri(sp, TRIS, { tri: 'date', ascendant: false });
  const page = parsePage(sp);
  const offset = (page - 1) * PAGE_SIZE;

  // Filtre demandé sans valeur lisible (dont un type de collecte inconnu) : la
  // réponse honnête est une liste vide, pas la liste non filtrée.
  if (
    aucunResultat ||
    (clientsDemandes.length > 0 && clientIds.length === 0) ||
    (type && !TYPES_COLLECTE.has(type))
  ) {
    return { ok: true, data: [], total: 0, page };
  }

  const filtree = () => {
    // `filtre_type` : second embed des collectes, `!inner`, qui ne sert qu'à
    // retenir les événements ayant au moins une collecte du type demandé. Le
    // premier embed, lui, garde TOUTES les collectes de l'événement : le bilan
    // reste celui de l'événement entier. `filtre_type_evt` : même principe pour
    // le type d'événement, condition SÉPARÉE du filtre ZD/AG (décision Val
    // 2026-10-24, lot C1, Q1).
    const collectes = [
      'id, type, statut, date_collecte, taux_recyclage, co2_evite_kg',
      'collecte_flux(poids_reel_kg)',
      profil.repas,
    ]
      .filter(Boolean)
      .join(', ');
    let q = supabase.from('evenements').select(
      `id, nom_evenement, date_evenement, pax, nom_client_organisateur,
       traiteur_operationnel_organisation_id,
       lieux!lieu_id(nom, adresse_acces, code_postal, ville),
       ${profil.traiteur ? `${profil.traiteur},` : ''}
       collectes(${collectes}),
       hors_brouillon:collectes(id)
       ${type ? ', filtre_type:collectes!inner(id)' : ''}
       ${typeEvtIds.length > 0 ? ', filtre_type_evt:collectes!inner(id)' : ''}`,
      { count: 'exact' },
    );
    for (const c of tri.colonnes) q = q.order(c, { ascending: tri.ascendant });
    // `date_evenement` n'est pas unique : `id` fige l'ordre d'une page à l'autre.
    q = q.order('id', { ascending: tri.ascendant });

    q = q.not('date_evenement', 'is', null);
    // Brouillon écarté : l'événement garde au moins une collecte hors brouillon
    // (`hors_brouillon`, embed filtré), ou n'a aucune collecte. Un événement aux
    // collectes toutes brouillons ne passe ni l'un ni l'autre.
    q = q
      .neq('hors_brouillon.statut', 'brouillon')
      .or('hors_brouillon.not.is.null,collectes.is.null');
    if (type) q = q.eq('filtre_type.type', type);
    if (from) q = q.gte('date_evenement', from);
    if (to) q = q.lte('date_evenement', to);
    if (lieuIds.length > 0) q = q.in('lieu_id', lieuIds);
    if (traiteurIds.length > 0)
      q = q.in('traiteur_operationnel_organisation_id', traiteurIds);
    if (clientIds.length > 0) q = q.in('organisation_id', clientIds);
    if (typeEvtIds.length > 0)
      q = q.in('filtre_type_evt.type_evenement_id', typeEvtIds);
    // Mêmes prédicats que la liste Collectes (pax NULL = XS), sur l'événement :
    // la taille de la liste reste celle de l'ÉVÉNEMENT (décision Val C4 du
    // 2026-10-20).
    if (predicatsTaille.length > 0) q = q.or(predicatsTaille.join(','));
    return q;
  };

  let { data, error, count } = await filtree().range(
    offset,
    offset + PAGE_SIZE - 1,
  );

  // Page demandée au-delà de la dernière (PGRST103) : page vide et vrai total,
  // pour que l'écran ramène sur une page valide.
  if (error?.code === 'PGRST103') {
    const recompte = await filtree().range(0, 0);
    if (recompte.error) return { ok: false, error: recompte.error };
    data = [];
    count = recompte.count;
    error = null;
  }
  if (error) return { ok: false, error };

  const brutes = (data ?? []) as unknown as LigneBrute[];

  // Client organisateur : repas lus collecte par collecte par le helper
  // C-1-safe, pour les seules collectes AG qui portent un résultat.
  if (espace === 'organisateur') {
    await Promise.all(
      brutes.flatMap((e) =>
        (e.collectes ?? [])
          .filter((c) => c.type === 'anti_gaspi' && c.statut === STATUT_BILAN)
          .map(async (c) => {
            const { data: repas, error: echec } = await supabase.rpc(
              'f_volume_repas_realise',
              { p_collecte_id: c.id },
            );
            if (echec) {
              logger.warn('evenements.liste.repas_echec', {
                collecte_id: c.id,
                code: echec.code,
              });
              return;
            }
            c.attributions_antgaspi = {
              volume_repas_realise: (repas as number | null) ?? null,
            };
          }),
      ),
    );
  }

  const nomsReferentiel = profil.traiteur
    ? new Map<string, string>()
    : await nomsTraiteursReferentiel(
        supabase,
        [
          ...new Set(
            brutes
              .map((e) => e.traiteur_operationnel_organisation_id)
              .filter((v): v is string => !!v),
          ),
        ],
        'evenements.liste.traiteurs_echec',
      );
  const nomTraiteur = (e: LigneBrute): string | null => {
    if (profil.traiteur) {
      const o = un(e.organisations);
      return o?.nom?.trim() || o?.raison_sociale?.trim() || null;
    }
    const id = e.traiteur_operationnel_organisation_id;
    return id ? (nomsReferentiel.get(id) ?? null) : null;
  };

  const bilans = brutes.map((e) => consoliderEvenement(e.collectes ?? []));

  // Déchets labo estimés (§05 R_dechets_labo_estimes) : espace gestionnaire de
  // lieux UNIQUEMENT. Ailleurs la fonction n'est pas appelée : elle rend la
  // valeur à tout programmateur, et valeur ÷ pax donnerait à une agence le
  // coefficient confidentiel d'un traiteur tiers (revue sécurité 2026-10-29).
  // Seulement pour un événement qui a au moins une collecte ZD (arbitrage Val
  // 2026-10-07). NULL = coefficient non communiqué → « — » ; un appel en échec
  // vaut NULL aussi, journalisé.
  const dechetsLabo = await Promise.all(
    brutes.map(async (e, i) => {
      if (espace !== 'gestionnaire') return null;
      if (bilans[i]!.nb_collectes_zd === 0) return null;
      const { data: kg, error: echec } = await supabase.rpc(
        'f_dechets_labo_estimes',
        { p_evenement_id: e.id },
      );
      if (echec) {
        logger.warn('evenements.liste.dechets_labo_echec', {
          evenement_id: e.id,
          code: echec.code,
        });
        return null;
      }
      return kg as number | null;
    }),
  );

  const lignes = brutes.map((e, i): LigneEvenement => {
    const b = bilans[i]!;
    return {
      id: e.id,
      nom_evenement: e.nom_evenement,
      date_evenement: e.date_evenement,
      pax: e.pax,
      client_nom: e.nom_client_organisateur?.trim() || null,
      lieu_nom: un(e.lieux)?.nom ?? null,
      lieu_adresse: adresseLieu(un(e.lieux)),
      traiteur_nom: nomTraiteur(e),
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

  return { ok: true, data: lignes, total: count ?? lignes.length, page };
}
