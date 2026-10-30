import type { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';

/**
 * Filtres « Lieux / Traiteur / Agence / Gestionnaire de lieux » de la section
 * Revenus du Dashboard Admin (graphe + tableau), décisions Val 2026-10-30 :
 *   - les cartes « Suivi opérationnel » ne sont pas filtrées ;
 *   - traiteur ou agence coché : collectes qu'il a programmées OU opérées
 *     (même règle que le Dashboard Client, R24c) ;
 *   - gestionnaire de lieux coché : collectes tenues sur les lieux de son parc
 *     (`organisations_lieux`), quel que soit le programmateur ;
 *   - les organisations cochées s'additionnent ; le filtre Lieux restreint ensuite.
 * Lecture service-role, appelée après `requireStaff`.
 */

type Supabase = ReturnType<typeof createAdminSupabaseClient>;

// Les ids sont interpolés dans un filtre `.or()` PostgREST : on ne garde que des
// UUID (même défense que le Dashboard Client).
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function lireIds(sp: URLSearchParams, cle: string): string[] {
  return (sp.get(cle) ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => UUID_RE.test(s));
}

export interface PerimetreRevenus {
  /** Filtre `.or()` sur l'événement (organisations cochées), null = aucun. */
  orEvenement: string | null;
  /** Filtre Lieux de la barre (ET). */
  lieuIds: string[];
  /** Sélection qui ne peut rien contenir (ex. gestionnaire sans lieu). */
  vide: boolean;
}

export async function lirePerimetreRevenus(
  supabase: Supabase,
  sp: URLSearchParams,
): Promise<{ perimetre: PerimetreRevenus; error: unknown }> {
  const lieuIds = lireIds(sp, 'lieu_ids');
  const organisationIds = lireIds(sp, 'organisation_ids');
  const perimetre: PerimetreRevenus = {
    orEvenement: null,
    lieuIds,
    vide: false,
  };
  if (organisationIds.length === 0) return { perimetre, error: null };

  const orgs = await supabase
    .from('organisations')
    .select('id, type')
    .in('id', organisationIds);
  if (orgs.error) return { perimetre, error: orgs.error };

  const lignes = (orgs.data ?? []) as { id: string; type: string }[];
  const gestionnaires = lignes
    .filter((o) => o.type === 'gestionnaire_lieux')
    .map((o) => o.id);
  const autres = lignes
    .filter((o) => o.type !== 'gestionnaire_lieux')
    .map((o) => o.id);

  // Parc lu en une requête (plafond PostgREST de 1000 rattachements pour les
  // gestionnaires cochés ensemble, loin des volumes An 1).
  let parc: string[] = [];
  if (gestionnaires.length > 0) {
    const rattachements = await supabase
      .from('organisations_lieux')
      .select('lieu_id')
      .in('organisation_id', gestionnaires);
    if (rattachements.error) return { perimetre, error: rattachements.error };
    parc = [
      ...new Set(
        ((rattachements.data ?? []) as { lieu_id: string }[]).map(
          (r) => r.lieu_id,
        ),
      ),
    ];
  }

  const conditions: string[] = [];
  if (autres.length > 0) {
    const ids = autres.join(',');
    conditions.push(
      `organisation_id.in.(${ids})`,
      `traiteur_operationnel_organisation_id.in.(${ids})`,
    );
  }
  if (parc.length > 0) conditions.push(`lieu_id.in.(${parc.join(',')})`);

  perimetre.orEvenement = conditions.length > 0 ? conditions.join(',') : null;
  perimetre.vide = conditions.length === 0;
  return { perimetre, error: null };
}

// Forme minimale du constructeur de requête supabase-js : un générique lié à
// ses types complets dépasse la profondeur d'instanciation de TypeScript.
interface Filtrable {
  or(filtre: string, options: { referencedTable: string }): Filtrable;
  in(colonne: string, valeurs: string[]): Filtrable;
}

/**
 * Pose le périmètre sur une requête dont l'événement est embarqué en
 * `!inner` au chemin `chemin` (`evenements` ou `collectes.evenements`).
 */
export function appliquerPerimetreRevenus<Q>(
  q: Q,
  p: PerimetreRevenus,
  chemin: 'evenements' | 'collectes.evenements',
): Q {
  let query = q as unknown as Filtrable;
  if (p.orEvenement)
    query = query.or(p.orEvenement, { referencedTable: chemin });
  if (p.lieuIds.length > 0) query = query.in(`${chemin}.lieu_id`, p.lieuIds);
  return query as unknown as Q;
}

/** Taille des lots de lecture (plafond PostgREST : 1000 lignes par réponse). */
export const LOT_LECTURE = 1000;

/**
 * Lit toutes les lignes d'une requête paginée par lots de `LOT_LECTURE`.
 * Rend `unknown[]` : chaque route caste vers sa forme (embeds supabase-js
 * inférés en tableaux). La requête doit être triée (`.order`).
 */
export async function lireTout(
  lot: (
    offset: number,
  ) => PromiseLike<{ data: unknown[] | null; error: unknown }>,
): Promise<{ rows: unknown[]; error: unknown }> {
  const rows: unknown[] = [];
  for (let offset = 0; ; offset += LOT_LECTURE) {
    const { data, error } = await lot(offset);
    if (error) return { rows, error };
    const lignes = data ?? [];
    rows.push(...lignes);
    if (lignes.length < LOT_LECTURE) return { rows, error: null };
  }
}

export interface PackEmbed {
  prix_unitaire_ht: number | null;
  montant_total_ht: number | null;
  credits_initiaux: number | null;
}

/**
 * Montant AG d'une collecte livrée (CA économique, §11 §1.1, Val 2026-07-07) :
 * prix unitaire du pack, sinon montant total ÷ crédits initiaux. Règle unique
 * de l'histogramme et du tableau Revenus.
 */
export function coutCollecteAg(pack: PackEmbed | null): number {
  if (!pack) return 0;
  if (pack.prix_unitaire_ht != null) return pack.prix_unitaire_ht;
  if (pack.montant_total_ht != null && pack.credits_initiaux)
    return pack.montant_total_ht / pack.credits_initiaux;
  return 0;
}
