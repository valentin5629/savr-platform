// Numéro de bordereau imprimé dans un rapport (décision Val 2026-10-27, §12
// §1.7) : le rapport d'une collecte (@3) et le rapport cumulé d'un événement
// lisent leurs mesures en service-role ; le numéro du bordereau n'y figure que
// si le demandeur peut lire ce bordereau sous SA RLS (policies bord_*_select),
// « — » sinon. Ex. : un gestionnaire voit la collecte qu'il a programmée sur un
// lieu non rattaché à son organisation, pas son bordereau.

import type { createSupabaseServerClient } from '@/lib/api-auth.js';

type ClientSousRls = ReturnType<typeof createSupabaseServerClient>;

export type BordereauxVisibles =
  | { ok: true; collectes: Set<string> }
  | { ok: false; erreur: unknown };

/** Collectes, parmi `collecteIds`, dont le demandeur lit un bordereau. */
export async function lireBordereauxVisibles(
  rls: ClientSousRls,
  collecteIds: readonly string[],
): Promise<BordereauxVisibles> {
  if (collecteIds.length === 0) return { ok: true, collectes: new Set() };
  const { data, error } = await rls
    .from('bordereaux_savr')
    .select('collecte_id')
    .in('collecte_id', [...collecteIds]);
  if (error) return { ok: false, erreur: error };
  return {
    ok: true,
    collectes: new Set(
      ((data ?? []) as { collecte_id: string }[]).map((b) => b.collecte_id),
    ),
  };
}
