import {
  createAdminSupabaseClient,
  type SupabaseClient,
} from '@savr/shared/src/supabase-client.js';
import {
  FLUX_ZD_CODES,
  LIBELLE_FLUX,
  type FluxZdCode,
} from '@/lib/libelles/flux.js';
import type { AnyRole } from '@/lib/api-auth.js';
import { ROLES_STAFF } from '@/lib/roles';
import { erreurInterne } from '@/lib/api-helpers.js';

// ---------------------------------------------------------------------------
// Entités exportables (transverse D, §12 §2) + matrice d'autorisation par rôle.
// Source : §12 §2 « Exports disponibles par profil ». La RLS scope les LIGNES ;
// cette matrice scope la CAPACITÉ (un rôle non listé reçoit 403, même si la RLS
// l'autoriserait à lire la donnée). Commercial traiteur aligné sur le manager
// (Val 2026-10-30), sauf Packs AG : la RLS de packs_antgaspi ne le lit pas.
// Le gestionnaire de lieux exporte Collectes depuis sa liste Collectes (décision
// Val 2026-10-07 : la liste Événements, qui portait son seul export, est retirée).
// « Courses logistiques » (Admin only §12) est HORS V1 : dépend de tms.* inexistant.
// ---------------------------------------------------------------------------
export const EXPORT_ENTITIES = [
  'collectes',
  'evenements',
  'pesees',
  'factures',
  'packs-ag',
  'associations-ag',
  'impact-rse',
] as const;

export type ExportEntity = (typeof EXPORT_ENTITIES)[number];

const STAFF: AnyRole[] = [...ROLES_STAFF];

export const EXPORT_MATRIX: Record<ExportEntity, AnyRole[]> = {
  collectes: [
    ...STAFF,
    'traiteur_manager',
    'traiteur_commercial',
    'agence',
    'gestionnaire_lieux',
    'client_organisateur',
  ],
  evenements: [
    ...STAFF,
    'traiteur_manager',
    'traiteur_commercial',
    'agence',
    'gestionnaire_lieux',
    'client_organisateur',
  ],
  pesees: [
    ...STAFF,
    'traiteur_manager',
    'traiteur_commercial',
    'agence',
    'client_organisateur',
  ],
  factures: [
    ...STAFF,
    'traiteur_manager',
    'traiteur_commercial',
    'agence',
    'gestionnaire_lieux',
  ],
  'packs-ag': [...STAFF, 'traiteur_manager', 'agence', 'gestionnaire_lieux'],
  'associations-ag': [...STAFF, 'traiteur_manager', 'traiteur_commercial'],
  'impact-rse': [
    ...STAFF,
    'traiteur_manager',
    'traiteur_commercial',
    'agence',
    'gestionnaire_lieux',
    'client_organisateur',
  ],
};

