// Fiche Événement, commune aux espaces clients (décision Val 2026-10-29 :
// « même fiche pour tous », chaque rôle ne voyant que ce que ses droits lui
// ouvrent). Née dans l'espace gestionnaire (§06.05 §2 « Détail événement »,
// remise par Val le 2026-10-18) : en-tête de l'événement, bilan CONSOLIDÉ sur
// ses collectes et, pour chaque collecte, sa fiche telle que la sert la route
// de la fiche collecte de l'espace (`chargerFicheCollecteClient`) : mêmes
// règles de visibilité (contacts d'une collecte de traiteur tiers masqués,
// référence interne réservée à l'organisation qui a programmé).
//
// Périmètre = RLS de la session (evenements puis collectes), comme la liste.
// Hors périmètre, brouillon ou identifiant mal formé → introuvable, sans
// distinguer « n'existe pas » de « pas à vous ». Brouillon = événement dont les
// collectes sont toutes des brouillons, même filtre que la liste.
//
// Espaces servis : tous (décision Val 2026-10-29). Gestionnaire, traiteur,
// agence : chaque collecte est sa fiche collecte client. Admin et client
// organisateur : carte « légère » par collecte (`ficheLegere` : date, type,
// statut, pax, type d'événement, adresse ; ni contacts, ni chauffeurs, ni
// documents par collecte) — l'Admin ouvre sa fiche collecte Admin au clic (C6),
// l'organisateur n'a pas de fiche collecte (C7). Seul le gestionnaire a les
// déchets labo estimés et le logo du traiteur.

import { logger } from '@savr/shared/src/logger/index.js';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import {
  createSupabaseServerClient,
  type UserAuthContext,
} from '@/lib/api-auth';
import { STATUT_BILAN } from '@/lib/collectes/fiche-client-types';
import type { DbClient } from '@/lib/dashboards/loaders';
import { tailleBracket } from '@/lib/dashboard-kpi';
import {
  adresseLieu,
  consoliderEvenement,
  un,
  type CollecteAConsolider,
  type UnOuListe,
} from '@/lib/evenements-gestionnaire';
import { estUuid } from '@/lib/filtre-csv';
import { typesEvenementDesCollectes } from '@/lib/collectes/types-evenement-collectes';
import { chargerFicheCollecteClient } from '@/lib/collectes/fiche-client';
import type {
  EspaceClient,
  FicheCollecteClient,
  LieuFiche,
} from '@/lib/collectes/fiche-client-types';
import {
  attributionsAgOf,
  embedAttributionsAg,
  type AttributionsAgLues,
} from '@/lib/dashboards/attributions-ag';

type CollecteBrute = CollecteAConsolider & {
  id: string;
  controle_acces_requis: boolean | null;
  heure_collecte: string | null;
  created_at: string | null;
  type_evenement: UnOuListe<{ libelle: string | null }>;
};

type EvenementBrut = {
  id: string;
  organisation_id: string;
  nom_evenement: string | null;
  date_evenement: string | null;
  pax: number | null;
  nom_client_organisateur: string | null;
  lieux: UnOuListe<{
    nom: string | null;
    adresse_acces: string | null;
    code_postal: string | null;
    ville: string | null;
    acces_details: string | null;
  }>;
  traiteur_operationnel_organisation_id: string | null;
  organisations?: UnOuListe<{
    id: string;
    nom: string | null;
    logo_url: string | null;
  }>;
  types_evenements: UnOuListe<{ libelle: string | null }>;
  collectes: CollecteBrute[] | null;
};

export type ResultatFicheEvenement =
  | { etat: 'ok'; data: Record<string, unknown> }
  | { etat: 'introuvable' }
  | { etat: 'erreur'; erreur: unknown };

/** Espace de la fiche : un espace client (fiche collecte client), ou admin / organisateur. */
export type EspaceFiche = EspaceClient | 'admin' | 'organisateur';

/** Appelant : le staff n'a pas d'organisation. */
type Appelant = Pick<UserAuthContext, 'userId' | 'role'> & {
  organisationId: string | null;
};

/**
 * Carte « légère » d'une collecte (Admin, client organisateur) : ce que la
 * fiche événement montre sans fiche collecte client. Rien de personnel ni de
 * logistique : contacts masqués, aucun chauffeur, aucune action, documents
 * absents (l'Admin les a dans sa fiche collecte, l'organisateur sur sa page
 * Documents). Adresse = celle du lieu de l'événement.
 */
