// Contexte visuel des deux « Rapport de don » d'une collecte AG (gabarits
// attestation-don@5 et rapport-evenement-sans-excedent@3, maquettes validées par
// Val le 2026-11-16), lu par le worker PDF au moment du rendu.
//
// Pourquoi au rendu : un même rapport part de trois chemins (lot des attestations,
// trigger SQL de correction de volume qui prépare son propre contenu, et
// régénération qui reprend le dernier contenu figé). Lire ici, une seule fois, le
// lieu, les convives, les logos, l'association, la photo cochée et les
// associations proches donne le même rapport par les trois chemins, avec les
// données du moment (comme le logo du client déjà, décision Val 2026-10-30).
// Les chiffres (poids, repas, CO₂e) restent ceux figés pour la version.
//
// Best-effort, comme les logos : une lecture en échec n'empêche jamais le rapport,
// le gabarit retombe sur ce qu'il a (initiale à la place d'un logo, pas de photo,
// pas d'associations proches).

import type { SupabaseClient } from '@savr/shared/src/supabase-client.js';

import { ENTITE_PHOTO_COLLECTE } from '@/lib/collectes/photos-client.js';
import { convivesImprimes } from './convives-imprimes.js';
import { resolveRapportLogos } from './logo-cascade.js';
import {
  bornerLogosRapport,
  logoKeyToDataUri,
  makeLogoResolver,
} from './logo-inline.js';
import {
  SELECT_LOGOS_EVENEMENT,
  cascadeDepuisEvenement,
  type LogosEvenementRow,
} from './logo-rapport-de-don.js';
import { getObjectBytes } from './r2-client.js';

/**
 * Plafond de la photo inlinée. Le corps envoyé au renderer est borné à 8 Mo
 * (apps/pdf-renderer/src/app.ts) : photo (≈ 3,3 Mo en base64) + deux logos du
 * bandeau (1,4 Mo) + logo de l'association (1,33 Mo) restent dessous. Au-delà, le
 * rapport sort sans photo plutôt que de ne pas sortir.
 */
export const MAX_PHOTO_BYTES = 2_500_000;
const MIME_PHOTO = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** Associations montrées sur le rapport sans excédent (Val 2026-11-16). */
export const NB_ASSOCIATIONS_PROCHES = 2;
// Le référentiel compte quelques dizaines d'associations : borne de lecture large.
const MAX_ASSOCIATIONS_LUES = 1000;

type Nombre = number | string | null;
const nombre = (v: Nombre | undefined): number | null =>
  v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);

interface AssociationRow {
  nom: string;
  ville: string | null;
  logo_url: string | null;
  description_rapport_impact: string | null;
}

/** Logos client et traiteur du bandeau, inlinés et bornés ensemble. */
async function logosBandeau(ev: LogosEvenementRow) {
  const cles = resolveRapportLogos(cascadeDepuisEvenement(ev));
  const resoudre = makeLogoResolver();
  const logos = bornerLogosRapport({
    client: await resoudre(cles.client),
    traiteur: await resoudre(cles.traiteur),
  });
  return { logo_client_url: logos.client, logo_traiteur_url: logos.traiteur };
}

/**
 * Photo de la collecte choisie par Savr pour le client (rang 1, sinon 2), en data
 * URI. Seul un objet du dossier des photos de CETTE collecte est lu.
 */
