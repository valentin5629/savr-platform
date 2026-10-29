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
// Espaces servis : gestionnaire, traiteur, agence (ceux qui ont une fiche
// collecte client). Seul le gestionnaire a les déchets labo estimés et le logo
// du traiteur.

import { logger } from '@savr/shared/src/logger/index.js';
import {
  createSupabaseServerClient,
  type UserAuthContext,
} from '@/lib/api-auth';
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
} from '@/lib/collectes/fiche-client-types';
import {
  attributionsAgOf,
  embedAttributionsAg,
  type AttributionsAgLues,
} from '@/lib/dashboards/attributions-ag';

type CollecteBrute = CollecteAConsolider & {
  id: string;
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

export async function chargerFicheEvenement(
  id: string,
  ctx: UserAuthContext,
  espace: EspaceClient,
): Promise<ResultatFicheEvenement> {
  const gestionnaire = espace === 'gestionnaire';
  if (!estUuid(id)) return { etat: 'introuvable' };

  const supabase = createSupabaseServerClient();
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
         pax, taux_recyclage, co2_evite_kg,
         type_evenement:types_evenements!type_evenement_id(libelle),
         collecte_flux(poids_reel_kg, flux_dechets!flux_id(code)),
         ${embedAttributionsAg(ctx.role)}),
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
    Promise.all(
      collectes.map((c) => chargerFicheCollecteClient(c.id, ctx, espace)),
    ),
    gestionnaire || !evt.traiteur_operationnel_organisation_id
      ? Promise.resolve(null)
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
  const fiches: FicheCollecteClient[] = [];
  for (const r of resultats) {
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
  const ref = nomsTraiteurs?.data as { id: string; nom: string | null } | null;
  const traiteur = gestionnaire
    ? un(evt.organisations)
    : ref
      ? { id: ref.id, nom: ref.nom, logo_url: null }
      : null;
  const lieu = un(evt.lieux);

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
      ajouter_collecte: evt.organisation_id === ctx.organisationId,
      bilan,
      // Instructions d'accès du lieu de référence (les précisions propres à
      // une collecte sont sur sa fiche).
      lieu_acces_details: lieu?.acces_details?.trim() || null,
      fiches,
    },
  };
}