function ficheLegere(
  c: CollecteBrute,
  lieu: LieuFiche | null,
  evt: { id: string; nom_evenement: string | null; pax: number | null },
): FicheCollecteClient {
  return {
    id: c.id,
    type: c.type,
    statut: c.statut,
    statut_tms: '',
    tms_reference: null,
    date_collecte: c.date_collecte ?? '',
    heure_collecte: c.heure_collecte,
    pax: c.pax ?? 0,
    controle_acces_requis: !!c.controle_acces_requis,
    informations_completes: true,
    informations_supplementaires: null,
    taux_recyclage: c.taux_recyclage,
    co2_evite_kg: c.co2_evite_kg,
    realisee_at: null,
    aucun_repas_motif: null,
    type_evenement_id: null,
    type_evenement: un(c.type_evenement),
    contacts_visibles: false,
    contact_principal_nom: null,
    contact_principal_telephone: null,
    contact_secours_nom: null,
    contact_secours_telephone: null,
    taille_bracket: null,
    evenement: {
      id: evt.id,
      nom_evenement: evt.nom_evenement,
      pax: evt.pax,
      nom_client_organisateur: null,
      reference_affaire: null,
      lieu,
    },
    tournees: [],
    coordonnees_urgence_demandee: false,
    bilan_flux: null,
    repas_donnes: null,
    association: null,
    rapport_rse_disponible: false,
    rapport_mis_a_jour_at: null,
    rapport_reserve_donneur_ordre: false,
    rapport_etat: 'a_venir',
    actions: { modifier: 'absent', annuler: 'absent', annulation: null },
  };
}

