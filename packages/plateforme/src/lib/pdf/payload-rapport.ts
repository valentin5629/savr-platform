// Données du rapport de recyclage ZD (gabarit @4), rassemblées au moment où un
// utilisateur le télécharge — décision Val 2026-10-16 : plus aucun rapport n'est
// fabriqué automatiquement, chaque téléchargement le fabrique au clic.
//
// Les données MESURÉES sont celles figées à la clôture : taux, CO₂, taux de
// captation, facteurs d'équivalence et forfait transport sur la collecte, pesées
// dans `collecte_flux`. Le numéro et la date du bordereau viennent de
// l'instantané `bordereaux_savr`. Le code déchet, l'exutoire habituel et le code
// R/D de chaque flux sont lus dans le référentiel `flux_dechets` au clic et
// figés dans le PDF fabriqué. Noms et logos sont lus au moment du clic.
//
// Lecture en service-role : l'appelant a déjà vérifié, sous l'identité du
// demandeur, que la collecte et son rapport lui sont visibles. La page 2 est
// l'annexe technique (décisions Val 2026-11-12) : elle remplace le bordereau de
// pesée (C1) et suit le rapport, numéro du bordereau compris, quel que soit le
// demandeur (C2) — la règle qui retirait la page 2 quand le demandeur ne lisait
// pas le bordereau sous sa RLS (2026-10-27) ne vaut plus.

import type { SupabaseClient } from '@savr/shared/src/supabase-client.js';
import { formatDateParis } from '@savr/shared/src/temps/index.js';

import { resolveRapportLogos } from './logo-cascade.js';
import { bornerLogosRapport, makeLogoResolver } from './logo-inline.js';
import { convivesImprimes } from './convives-imprimes.js';

/**
 * Équivalences pédagogiques du rapport (§12 §1.2). Les facteurs sont figés dans
 * `co2_facteurs_snapshot.equivalences` à la clôture (reproductibilité) :
 *   - km_voiture = kgCO₂e par km → compte = co2_evite_kg / facteur
 *   - foyer_kwh = kWh/an d'un foyer → compte = energie_primaire_evitee_kwh / facteur
 * L'équivalence « repas avec bœuf » n'est plus imprimée (décision Val 2026-10-02).
 * Retourne undefined si pas de CO₂ évité ou pas de snapshot (équivalences omises).
 */
export function buildEquivalences(
  co2EviteKg: number | null,
  energiePrimaireKwh: number | null,
  snapshot: Record<string, unknown> | null,
):
  | {
      km_voiture: number | null;
      foyer: number | null;
    }
  | undefined {
  if (co2EviteKg == null || !snapshot) return undefined;
  const eqv = (snapshot as { equivalences?: Record<string, unknown> })
    .equivalences;
  if (!eqv) return undefined;
  const feKm = Number(eqv.km_voiture);
  const feFoyer = Number(eqv.foyer_kwh);
  return {
    km_voiture: feKm > 0 ? Math.round(co2EviteKg / feKm) : null,
    foyer:
      energiePrimaireKwh != null && feFoyer > 0
        ? Math.round(energiePrimaireKwh / feFoyer)
        : null,
  };
}

interface CollecteRapportRow {
  date_collecte: string;
  // Convives de LA collecte, imprimés en page 1 et dans l'annexe (Val Q5 du
  // 2026-10-24), comme le kg/pax du radar.
  pax: number | null;
  taux_recyclage: number | null;
  co2_evite_kg: number | null;
  co2_induit_kg: number | null;
  energie_primaire_evitee_kwh: number | null;
  co2_facteurs_snapshot: Record<string, unknown> | null;
  caps_appliques: Record<string, unknown> | null;
  evenements: EvenementRapportRow | null;
}

/** Événement tel que l'en-tête des rapports le lit (cf. SELECT_EVENEMENT_RAPPORT). */
export interface EvenementRapportRow {
  nom_evenement: string;
  date_evenement: string;
  logo_client_organisateur_url: string | null;
  nom_client_organisateur: string | null;
  organisations: {
    nom: string;
    type: string | null;
    logo_url: string | null;
  } | null;
  traiteur_operationnel: { nom: string; logo_url: string | null } | null;
  client_organisateur: { nom: string; logo_url: string | null } | null;
  lieux: {
    nom: string;
    adresse_acces: string | null;
    code_postal: string | null;
    ville: string | null;
  } | null;
}

