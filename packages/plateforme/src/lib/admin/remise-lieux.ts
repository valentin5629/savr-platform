// Lieux d'une remise négociée scope=gestionnaire (fiche du gestionnaire de lieux).
// Le modèle porte UN lieu par ligne (`tarifs_negocie.lieu_id`, null = tous les
// lieux du gestionnaire) : une remise sur plusieurs lieux est enregistrée en une
// ligne par lieu (arbitrage Val 2026-09-17, aucune migration).
//
// Corps accepté : `lieu_ids: string[]` (vide = tous les lieux) ou, pour
// compatibilité, `lieu_id: string | null`.

import type { SupabaseClient } from '@savr/shared/src/supabase-client.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type LieuxRemise =
  | { ok: true; lieux: Array<string | null> }
  | { ok: false; status: 422; error: string }
  | { ok: false; status: 500; cause: unknown };

/** Lit `lieu_ids` / `lieu_id` du corps. `fourni=false` = aucun des deux présent. */
export function lireLieuxDuCorps(
  body: Record<string, unknown>,
): { ok: true; fourni: boolean; ids: string[] } | { ok: false; error: string } {
  if ('lieu_ids' in body) {
    const v = body.lieu_ids;
    if (
      !Array.isArray(v) ||
      v.some((x) => typeof x !== 'string' || !UUID_RE.test(x))
    ) {
      return { ok: false, error: 'lieu_ids doit être une liste de lieux' };
    }
    return { ok: true, fourni: true, ids: [...new Set(v as string[])] };
  }
  if ('lieu_id' in body) {
    const v = body.lieu_id;
    if (v === null || v === undefined || v === '')
      return { ok: true, fourni: true, ids: [] };
    if (typeof v !== 'string' || !UUID_RE.test(v))
      return { ok: false, error: 'lieu_id invalide' };
    return { ok: true, fourni: true, ids: [v] };
  }
  return { ok: true, fourni: false, ids: [] };
}

/**
 * Vérifie que chaque lieu est rattaché au gestionnaire (sinon la remise ne
 * s'appliquerait jamais) et rend la liste des `lieu_id` à insérer, une ligne
 * par lieu (`[null]` = tous les lieux du gestionnaire).
 */
export async function verifierLieuxGestionnaire(
  supabase: SupabaseClient,
  gestionnaireOrganisationId: string,
  ids: string[],
): Promise<LieuxRemise> {
  if (ids.length === 0) return { ok: true, lieux: [null] };
  const { data, error } = await supabase
    .from('organisations_lieux')
    .select('lieu_id')
    .eq('organisation_id', gestionnaireOrganisationId)
    .in('lieu_id', ids);
  if (error) return { ok: false, status: 500, cause: error };
  const rattaches = new Set(
    ((data ?? []) as { lieu_id: string }[]).map((l) => l.lieu_id),
  );
  if (ids.some((id) => !rattaches.has(id))) {
    return {
      ok: false,
      status: 422,
      error: "Un des lieux n'est pas rattaché à ce gestionnaire",
    };
  }
  return { ok: true, lieux: ids };
}
