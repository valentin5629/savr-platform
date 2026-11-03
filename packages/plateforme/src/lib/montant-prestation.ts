// Montant de la prestation d'une collecte, indépendant de la facturation
// (décision Val 2026-11-03) : liste Admin Collectes (colonne « Montant ») et
// section Revenus du Dashboard Admin.
//
// Mêmes règles que la facturation par collecte, calculées en lot :
//   - ZD : grille de l'organisation programmatrice active à la date de la
//     collecte, sinon grille par défaut ; palier du pax de la collecte ;
//     prix = base + pax × prix par couvert, moins la plus élevée des remises
//     éligibles (cf. `calculer_tarif_zd`, `facteurRemisesNegociees`) ;
//   - AG avec pack débité (`collectes.pack_antgaspi_id`) : prix unitaire du
//     pack, sinon montant total ÷ crédits initiaux (cf. `calculer_tarif_ag`) ;
//   - AG sans pack : tarif unitaire public moins la plus élevée des remises AG.
// Montant introuvable (pax absent, aucune grille ou aucun palier) = null.
//
// Un nombre fixe de requêtes, quel que soit le nombre de collectes : la page
// Collectes et le Dashboard en lisent des centaines.

import type { SupabaseClient } from '@savr/shared/src/supabase-client.js';
import { erreurInterne } from '@/lib/api-helpers.js';

export interface PackPrix {
  prix_unitaire_ht: number | null;
  montant_total_ht: number | null;
  credits_initiaux: number | null;
}

export interface CollectePrestation {
  type: string;
  pax: number | null;
  /** Jour de la collecte, `YYYY-MM-DD`. */
  date_collecte: string;
  organisation_id: string | null;
  lieu_id: string | null;
  /** Pack débité par la collecte (embed de `pack_antgaspi_id`). */
  pack: PackPrix | null;
}

/**
 * Statuts comptés dans les Revenus du Dashboard Admin (Val 2026-11-03) :
 * collectes programmées et réalisées. Exclus : brouillon, annulation demandée,
 * annulée, rejetée par le prestataire.
 */
export const STATUTS_REVENUS = [
  'programmee',
  'validee',
  'en_cours',
  'realisee',
  'realisee_sans_collecte',
  'cloturee',
] as const;

const TAILLE_LOT_IN = 100;
const PLAFOND_POSTGREST = 1000;

interface Periode {
  valide_du: string;
  valide_jusqu: string | null;
}
interface Grille extends Periode {
  id: string;
  est_defaut: boolean;
}
interface Palier {
  grille_id: string;
  pax_min: number;
  pax_max: number | null;
  prix_base_ht: number;
  prix_par_couvert_ht: number | null;
}
interface Remise extends Periode {
  activite: string;
  scope: string;
  organisation_id: string | null;
  gestionnaire_organisation_id: string | null;
  lieu_id: string | null;
  remise_pct: number;
}