export function isExportEntity(v: string): v is ExportEntity {
  return (EXPORT_ENTITIES as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Contexte d'exécution d'un export.
// ---------------------------------------------------------------------------
export interface ExportContext {
  supabase: SupabaseClient;
  role: AnyRole;
  // Le cloisonnement client passe par la RLS du client supabase ; le staff par
  // service_role + isStaff. L'organisation_id n'est donc pas nécessaire ici.
  isStaff: boolean;
}

/** Résultat d'un builder : préfixe de nom de fichier + contenu CSV complet. */
export interface ExportOutput {
  filenamePrefix: string;
  csv: string;
}

export type ExportBuilder = (
  ctx: ExportContext,
  sp: URLSearchParams,
) => Promise<ExportOutput>;

// ---------------------------------------------------------------------------
// Libellés FR (enums DB → affichage CSV). Fallback = valeur brute.
// ---------------------------------------------------------------------------
// Type de collecte : source unique `lib/libelles/type-collecte` (R-UI-2 C2).
export { LIBELLE_TYPE_COLLECTE as TYPE_COLLECTE_LIBELLE } from '@/lib/libelles/type-collecte.js';

// Statut collecte : source unique `lib/statut-collecte-labels` (vue admin,
// R-UI-2 C1), ré-exportée sous le nom historique des builders CSV.
export { LIBELLE_STATUT_COLLECTE as STATUT_COLLECTE_LIBELLE } from '@/lib/statut-collecte-labels';

// Facture / pack : source unique `lib/libelles/` (R-UI-0), ré-exportée sous les
// noms historiques des builders CSV.
export {
  LIBELLE_STATUT_FACTURE as STATUT_FACTURE_LIBELLE,
  LIBELLE_TYPE_FACTURE as TYPE_FACTURE_LIBELLE,
} from '@/lib/libelles/facture.js';
export { LIBELLE_STATUT_PACK as STATUT_PACK_LIBELLE } from '@/lib/libelles/pack.js';

export function libelle(map: Record<string, string>, key: unknown): string {
  if (key == null) return '';
  return map[String(key)] ?? String(key);
}

/** « 23:00:00 » → « 23:00 ». */
export function heureCourte(t: unknown): string {
  return t ? String(t).slice(0, 5) : '';
}

// ---------------------------------------------------------------------------
// Résolutions RLS-safe partagées.
// ---------------------------------------------------------------------------

/**
 * Résout les noms des traiteurs via la vue whitelist `v_referentiel_traiteurs`
 * (SECURITY DEFINER, sûre cross-org — la jointure directe `organisations` est
 * RLS self-only et renverrait null pour les rôles tiers).
 */
export async function resolveTraiteurNoms(
  supabase: SupabaseClient,
  ids: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const uniques = [...new Set(ids.filter((v): v is string => !!v))];
  if (uniques.length === 0) return out;
  const { data } = await supabase
    .from('v_referentiel_traiteurs')
    .select('id, nom')
    .in('id', uniques);
  for (const t of (data ?? []) as Record<string, unknown>[]) {
    // Libellé unique porté par la vue (20260922080000).
    out.set(t.id as string, t.nom as string);
  }
  return out;
}

/**
 * Résout les repas détournés (AG) par collecte.
 *  - Client : via le helper SECURITY DEFINER C-1-safe `f_volume_repas_realise`
 *    (la jointure directe `attributions_antgaspi` est RLS-filtrée à 0 pour le
 *    client organisateur).
 *  - Staff (service_role) : lecture directe `attributions_antgaspi` (RLS
 *    bypassée). Le helper renverrait 0 sous service_role car `auth.jwt()` est
 *    nul → `f_collecte_visible` faux.
 */
export async function resolveRepas(
  supabase: SupabaseClient,
  agCollecteIds: string[],
  isStaff = false,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const ids = [...new Set(agCollecteIds.filter((v): v is string => !!v))];
  if (ids.length === 0) return out;

  if (isStaff) {
    const { data } = await supabase
      .from('attributions_antgaspi')
      .select('collecte_id, volume_repas_realise')
      .in('collecte_id', ids);
    for (const a of (data ?? []) as Record<string, unknown>[]) {
      const cid = a.collecte_id as string;
      out.set(cid, (out.get(cid) ?? 0) + Number(a.volume_repas_realise ?? 0));
    }
    return out;
  }

  await Promise.all(
    ids.map(async (id) => {
      const { data } = await supabase.rpc('f_volume_repas_realise', {
        p_collecte_id: id,
      });
      if (data != null) out.set(id, Number(data));
    }),
  );
  return out;
}

/** Réponse d'une tranche : lignes, erreur et total exact de la requête. */
interface Tranche {
  data: unknown[] | null;
  error: unknown;
  count: number | null;
}

// Lignes demandées par tranche. PostgREST plafonne de son côté (`max_rows` :
// 1 000 en local et sur savr-dev, mesuré le 2026-10-07 ; prod non mesurée) :
// la boucle avance du nombre de lignes REÇUES, elle ne suppose pas que la
// tranche est servie entière.
const TRANCHE = 1000;

/**
 * Lit TOUTES les lignes d'une requête, tranche par tranche. Une lecture unique
 * s'arrête au plafond PostgREST sans le dire : le fichier sortirait tronqué.
 * `requete` reconstruit la requête à chaque tranche — filtrée, triée sur une clé
 * unique, demandée avec `count: 'exact'`. Le total annoncé borne la boucle ;
 * sans total, l'export échoue plutôt que de rendre un fichier incomplet.
 */
export async function lireParTranches<T>(
  requete: () => { range(from: number, to: number): PromiseLike<Tranche> },
): Promise<T[]> {
  const lignes: unknown[] = [];
  for (;;) {
    const { data, error, count } = await requete().range(
      lignes.length,
      lignes.length + TRANCHE - 1,
    );
    if (error) throw erreurInterne(error, 'exports.builders');
    if (count == null)
      throw erreurInterne(
        new Error('export par tranches : total absent de la réponse'),
        'exports.builders',
      );
    const lot = data ?? [];
    lignes.push(...lot);
    if (lot.length === 0 || lignes.length >= count) return lignes as T[];
  }
}

/** Somme des poids réels (kg) des flux d'une collecte (tonnage ZD). */
export function sommePoidsFlux(
  flux: { poids_reel_kg?: number | null }[] | null | undefined,
): number {
  return (flux ?? []).reduce((s, f) => s + (f.poids_reel_kg ?? 0), 0);
}

/** Flux d'une collecte, avec le code de son flux (colonnes par flux des exports). */
export type FluxPese = {
  poids_reel_kg?: number | null;
  flux_dechets?: { code?: string | null } | { code?: string | null }[] | null;
};

/**
 * Poids réel (kg) par flux ZD, sommé sur une ou plusieurs collectes. Un flux
 * sans pesée vaut 0, comme le « Tonnage ZD » ; un code hors des 5 flux V1 est
 * ignoré.
 */
export function poidsParFlux(
  flux: FluxPese[] | null | undefined,
): Record<FluxZdCode, number> {
  const out = Object.fromEntries(FLUX_ZD_CODES.map((c) => [c, 0])) as Record<
    FluxZdCode,
    number
  >;
  for (const f of flux ?? []) {
    const code = unwrap(f.flux_dechets).code as string | undefined;
    if (code && code in out)
      out[code as FluxZdCode] += Number(f.poids_reel_kg ?? 0);
  }
  return out;
}

/** Colonnes « <Flux> (kg) », dans l'ordre d'affichage des flux. */
export const COLONNES_FLUX = FLUX_ZD_CODES.map((code) => ({
  code,
  header: `${LIBELLE_FLUX[code]} (kg)`,
}));

// Identifiants par requête `in(id, …)` : au-delà de quelques centaines, l'URL
// est refusée (mesuré sur savr-dev le 2026-10-07, cf. l'export Collectes).
const IDS_PAR_LECTURE = 100;

/**
 * Codes affaire VIPARIS des événements (Val 2026-11-02). La colonne est hors de
 * la liste blanche de lecture des clients : lue en service_role, pour les seuls
 * événements que l'export vient de lire sous la RLS du demandeur (staff : son
 * client service_role). Ne rend que les événements qui ont un code.
 */
export async function lireCodesAffaireViparis(
  ctx: ExportContext,
  evenementIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(evenementIds.filter((v): v is string => !!v))];
  if (ids.length === 0) return out;
  const lecteur = ctx.isStaff ? ctx.supabase : createAdminSupabaseClient();
  for (let i = 0; i < ids.length; i += IDS_PAR_LECTURE) {
    const { data, error } = await lecteur
      .from('evenements')
      .select('id, code_affaire_viparis')
      .in('id', ids.slice(i, i + IDS_PAR_LECTURE))
      .not('code_affaire_viparis', 'is', null);
    if (error) throw erreurInterne(error, 'exports.codes_viparis');
    for (const e of (data ?? []) as {
      id: string;
      code_affaire_viparis: string | null;
    }[])
      if (e.code_affaire_viparis) out.set(e.id, e.code_affaire_viparis);
  }
  return out;
}

/** Déballe une relation Supabase (objet ou tableau-1) en objet. */
export function unwrap(rel: unknown): Record<string, unknown> {
  if (Array.isArray(rel)) return (rel[0] ?? {}) as Record<string, unknown>;
  return (rel ?? {}) as Record<string, unknown>;
}
