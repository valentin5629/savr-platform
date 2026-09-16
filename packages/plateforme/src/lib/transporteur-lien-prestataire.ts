/**
 * Lien transporteur → prestataire logistique (pont V1
 * `transporteurs.prestataire_logistique_id`, décision Val 2026-06-25).
 *
 * Les adapters reconnaissent les tournées d'un provider par ce lien et par lui
 * seul (`prestatairesDuType`, #327). Un transporteur routé vers un adapter mais
 * sans prestataire écarte donc toutes ses tournées : `prestatairesDuType` lève,
 * et 100 % des événements de ce type finissent en file d'erreur. D'où
 * l'obligation, pour ces deux types-là seulement — les types manuels ne passent
 * par aucun adapter.
 *
 * Le lien et le type sont posés à la création et JAMAIS modifiables ensuite
 * (arbitrage Val 2026-09-16) : garde en base `trg_transporteur_cols_immuables`,
 * quel que soit le chemin. Pour en changer, créer un nouveau transporteur.
 *
 * Module neutre (ni `next/server` ni client Supabase) : la modale l'importe
 * côté navigateur pour appliquer la même règle que les routes.
 */
export const TYPES_TMS_AVEC_PRESTATAIRE: readonly string[] = [
  'mts1',
  'a_toutes',
];

/** Colonnes refusées par le PATCH : posées à la création, jamais modifiées. */
export const COLONNES_IMMUABLES = [
  'type_tms',
  'prestataire_logistique_id',
] as const;

export interface RefusLienPrestataire {
  status: 409 | 422;
  error: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Refus 422 si le couple (type, prestataire) n'est pas enregistrable. */
export function validerLienPrestataire(
  typeTms: unknown,
  prestataireId: unknown,
): RefusLienPrestataire | null {
  // Contrôlé ici plutôt que laissé à Postgres : un texte non-UUID y lèverait
  // 22P02, qui tomberait en 500 générique au lieu d'une erreur de saisie.
  if (
    prestataireId != null &&
    (typeof prestataireId !== 'string' || !UUID_RE.test(prestataireId))
  ) {
    return { status: 422, error: 'prestataire_logistique_id invalide' };
  }
  if (
    typeof typeTms === 'string' &&
    TYPES_TMS_AVEC_PRESTATAIRE.includes(typeTms) &&
    !prestataireId
  ) {
    return {
      status: 422,
      error: `prestataire_logistique_id obligatoire pour type_tms=${typeTms}`,
    };
  }
  return null;
}

/**
 * Traduit les refus de la base propres à ce lien, à la création (POST).
 * `null` = autre erreur, à laisser à `serverError`. Les messages sont écrits
 * ici, jamais recopiés de Postgres (cliquet `check-api-error-leak`).
 */
export function refusLienPrestataireDepuisDb(
  error: { code?: string } | null,
): RefusLienPrestataire | null {
  switch (error?.code) {
    // uniq_transporteur_par_prestataire (#323) — la clé primaire, seul autre
    // index unique de la table, n'est jamais écrite par ces routes.
    case '23505':
      return {
        status: 409,
        error:
          'Ce prestataire logistique est déjà rattaché à un autre transporteur.',
      };
    // Seule clé étrangère de la table (mesuré sur pg_constraint).
    case '23503':
      return { status: 422, error: 'Prestataire logistique introuvable.' };
    default:
      return null;
  }
}