function enVigueur(p: Periode, jour: string): boolean {
  return (
    p.valide_du <= jour && (p.valide_jusqu == null || p.valide_jusqu >= jour)
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function lots<T>(valeurs: T[]): T[][] {
  const res: T[][] = [];
  for (let i = 0; i < valeurs.length; i += TAILLE_LOT_IN)
    res.push(valeurs.slice(i, i + TAILLE_LOT_IN));
  return res;
}

/** `.in()` découpé par lots (une liste d'ids trop longue dépasse l'URL). */
async function lireParLots<T>(
  ids: string[],
  lire: (
    lot: string[],
  ) => PromiseLike<{ data: unknown[] | null; error: unknown }>,
  contexte: string,
): Promise<T[]> {
  const res: T[] = [];
  for (const lot of lots(ids)) {
    const { data, error } = await lire(lot);
    if (error) throw erreurInterne(error, contexte);
    const lignes = (data ?? []) as T[];
    // Plafond PostgREST : un lot plein peut être tronqué, et une remise perdue
    // fausserait le montant sans le dire. On échoue plutôt.
    if (lignes.length >= PLAFOND_POSTGREST)
      throw erreurInterne(new Error('lecture tronquée'), contexte);
    res.push(...lignes);
  }
  return res;
}

export function prixPack(pack: PackPrix | null): number | null {
  if (!pack) return null;
  if (pack.prix_unitaire_ht != null)
    return round2(Number(pack.prix_unitaire_ht));
  if (pack.montant_total_ht != null && pack.credits_initiaux)
    return round2(Number(pack.montant_total_ht) / pack.credits_initiaux);
  return null;
}

/**
 * Montant HT de la prestation de chaque collecte, dans l'ordre reçu.
 * Lève une erreur si une lecture échoue : un montant sans sa remise serait faux
 * sans le dire.
 */
export async function montantsPrestation(
  supabase: SupabaseClient,
  collectes: CollectePrestation[],
): Promise<(number | null)[]> {
  if (collectes.length === 0) return [];

  const orgIds = [
    ...new Set(
      collectes.map((c) => c.organisation_id).filter((v): v is string => !!v),
    ),
  ];
  const lieuIds = [
    ...new Set(collectes.map((c) => c.lieu_id).filter((v): v is string => !!v)),
  ];
  const avecZd = collectes.some((c) => c.type === 'zero_dechet');
  const avecAgHorsPack = collectes.some(
    (c) => c.type === 'anti_gaspi' && !c.pack,
  );

  // Grilles et paliers ZD : référentiel court, lu en entier.
  let grilles: Grille[] = [];
  let paliers: Palier[] = [];
  const grilleOrg = new Map<string, string | null>();
  if (avecZd) {
    const g = await supabase
      .from('grilles_tarifaires_zd')
      .select('id, est_defaut, valide_du, valide_jusqu')
      .eq('actif', true);
    if (g.error) throw erreurInterne(g.error, 'montant_prestation.grilles');
    grilles = (g.data ?? []) as Grille[];

    const t = await supabase
      .from('tarifs_zero_dechet')
      .select('grille_id, pax_min, pax_max, prix_base_ht, prix_par_couvert_ht')
      .in(
        'grille_id',
        grilles.map((x) => x.id),
      );
    if (t.error) throw erreurInterne(t.error, 'montant_prestation.paliers');
    paliers = (t.data ?? []) as Palier[];

    const orgs = await lireParLots<{
      id: string;
      grille_tarifaire_zd_id: string | null;
    }>(
      orgIds,
      (lot) =>
        supabase
          .from('organisations')
          .select('id, grille_tarifaire_zd_id')
          .in('id', lot),
      'montant_prestation.organisations',
    );
    for (const o of orgs) grilleOrg.set(o.id, o.grille_tarifaire_zd_id);
  }

  // Tarif AG unitaire public (hors pack).
  let unitairesAg: (Periode & { prix_unitaire_ht: number })[] = [];
  if (avecAgHorsPack) {
    const u = await supabase
      .from('tarifs_packs_ag')
      .select('prix_unitaire_ht, valide_du, valide_jusqu:valide_jusqu_au')
      .eq('type_pack', 'unitaire');
    if (u.error) throw erreurInterne(u.error, 'montant_prestation.tarif_ag');
    unitairesAg = (u.data ?? []) as typeof unitairesAg;
  }

  // Remises : organisation programmatrice + gestionnaires du lieu.
  const gestionnairesDuLieu = new Map<string, string[]>();
  const liens = await lireParLots<{ lieu_id: string; organisation_id: string }>(
    lieuIds,
    (lot) =>
      supabase
        .from('organisations_lieux')
        .select('lieu_id, organisation_id')
        .in('lieu_id', lot),
    'montant_prestation.gestionnaires',
  );
  for (const l of liens) {
    const liste = gestionnairesDuLieu.get(l.lieu_id) ?? [];
    liste.push(l.organisation_id);
    gestionnairesDuLieu.set(l.lieu_id, liste);
  }
  const gestionnaireIds = [...new Set(liens.map((l) => l.organisation_id))];
  const colonnesRemise =
    'activite, scope, organisation_id, gestionnaire_organisation_id, lieu_id, remise_pct, valide_du, valide_jusqu:valide_jusqu_au';
  const remises = [
    ...(await lireParLots<Remise>(
      orgIds,
      (lot) =>
        supabase
          .from('tarifs_negocie')
          .select(colonnesRemise)
          .eq('scope', 'organisation')
          .in('organisation_id', lot),
      'montant_prestation.remises_organisation',
    )),
    ...(await lireParLots<Remise>(
      gestionnaireIds,
      (lot) =>
        supabase
          .from('tarifs_negocie')
          .select(colonnesRemise)
          .eq('scope', 'gestionnaire')
          .in('gestionnaire_organisation_id', lot),
      'montant_prestation.remises_gestionnaire',
    )),
  ];

  // Facteur 1 − max(remise) : la plus élevée s'applique, sans cumul.
  function facteurRemise(c: CollectePrestation, activite: 'zd' | 'ag'): number {
    const gestionnaires = c.lieu_id
      ? (gestionnairesDuLieu.get(c.lieu_id) ?? [])
      : [];
    let max = 0;
    for (const r of remises) {
      if (r.activite !== activite || !enVigueur(r, c.date_collecte)) continue;
      const eligible =
        r.scope === 'organisation'
          ? r.organisation_id != null && r.organisation_id === c.organisation_id
          : r.gestionnaire_organisation_id != null &&
            gestionnaires.includes(r.gestionnaire_organisation_id) &&
            (r.lieu_id == null || r.lieu_id === c.lieu_id);
      if (eligible) max = Math.max(max, Number(r.remise_pct));
    }
    return 1 - max;
  }

  function montantZd(c: CollectePrestation): number | null {
    const pax = c.pax;
    if (pax == null || !Number.isInteger(pax) || pax < 1) return null;
    const jour = c.date_collecte;
    const propre = c.organisation_id ? grilleOrg.get(c.organisation_id) : null;
    const grille =
      (propre && grilles.find((g) => g.id === propre && enVigueur(g, jour))) ||
      grilles.find((g) => g.est_defaut && enVigueur(g, jour));
    if (!grille) return null;
    const palier = paliers.find(
      (p) =>
        p.grille_id === grille.id &&
        p.pax_min <= pax &&
        (p.pax_max == null || p.pax_max >= pax),
    );
    if (!palier) return null;
    const brut =
      Number(palier.prix_base_ht) +
      (palier.prix_par_couvert_ht != null
        ? Number(palier.prix_par_couvert_ht) * pax
        : 0);
    return round2(brut * facteurRemise(c, 'zd'));
  }

  function montantAg(c: CollectePrestation): number | null {
    if (c.pack) return prixPack(c.pack);
    const unitaire = unitairesAg.find((u) => enVigueur(u, c.date_collecte));
    if (!unitaire) return null;
    return round2(Number(unitaire.prix_unitaire_ht) * facteurRemise(c, 'ag'));
  }

  return collectes.map((c) =>
    c.type === 'zero_dechet'
      ? montantZd(c)
      : c.type === 'anti_gaspi'
        ? montantAg(c)
        : null,
  );
}