export async function photoCochee(
  supabase: SupabaseClient,
  collecteId: string,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .schema('shared')
      .from('fichiers')
      .select('bucket, key, content_type')
      .eq('entity_type', ENTITE_PHOTO_COLLECTE)
      .eq('entity_id', collecteId)
      .is('deleted_at', null)
      .not('rang_client', 'is', null)
      .order('rang_client', { ascending: true })
      .limit(1);
    if (error) return null;
    const ligne = (data ?? [])[0] as
      | { bucket: string; key: string; content_type: string | null }
      | undefined;
    if (!ligne) return null;
    const mime = (ligne.content_type ?? '').toLowerCase();
    if (!MIME_PHOTO.has(mime)) return null;
    if (!ligne.key.startsWith(`photos/collectes/${collecteId}/`)) return null;
    // `getObjectBytes` refuse un bucket autre que celui de l'environnement.
    const octets = await getObjectBytes(`${ligne.bucket}/${ligne.key}`);
    if (octets.byteLength > MAX_PHOTO_BYTES) return null;
    return `data:${mime};base64,${octets.toString('base64')}`;
  } catch {
    return null;
  }
}

interface CollecteDonRow {
  pax: number | null;
  co2_facteurs_snapshot: Record<string, unknown> | null;
  evenements: (LogosEvenementRow & { lieux: { nom: string } | null }) | null;
}

/**
 * Rapport de don avec excédents : lieu, convives, logos client et traiteur,
 * association de l'attestation (nom, ville, logo, description), photo cochée et
 * facteur CO₂e de la collecte.
 *
 * Le contenu préparé par le trigger SQL de correction de volume ne porte pas de
 * champ logo : son poids est alors relu sur la nouvelle version de l'attestation
 * (le trigger reprend celui de la version précédente).
 */