export async function chargerFicheEvenement(
  id: string,
  ctx: Appelant,
  espace: EspaceFiche,
): Promise<ResultatFicheEvenement> {
  const gestionnaire = espace === 'gestionnaire';
  const admin = espace === 'admin';
  const organisateur = espace === 'organisateur';
  // Espace de fiche collecte client, quand le rôle en a une.
  const espaceClient: EspaceClient | null =
    admin || organisateur ? null : espace;
  if (!estUuid(id)) return { etat: 'introuvable' };

  // Staff : service_role, comme la liste et les routes Admin ; les autres
  // rôles sous leur session (RLS).
  const supabase = (
    admin ? createAdminSupabaseClient() : createSupabaseServerClient()
  ) as DbClient;
  // Chemins de lecture imposés par la RLS (cf. PROFILS) : le traiteur passe,
  // pour le gestionnaire, par la vue restreinte v_traiteurs_gestionnaire (id,
  // nom, logo ; le logo est une clé R2 servie par le proxy …/traiteurs/[id]/logo
  // et ne sort pas de la route) ; pour le traiteur et l'agence, par
  // v_referentiel_traiteurs (id, nom), sans logo.
  const { data, error } = await supabase
    .from('evenements')
    .select(
      `id, organisation_id, nom_evenement, date_evenement, pax,
       nom_client_organisateur,
       lieux!lieu_id(nom, adresse_acces, code_postal, ville, acces_details),
       traiteur_operationnel_organisation_id,
       ${gestionnaire ? 'organisations:v_traiteurs_gestionnaire!traiteur_operationnel_organisation_id(id, nom, logo_url),' : ''}
       types_evenements!type_evenement_id(libelle),
       collectes(id, type, statut, date_collecte, heure_collecte, created_at,
         pax, taux_recyclage, co2_evite_kg, controle_acces_requis,
         type_evenement:types_evenements!type_evenement_id(libelle),
         collecte_flux(poids_reel_kg, flux_dechets!flux_id(code))
         ${organisateur ? '' : `, ${embedAttributionsAg(ctx.role)}`}),
       hors_brouillon:collectes(id)`,
    )
    .eq('id', id)
    .not('date_evenement', 'is', null)
    .neq('hors_brouillon.statut', 'brouillon')
    .or('hors_brouillon.not.is.null,collectes.is.null')
    .maybeSingle();

  if (error) return { etat: 'erreur', erreur: error };
  if (!data) return { etat: 'introuvable' };

  const evt = data as unknown as EvenementBrut;
  // Attributions à plat, quelle que soit la source (vue ou table), pour le
  // bilan (association_nom, association_ville).
  for (const c of evt.collectes ?? [])
    c.attributions_antgaspi = attributionsAgOf(
      c.attributions_antgaspi as AttributionsAgLues | undefined,
    ).map((a) => {
      const asso = un(a.associations);
      return {
        volume_repas_realise: a.volume_repas_realise,
        association_id: a.association_id,
        association_nom: asso?.nom ?? null,
        association_ville: asso?.ville ?? null,
      };
    });
  // Client organisateur : aa_select lui refuse les attributions ; repas lus
  // par le helper C-1-safe, pour les seules collectes AG clôturées.
  if (organisateur)
    await Promise.all(
      (evt.collectes ?? [])
        .filter((c) => c.type === 'anti_gaspi' && c.statut === STATUT_BILAN)
        .map(async (c) => {
          const { data: repas, error: echec } = await supabase.rpc(
            'f_volume_repas_realise',
            { p_collecte_id: c.id },
          );
          if (echec) {
            logger.warn('evenements.fiche.repas_echec', {
              collecte_id: c.id,
              code: echec.code,
            });
            return;
          }
          c.attributions_antgaspi = {
            volume_repas_realise: (repas as number | null) ?? null,
          };
        }),
    );
  const collectes = [...(evt.collectes ?? [])].sort(
    (a, b) =>
      (a.date_collecte ?? '').localeCompare(b.date_collecte ?? '') ||
      (a.heure_collecte ?? '').localeCompare(b.heure_collecte ?? '') ||
      a.id.localeCompare(b.id),
  );
  const bilan = consoliderEvenement(collectes);

  // Déchets labo estimés : gestionnaire SEUL (§05 R_dechets_labo_estimes ;
  // ailleurs valeur ÷ pax livrerait le coefficient du traiteur), seulement si
  // l'événement a au moins une collecte ZD (arbitrage Val 2026-10-07). Et une
  // fiche par collecte, sous la même session : rien de plus que ce que la fiche
  // collecte lui servirait. Lectures lancées ensemble.
  const [labo, resultats, nomsTraiteurs] = await Promise.all([
    gestionnaire && bilan.nb_collectes_zd > 0
      ? supabase.rpc('f_dechets_labo_estimes', { p_evenement_id: id })
      : Promise.resolve(null),
    espaceClient
      ? Promise.all(
          collectes.map((c) =>
            chargerFicheCollecteClient(
              c.id,
              ctx as UserAuthContext,
              espaceClient,
            ),
          ),
        )
      : Promise.resolve(null),
    gestionnaire || !evt.traiteur_operationnel_organisation_id
      ? Promise.resolve(null)
      : admin
        ? // Staff : nom de toute organisation (shadow comprise), en service_role.
          supabase
            .from('organisations')
            .select('id, nom, raison_sociale')
            .eq('id', evt.traiteur_operationnel_organisation_id)
            .maybeSingle()
        : supabase
            .from('v_referentiel_traiteurs')
            .select('id, nom')
            .eq('id', evt.traiteur_operationnel_organisation_id)
            .maybeSingle(),
  ]);
  let dechetsLaboKg: number | null = null;
  if (labo?.error)
    logger.warn('evenements.fiche.dechets_labo_echec', {
      evenement_id: id,
      code: labo.error.code,
    });
  else if (labo) dechetsLaboKg = labo.data as number | null;

  // Jamais une fiche à trous : une collecte lue avec l'événement mais dont la
  // fiche ne se charge pas (erreur, ou disparue entre les deux lectures) fait
  // échouer la fiche, plutôt qu'un bilan sur N collectes et N−1 cartes.
  const lieu = un(evt.lieux);
  const lieuFiche: LieuFiche | null = lieu
    ? {
        id: '',
        nom: lieu.nom ?? '',
        adresse_acces: lieu.adresse_acces,
        code_postal: lieu.code_postal,
        ville: lieu.ville,
        acces_details: lieu.acces_details,
      }
    : null;
  const fiches: FicheCollecteClient[] = [];
  if (!resultats)
    for (const c of collectes) fiches.push(ficheLegere(c, lieuFiche, evt));
  for (const r of resultats ?? []) {
    if (!('fiche' in r))
      return {
        etat: 'erreur',
        erreur:
          'erreur' in r ? r.erreur : new Error('fiche collecte introuvable'),
      };
    fiches.push(r.fiche);
  }

  // Nom du traiteur hors gestionnaire : référentiel (traiteur hors
  // référentiel = sans nom). Lecture en échec : journalisée, fiche servie.
  if (nomsTraiteurs?.error)
    logger.warn('evenements.fiche.traiteur_echec', {
      evenement_id: id,
      code: nomsTraiteurs.error.code,
    });
  const ref = nomsTraiteurs?.data as {
    id: string;
    nom: string | null;
    raison_sociale?: string | null;
  } | null;
  const traiteur = gestionnaire
    ? un(evt.organisations)
    : ref
      ? {
          id: ref.id,
          nom: ref.nom?.trim() || ref.raison_sociale?.trim() || null,
          logo_url: null,
        }
      : null;

  return {
    etat: 'ok',
    data: {
      id: evt.id,
      nom_evenement: evt.nom_evenement,
      date_evenement: evt.date_evenement,
      pax: evt.pax,
      taille_bracket: tailleBracket(evt.pax ?? 0),
      // Types de SES COLLECTES, dans l'ordre de la collecte n°1 (décision Val
      // 2026-10-24, lot C1, Q2) ; la copie de l'événement n'est qu'un repli.
      type_evenement: typesEvenementDesCollectes(
        collectes,
        un(evt.types_evenements)?.libelle ?? null,
      ),
      // « Client Organisateur si renseigné par le traiteur » (§06.05 §2).
      client_nom: evt.nom_client_organisateur?.trim() || null,
      lieu_nom: lieu?.nom ?? null,
      lieu_adresse: adresseLieu(lieu),
      traiteur: traiteur
        ? { id: traiteur.id, nom: traiteur.nom, a_logo: !!traiteur.logo_url }
        : null,
      dechets_labo_kg: dechetsLaboKg,
      // « Ajouter une collecte » : sur ses propres programmations seulement —
      // la route d'ajout répond 404 sur l'événement d'un traiteur tiers tenu
      // sur ses lieux.
      // Admin et client organisateur : jamais (C6/C7).
      ajouter_collecte:
        !!espaceClient && evt.organisation_id === ctx.organisationId,
      bilan,
      // Instructions d'accès du lieu de référence (les précisions propres à
      // une collecte sont sur sa fiche).
      lieu_acces_details: lieu?.acces_details?.trim() || null,
      fiches,
    },
  };
}
