// Radar du rapport de recyclage ZD (§12 §1.2, gabarit @3) — comparaison kg/convive
// de la collecte au parc Savr. Le rapport ne le porte que si un utilisateur l'a
// choisi dans la fiche collecte, avec les filtres qu'il y a réglés.
//
// Les chiffres viennent de `chargerBenchmarkFiche`, la fonction qui alimente le
// radar de l'écran, appelée sous l'identité du demandeur : le PDF imprime ce que
// l'écran affiche, et hérite des mêmes gardes (accès à la collecte, k-anonymat,
// périmètre du gestionnaire). Aucune lecture en service-role ici.

import type { SupabaseClient } from '@savr/shared/src/supabase-client.js';
import { formatDateParis } from '@savr/shared/src/temps/index.js';

import type {
  UserAuthContext,
  createSupabaseServerClient,
} from '@/lib/api-auth.js';
import {
  chargerBenchmarkFiche,
  type BenchmarkFiche,
} from '@/lib/collectes/benchmark-fiche.js';

import { tailleBracket } from '../dashboard-kpi.js';
import { periodeBenchmark } from '../dashboards/periode-benchmark.js';

type ClientSousRls = ReturnType<typeof createSupabaseServerClient>;

/** Filtres de la fiche collecte (tableau vide = « Tous »). */
export interface FiltresRadar {
  lieu_ids: string[];
  type_evenement_ids: string[];
  taille_evenement_codes: string[];
}

/** Ce que le rapport fige quand il porte le radar. */
export interface RadarRapport {
  benchmark_flux: {
    flux_code: string;
    flux_nom: string;
    collecte_kg_pax: number | null;
    benchmark_kg_pax: number | null;
  }[];
  benchmark_legende: string;
  /** Filtres appliqués (période comprise) : la légende du radar en est tirée. */
  filtres_benchmark: {
    periode_debut: string;
    periode_fin: string;
    lieu_ids: string[] | null;
    type_evenement_ids: string[] | null;
    taille_evenement_codes: string[] | null;
  };
}

export type RadarRapportResultat =
  | { etat: 'ok'; radar: RadarRapport }
  | Exclude<BenchmarkFiche, { etat: 'ok' }>;

