// Données du rapport de recyclage ZD (gabarit @3), rassemblées au moment où un
// utilisateur le télécharge — décision Val 2026-10-16 : plus aucun rapport n'est
// fabriqué automatiquement, chaque téléchargement le fabrique au clic.
//
// Les données MESURÉES sont celles figées à la clôture : taux, CO₂, taux de
// captation et facteurs d'équivalence sur la collecte, pesées dans
// `collecte_flux`, page 2 = l'instantané `bordereaux_savr` écrit par le batch J+1
// (le même que le bordereau PDF). Noms et logos sont lus au moment du clic.
//
// Lecture en service-role : l'appelant a déjà vérifié, sous l'identité du
// demandeur, que la collecte et son rapport lui sont visibles.

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
  // Convives de LA collecte, imprimés en page 1 et sur le bordereau de la page 2
  // (Val Q5 du 2026-10-24), comme le kg/pax du radar.
  pax: number | null;
  taux_recyclage: number | null;
  co2_evite_kg: number | null;
  co2_induit_kg: number | null;
  co2_net_kg: number | null;
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
  producteur_raison_sociale: string | null;
  producteur_siret: string | null;
  producteur_adresse: string | null;
  transporteur_nom: string | null;
  exutoire_nom: string | null;
  detail_flux: unknown;
  poids_total_kg: number | null;
}

interface FluxRow {
  poids_reel_kg: number | null;
  flux: { nom: string; code: string } | null;
}

export type PayloadRapport =
  | { ok: true; payload: Record<string, unknown> }
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
  const [colRes, bordRes, fluxRes] = await Promise.all([
    admin
      .from('collectes')
      .select(
        `
      date_collecte, pax, taux_recyclage, co2_evite_kg, co2_induit_kg, co2_net_kg,
      energie_primaire_evitee_kwh, co2_facteurs_snapshot, caps_appliques,
      evenements ( ${SELECT_EVENEMENT_RAPPORT} )`,
      )
      .eq('id', collecteId)
      .maybeSingle(),
    admin
      .from('bordereaux_savr')
      .select(
        'numero, date_emission, date_collecte, producteur_raison_sociale, producteur_siret, producteur_adresse, transporteur_nom, exutoire_nom, detail_flux, poids_total_kg',
      )
      .eq('collecte_id', collecteId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from('collecte_flux')
      .select('poids_reel_kg, flux:flux_id ( nom, code )')
      .eq('collecte_id', collecteId),
  ]);
  for (const r of [colRes, bordRes, fluxRes]) {
    if (r.error) return { ok: false, code: 'DB_ERROR', erreur: r.error };
  }

  const collecte = colRes.data as CollecteRapportRow | null;
  const bordereau = bordRes.data as BordereauRow | null;
  const ev = collecte?.evenements;
  if (!collecte || !ev || !bordereau) return { ok: false, code: 'INCOMPLET' };

  const flux = ((fluxRes.data ?? []) as unknown as FluxRow[])
    .filter((f) => f.poids_reel_kg != null)
    .map((f) => ({
      nom: f.flux?.nom ?? '',
      code: f.flux?.code ?? undefined,
      poids_kg: Number(f.poids_reel_kg),
    }));
  const poidsTotalKg = flux.reduce((s, f) => s + f.poids_kg, 0);

  const enTete = await enTeteRapport(ev);
  const { dateEvenement, adresseLieu } = enTete;
  const lieu = ev.lieux;

  return {
    ok: true,
    payload: {
      ...enTete.champs,
      nb_pax: convivesImprimes(collecte.pax),
      taux_recyclage: collecte.taux_recyclage,
      flux,
      poids_total_kg: poidsTotalKg,
      co2_evite_kg: collecte.co2_evite_kg,
      co2_induit_kg: collecte.co2_induit_kg,
      co2_net_kg: collecte.co2_net_kg,
      energie_primaire_evitee_kwh: collecte.energie_primaire_evitee_kwh,
      equivalences: buildEquivalences(
        collecte.co2_evite_kg,
        collecte.energie_primaire_evitee_kwh,
        collecte.co2_facteurs_snapshot,
      ),
      caps_appliques: collecte.caps_appliques ?? undefined,
      options: { benchmark: false },
      // Page 2 = instantané du bordereau émis par le batch J+1.
      bordereau: {
        numero: bordereau.numero ?? '',
        date_emission: dateFr(bordereau.date_emission),
        date_collecte: dateFr(
          bordereau.date_collecte ?? collecte.date_collecte,
        ),
        date_evenement: dateEvenement,
        nom_evenement: ev.nom_evenement,
        lieu_nom: lieu?.nom ?? '',
        lieu_adresse: adresseLieu,
        producteur_raison_sociale: bordereau.producteur_raison_sociale ?? '',
        producteur_siret: bordereau.producteur_siret,
        producteur_adresse: bordereau.producteur_adresse ?? '',
        transporteur_nom: bordereau.transporteur_nom ?? 'Non renseigné',
        exutoire_nom: bordereau.exutoire_nom ?? '',
        nb_pax: convivesImprimes(collecte.pax),
        flux: Array.isArray(bordereau.detail_flux) ? bordereau.detail_flux : [],
        poids_total_kg: Number(bordereau.poids_total_kg ?? poidsTotalKg),
      },
    },
  };
}