interface BordereauRow {
  numero: string | null;
  date_emission: string | null;
  date_collecte: string | null;
}

interface FluxRow {
  poids_reel_kg: number | null;
  flux: { code: string } | null;
}

/** Ligne du référentiel `flux_dechets` (5 flux, contrainte CHECK sur le code). */
interface ReferentielFluxRow {
  code: string;
  nom: string;
  code_dechet_europeen: string | null;
  exutoire: string | null;
  exutoire_adresse: string | null;
  code_traitement: string | null;
  filiere_valorisation: string | null;
}

/**
 * Commune d'une adresse du référentiel, au format « voie, CP ville » : ce qui
 * suit la dernière virgule, sans le code postal. Autre forme : null.
 */
export function communeDeLAdresse(adresse: string | null): string | null {
  if (!adresse) return null;
  const fin = adresse.slice(adresse.lastIndexOf(',') + 1).trim();
  const m = /^\d{5}\s+(.+)$/.exec(fin);
  return m?.[1]?.trim() || null;
}

/**
 * Forfait transport ajouté par prudence au CO₂ induit, figé à la clôture dans
 * `co2_facteurs_snapshot.forfait_collecte` (km aller-retour × kg CO₂e/km).
 */
export function forfaitTransport(
  snapshot: Record<string, unknown> | null,
): { km: number; fe_camion_kg_km: number } | null {
  const f = (snapshot as { forfait_collecte?: Record<string, unknown> } | null)
    ?.forfait_collecte;
  if (!f) return null;
  const km = Number(f.km);
  const fe = Number(f.fe_camion);
  return Number.isFinite(km) && Number.isFinite(fe) && km > 0 && fe > 0
    ? { km, fe_camion_kg_km: fe }
    : null;
}

export type PayloadRapport =
  | {
      ok: true;
      payload: Record<string, unknown>;
      /** Date de la collecte (« JJ/MM/AAAA »), pour le nom du fichier. */
      dateCollecte: string;
    }
  /** Collecte sans événement ou sans bordereau : rien de mesuré à imprimer. */
  | { ok: false; code: 'INCOMPLET' }
  | { ok: false; code: 'DB_ERROR'; erreur: unknown };

/** Date « JJ/MM/AAAA » d'une valeur DATE ou d'un instant, à l'heure de Paris. */
const dateFr = (v: string | null | undefined) => (v ? formatDateParis(v) : '');

/** Embed PostgREST de l'événement lu par l'en-tête des rapports. */
export const SELECT_EVENEMENT_RAPPORT = `
        nom_evenement, date_evenement,
        logo_client_organisateur_url, nom_client_organisateur,
        organisations!organisation_id ( nom, type, logo_url ),
        traiteur_operationnel:organisations!traiteur_operationnel_organisation_id ( nom, logo_url ),
        client_organisateur:organisations!client_organisateur_organisation_id ( nom, logo_url ),
        lieux ( nom, adresse_acces, code_postal, ville )
      `;

/**
 * En-tête commun aux rapports d'une collecte et d'un événement : client,
 * traiteur, date, lieu et logos (lus au moment du clic).
 */
export async function enTeteRapport(ev: EvenementRapportRow) {
  const lieu = ev.lieux;
  const adresseLieu = lieu
    ? [lieu.adresse_acces, lieu.code_postal, lieu.ville]
        .filter(Boolean)
        .join(' ')
    : '';
  // Producteur = traiteur opérationnel si désigné, sinon le programmateur.
  const traiteur = ev.traiteur_operationnel ?? ev.organisations;

  const logos = resolveRapportLogos({
    programmateur: ev.organisations,
    client_organisateur: ev.client_organisateur,
    evenement_logo_client_url: ev.logo_client_organisateur_url,
    traiteur_operationnel: traiteur,
  });
  const resoudre = makeLogoResolver();
  // Deux logos lourds dépasseraient le corps accepté par le renderer.
  const logosInline = bornerLogosRapport({
    client: await resoudre(logos.client),
    traiteur: await resoudre(logos.traiteur),
  });

  const dateEvenement = dateFr(ev.date_evenement);

  return {
    dateEvenement,
    adresseLieu,
    champs: {
      client_nom:
        ev.nom_client_organisateur?.trim() ||
        ev.client_organisateur?.nom ||
        undefined,
      nom_evenement: ev.nom_evenement,
      traiteur_nom: traiteur?.nom ?? '',
      date_evenement: dateEvenement,
      lieu_nom: lieu?.nom ?? '',
      lieu_adresse: adresseLieu,
      logo_client_url: logosInline.client ?? undefined,
      logo_traiteur_url: logosInline.traiteur ?? undefined,
    },
  };
}

