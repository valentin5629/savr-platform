import type { SupabaseClient } from '@savr/shared/src/supabase-client.js';
import type { AnyRole } from '@/lib/api-auth.js';

// ---------------------------------------------------------------------------
// Entités exportables (transverse D, §12 §2) + matrice d'autorisation par rôle.
// Source : §12 §2 « Exports disponibles par profil ». La RLS scope les LIGNES ;
// cette matrice scope la CAPACITÉ (un rôle non listé reçoit 403, même si la RLS
// l'autoriserait à lire la donnée — ex. gestionnaire exclu de Collectes :
// il exporte au grain Événement uniquement, §12 §2 précision gestionnaire).
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

const STAFF: AnyRole[] = ['admin_savr', 'ops_savr'];

export const EXPORT_MATRIX: Record<ExportEntity, AnyRole[]> = {
  collectes: [
    ...STAFF,
    'traiteur_manager',
    'traiteur_commercial',
    'agence',
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
  pesees: [...STAFF, 'traiteur_manager', 'agence', 'client_organisateur'],
  factures: [
    ...STAFF,
    'traiteur_manager',
    'traiteur_commercial',
    'agence',
    'gestionnaire_lieux',
  ],
  'packs-ag': [...STAFF, 'traiteur_manager', 'agence', 'gestionnaire_lieux'],
  'associations-ag': [...STAFF, 'traiteur_manager'],
  'impact-rse': [
    ...STAFF,
    'traiteur_manager',
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
export const TYPE_COLLECTE_LIBELLE: Record<string, string> = {
  zero_dechet: 'Zéro Déchet',
  anti_gaspi: 'Anti-Gaspi',
};

export const STATUT_COLLECTE_LIBELLE: Record<string, string> = {
  brouillon: 'Brouillon',
  programmee: 'Programmée',
  validee: 'Validée',
  en_cours: 'En cours',
  realisee: 'Réalisée',
  realisee_sans_collecte: 'Réalisée sans collecte',
  cloturee: 'Clôturée',
  annulation_demandee: 'Annulation demandée',
  annulee: 'Annulée',
  rejetee_par_prestataire: 'Rejetée par le prestataire',
};

export const STATUT_FACTURE_LIBELLE: Record<string, string> = {
  brouillon: 'Brouillon',
  en_attente_pennylane: 'En attente Pennylane',
  emise: 'Émise',
  payee: 'Payée',
  annulee: 'Annulée',
};

export const TYPE_FACTURE_LIBELLE: Record<string, string> = {
  zero_dechet: 'Zéro Déchet',
  achat_pack_antigaspi: 'Achat pack Anti-Gaspi',
  collecte_antigaspi: 'Collecte Anti-Gaspi',
  avoir: 'Avoir',
};

export const STATUT_PACK_LIBELLE: Record<string, string> = {
  actif: 'Actif',
  epuise: 'Épuisé',
  annule: 'Annulé',
};

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
    .select('id, nom, raison_sociale')
    .in('id', uniques);
  for (const t of (data ?? []) as Record<string, unknown>[]) {
    out.set(
      t.id as string,
      (t.raison_sociale as string | null) ?? (t.nom as string),
    );
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

/** Somme des poids réels (kg) des flux d'une collecte (tonnage ZD). */
export function sommePoidsFlux(
  flux: { poids_reel_kg?: number | null }[] | null | undefined,
): number {
  return (flux ?? []).reduce((s, f) => s + (f.poids_reel_kg ?? 0), 0);
}

/** Déballe une relation Supabase (objet ou tableau-1) en objet. */
export function unwrap(rel: unknown): Record<string, unknown> {
  if (Array.isArray(rel)) return (rel[0] ?? {}) as Record<string, unknown>;
  return (rel ?? {}) as Record<string, unknown>;
}