export async function completerRapportDeDon(
  supabase: SupabaseClient,
  attestationId: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  let complet = payload;
  try {
    const { data: att, error } = await supabase
      .from('attestations_don')
      .select('collecte_id, association_id, poids_kg')
      .eq('id', attestationId)
      .maybeSingle();
    const ligne = att as {
      collecte_id: string;
      association_id: string | null;
      poids_kg: Nombre;
    } | null;
    if (error || !ligne) return payload;
    const poidsVersion = nombre(ligne.poids_kg);
    if (!('logo_client_url' in payload) && poidsVersion != null) {
      complet = { ...complet, poids_kg: poidsVersion };
    }

    const [colRes, assoRes, photo] = await Promise.all([
      supabase
        .from('collectes')
        .select(
          `pax, co2_facteurs_snapshot,
          evenements ( lieux ( nom ), ${SELECT_LOGOS_EVENEMENT} )`,
        )
        .eq('id', ligne.collecte_id)
        .maybeSingle(),
      ligne.association_id
        ? supabase
            .from('associations')
            .select('nom, ville, logo_url, description_rapport_impact')
            .eq('id', ligne.association_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      photoCochee(supabase, ligne.collecte_id),
    ]);

    complet = { ...complet, photo_url: photo };

    const col = colRes.error ? null : (colRes.data as CollecteDonRow | null);
    if (col) {
      const facteur = nombre(
        col.co2_facteurs_snapshot?.facteur_co2_evite_par_repas_kg as Nombre,
      );
      complet = {
        ...complet,
        nb_pax: convivesImprimes(col.pax),
        co2_facteur_repas_kg: facteur,
        ...(col.evenements
          ? {
              lieu_nom: col.evenements.lieux?.nom ?? null,
              ...(await logosBandeau(col.evenements)),
            }
          : {}),
      };
    }

    const asso = assoRes.error ? null : (assoRes.data as AssociationRow | null);
    if (asso) {
      complet = {
        ...complet,
        association_ville: asso.ville,
        association_description: asso.description_rapport_impact,
        association_logo_url: await logoKeyToDataUri(asso.logo_url),
      };
    }
    return complet;
  } catch {
    return complet;
  }
}

interface LieuCoordonnees {
  latitude: Nombre;
  longitude: Nombre;
  region: string | null;
}
interface AssociationProcheRow extends AssociationRow, LieuCoordonnees {}

/** Distance en km entre deux points (formule de haversine). */
function distanceKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

const coordonnees = (l: LieuCoordonnees) => {
  const lat = nombre(l.latitude);
  const lon = nombre(l.longitude);
  return lat != null && lon != null ? { lat, lon } : null;
};

/**
 * Les associations actives les plus proches du lieu (Val 2026-11-16). Lieu sans
 * coordonnées, ou aucune association géolocalisée : celles de la région du lieu.
 * Fonction pure.
 */
export function associationsLesPlusProches(
  lieu: LieuCoordonnees | null,
  associations: AssociationProcheRow[],
): AssociationProcheRow[] {
  const centre = lieu ? coordonnees(lieu) : null;
  const situees = centre
    ? associations
        .map((a) => ({ a, point: coordonnees(a) }))
        .filter(
          (
            x,
          ): x is {
            a: AssociationProcheRow;
            point: { lat: number; lon: number };
          } => x.point != null,
        )
        .map((x) => ({ a: x.a, d: distanceKm(centre, x.point) }))
        .sort((x, y) => x.d - y.d || x.a.nom.localeCompare(y.a.nom, 'fr'))
        .map((x) => x.a)
    : [];
  if (situees.length) return situees.slice(0, NB_ASSOCIATIONS_PROCHES);
  if (!lieu?.region) return [];
  return associations
    .filter((a) => a.region === lieu.region)
    .sort((x, y) => x.nom.localeCompare(y.nom, 'fr'))
    .slice(0, NB_ASSOCIATIONS_PROCHES);
}

interface CollecteSansExcedentRow {
  evenements:
    | (Omit<LogosEvenementRow, 'organisations'> & {
        organisations: {
          nom: string | null;
          type?: string | null;
          logo_url: string | null;
        } | null;
        lieux: LieuCoordonnees | null;
      })
    | null;
}

/**
 * Rapport sans excédent : logos client et traiteur, organisation qui a mandaté
 * Savr (programmatrice de la collecte) et les deux associations actives les plus
 * proches du lieu (nom, ville, logo, description).
 */
export async function completerRapportSansExcedent(
  supabase: SupabaseClient,
  rapportId: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  try {
    const { data: rapport, error } = await supabase
      .from('rapports_rse')
      .select('collecte_id')
      .eq('id', rapportId)
      .maybeSingle();
    const collecteId = (rapport as { collecte_id: string } | null)?.collecte_id;
    if (error || !collecteId) return payload;

    const [colRes, assosRes] = await Promise.all([
      supabase
        .from('collectes')
        .select(
          `evenements (
            logo_client_organisateur_url,
            organisations!organisation_id ( nom, type, logo_url ),
            traiteur_operationnel:organisations!traiteur_operationnel_organisation_id ( logo_url ),
            client_organisateur:organisations!client_organisateur_organisation_id ( logo_url ),
            lieux ( latitude, longitude, region )
          )`,
        )
        .eq('id', collecteId)
        .maybeSingle(),
      supabase
        .from('associations')
        .select(
          'nom, ville, logo_url, description_rapport_impact, latitude, longitude, region',
        )
        .eq('actif', true)
        .limit(MAX_ASSOCIATIONS_LUES),
    ]);

    const ev = colRes.error
      ? null
      : ((colRes.data as CollecteSansExcedentRow | null)?.evenements ?? null);
    let complet: Record<string, unknown> = payload;
    if (ev) {
      complet = {
        ...complet,
        mandant_nom: ev.organisations?.nom ?? null,
        ...(await logosBandeau(ev as LogosEvenementRow)),
      };
    }
    if (!assosRes.error) {
      const proches = associationsLesPlusProches(
        ev?.lieux ?? null,
        (assosRes.data ?? []) as AssociationProcheRow[],
      );
      complet = {
        ...complet,
        associations_proches: await Promise.all(
          proches.map(async (a) => ({
            nom: a.nom,
            ville: a.ville,
            logo_url: await logoKeyToDataUri(a.logo_url),
            description: a.description_rapport_impact,
          })),
        ),
      };
    }
    return complet;
  } catch {
    return payload;
  }
}