/**
 * Rapport de recyclage d'une collecte ZD, version SANS radar. L'appelant ajoute
 * le radar quand le demandeur l'a coché (cf. rapport-a-la-demande).
 */
export async function construirePayloadRapport(
  admin: SupabaseClient,
  collecteId: string,
): Promise<PayloadRapport> {
  const [colRes, bordRes, fluxRes, refRes] = await Promise.all([
    admin
      .from('collectes')
      .select(
        `
      date_collecte, pax, taux_recyclage, co2_evite_kg, co2_induit_kg,
      energie_primaire_evitee_kwh, co2_facteurs_snapshot, caps_appliques,
      evenements ( ${SELECT_EVENEMENT_RAPPORT} )`,
      )
      .eq('id', collecteId)
      .maybeSingle(),
    admin
      .from('bordereaux_savr')
      .select('numero, date_emission, date_collecte')
      .eq('collecte_id', collecteId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
    // borne-par-nature: une ligne par flux de la collecte, 5 au plus
    admin
      .from('collecte_flux')
      .select('poids_reel_kg, flux:flux_id ( code )')
      .eq('collecte_id', collecteId),
    // borne-par-nature: 5 flux, contrainte CHECK sur flux_dechets.code
    admin
      .from('flux_dechets')
      .select(
        'code, nom, code_dechet_europeen, exutoire, exutoire_adresse, code_traitement, filiere_valorisation',
      )
      .order('ordre_affichage'),
  ]);
  for (const r of [colRes, bordRes, fluxRes, refRes]) {
    if (r.error) return { ok: false, code: 'DB_ERROR', erreur: r.error };
  }

  const collecte = colRes.data as CollecteRapportRow | null;
  const bordereau = bordRes.data as BordereauRow | null;
  const ev = collecte?.evenements;
  if (!collecte || !ev || !bordereau) return { ok: false, code: 'INCOMPLET' };

  // Les 5 flux du référentiel, toujours imprimés : un flux non pesé vaut 0 kg
  // (C5, Val 2026-11-12).
  const poidsParCode = new Map<string, number>();
  for (const f of (fluxRes.data ?? []) as unknown as FluxRow[]) {
    if (f.flux?.code && f.poids_reel_kg != null) {
      poidsParCode.set(
        f.flux.code,
        (poidsParCode.get(f.flux.code) ?? 0) + Number(f.poids_reel_kg),
      );
    }
  }
  const flux = ((refRes.data ?? []) as ReferentielFluxRow[]).map((r) => ({
    nom: r.nom,
    code: r.code,
    poids_kg: poidsParCode.get(r.code) ?? 0,
    code_dechet_europeen: r.code_dechet_europeen,
    exutoire: r.exutoire,
    exutoire_commune: communeDeLAdresse(r.exutoire_adresse),
    code_traitement: r.code_traitement,
    filiere_valorisation: r.filiere_valorisation,
  }));
  const poidsTotalKg = flux.reduce((s, f) => s + f.poids_kg, 0);

  const enTete = await enTeteRapport(ev);

  return {
    ok: true,
    dateCollecte: dateFr(bordereau.date_collecte ?? collecte.date_collecte),
    payload: {
      ...enTete.champs,
      nb_pax: convivesImprimes(collecte.pax),
      taux_recyclage: collecte.taux_recyclage,
      flux,
      poids_total_kg: poidsTotalKg,
      // Induit et évité présentés séparément, jamais soustraits (plus de net).
      co2_evite_kg: collecte.co2_evite_kg,
      co2_induit_kg: collecte.co2_induit_kg,
      energie_primaire_evitee_kwh: collecte.energie_primaire_evitee_kwh,
      equivalences: buildEquivalences(
        collecte.co2_evite_kg,
        collecte.energie_primaire_evitee_kwh,
        collecte.co2_facteurs_snapshot,
      ),
      forfait_transport: forfaitTransport(collecte.co2_facteurs_snapshot),
      caps_appliques: collecte.caps_appliques ?? undefined,
      bordereau_numero: bordereau.numero ?? '',
      bordereau_date_emission: dateFr(bordereau.date_emission),
      options: { benchmark: false },
    },
  };
}