// Tailles d'événement en clair (bornes de plateforme.taille_evenement_bracket).
const LIBELLE_TAILLE: Record<string, string> = {
  XS: 'XS (moins de 250 convives)',
  S: 'S (250 à 499 convives)',
  M: 'M (500 à 749 convives)',
  L: 'L (750 à 999 convives)',
  XL: 'XL (1 000 convives et plus)',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_VALEURS = 100;

function listeDe(
  brut: unknown,
  valide: (v: string) => boolean,
): string[] | null {
  if (brut == null) return [];
  if (!Array.isArray(brut) || brut.length > MAX_VALEURS) return null;
  for (const v of brut) if (typeof v !== 'string' || !valide(v)) return null;
  return [...new Set(brut as string[])];
}

/**
 * Lit les filtres envoyés par la fiche collecte. `null` = corps mal formé (une
 * valeur hors format partirait telle quelle dans la fonction SQL).
 */
export function lireFiltresRadar(brut: unknown): FiltresRadar | null {
  if (brut == null) {
    return { lieu_ids: [], type_evenement_ids: [], taille_evenement_codes: [] };
  }
  if (typeof brut !== 'object' || Array.isArray(brut)) return null;
  const b = brut as Record<string, unknown>;
  const lieu_ids = listeDe(b.lieu_ids, (v) => UUID.test(v));
  const type_evenement_ids = listeDe(b.type_evenement_ids, (v) => UUID.test(v));
  const taille_evenement_codes = listeDe(b.taille_evenement_codes, (v) =>
    Object.hasOwn(LIBELLE_TAILLE, v),
  );
  if (!lieu_ids || !type_evenement_ids || !taille_evenement_codes) return null;
  return { lieu_ids, type_evenement_ids, taille_evenement_codes };
}

const ouNull = (a: string[]) => (a.length ? a : null);

/**
 * Filtres du radar quand l'Admin n'en envoie pas (aucun radar affiché dans
 * l'onglet Documents) : le segment de la collecte — même type d'événement, même
 * taille, tous lieux —, les filtres sur lesquels la fiche s'ouvre. Lève si la
 * lecture échoue (jamais « Tous » par défaut d'information).
 */
export async function filtresRadarParDefaut(
  admin: SupabaseClient,
  collecteId: string,
): Promise<FiltresRadar> {
  const { data: collecte, error: colErr } = await admin
    .from('collectes')
    .select('evenements!inner ( pax, type_evenement_id )')
    .eq('id', collecteId)
    .maybeSingle();
  if (colErr) throw colErr;
  const brut = (collecte as { evenements: unknown } | null)?.evenements;
  const evt = (Array.isArray(brut) ? brut[0] : brut) as
    | { pax: number | null; type_evenement_id: string | null }
    | null
    | undefined;
  return {
    lieu_ids: [],
    type_evenement_ids: evt?.type_evenement_id ? [evt.type_evenement_id] : [],
    taille_evenement_codes:
      evt?.pax != null && evt.pax > 0 ? [tailleBracket(evt.pax)] : [],
  };
}

export async function construireRadarRapport(
  supabase: ClientSousRls,
  ctx: UserAuthContext,
  collecteId: string,
  filtres: FiltresRadar,
): Promise<RadarRapportResultat> {
  const fiche = await chargerBenchmarkFiche(supabase, ctx, collecteId, {
    tailleCodes: ouNull(filtres.taille_evenement_codes),
    typeIds: ouNull(filtres.type_evenement_ids),
    lieuIds: ouNull(filtres.lieu_ids),
    // Jamais de filtre « traiteurs » sur une fiche collecte (§06.04).
    traiteurIds: null,
  });
  if (fiche.etat !== 'ok') return fiche;

  // Noms et ordre d'affichage des flux ; libellés des types d'événement filtrés.
  const [fluxRes, typesRes] = await Promise.all([
    supabase
      .from('flux_dechets')
      .select('code, nom, ordre_affichage')
      .order('ordre_affichage'),
    filtres.type_evenement_ids.length
      ? supabase
          .from('types_evenements')
          .select('id, libelle')
          .in('id', filtres.type_evenement_ids)
      : Promise.resolve({ data: [], error: null }),
  ]);
  // Une lecture en échec ne doit pas se lire « aucun flux » : le rapport demandé
  // avec radar sortirait sans, sans que personne le sache.
  if (fluxRes.error) return { etat: 'erreur', erreur: fluxRes.error };
  if (typesRes.error) return { etat: 'erreur', erreur: typesRes.error };

  const benchmark_flux = (
    (fluxRes.data ?? []) as { code: string; nom: string }[]
  ).flatMap((f) => {
    const ligne = fiche.flux[f.code];
    return ligne
      ? [
          {
            flux_code: f.code,
            flux_nom: f.nom,
            collecte_kg_pax:
              ligne.ratio_user != null ? Number(ligne.ratio_user) : null,
            benchmark_kg_pax: ligne.benchmark_kg_pax,
          },
        ]
      : [];
  });

  const { debut, fin } = periodeBenchmark();
  const nbLieux = filtres.lieu_ids.length;
  const libellesTypes = (
    (typesRes.data ?? []) as { id: string; libelle: string }[]
  ).map((t) => t.libelle);
  // Un type filtré dont le libellé n'est pas lisible reste un filtre appliqué :
  // la légende ne dit jamais « tous » dans ce cas.
  const nbTypes = filtres.type_evenement_ids.length;
  const typesTxt = !nbTypes
    ? 'tous'
    : libellesTypes.length === nbTypes
      ? libellesTypes.join(', ')
      : `${nbTypes} sélectionné${nbTypes > 1 ? 's' : ''}`;
  const benchmark_legende = [
    `période ${formatDateParis(debut)} → ${formatDateParis(fin)}`,
    `lieux : ${nbLieux ? `${nbLieux} sélectionné${nbLieux > 1 ? 's' : ''}` : 'tous'}`,
    `type d'événement : ${typesTxt}`,
    `taille : ${
      filtres.taille_evenement_codes.length
        ? filtres.taille_evenement_codes
            .map((c) => LIBELLE_TAILLE[c] ?? c)
            .join(', ')
        : 'toutes'
    }`,
  ].join(' · ');

  return {
    etat: 'ok',
    radar: {
      benchmark_flux,
      benchmark_legende,
      filtres_benchmark: {
        periode_debut: debut,
        periode_fin: fin,
        lieu_ids: ouNull(filtres.lieu_ids),
        type_evenement_ids: ouNull(filtres.type_evenement_ids),
        taille_evenement_codes: ouNull(filtres.taille_evenement_codes),
      },
    },
  };
}
