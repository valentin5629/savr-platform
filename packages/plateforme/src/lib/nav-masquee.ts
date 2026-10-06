import { createSupabaseServerClient } from '@/lib/api-auth';
import type { NavRole } from '@/lib/roles';
import { ROUTES } from '@/lib/routes';

/**
 * Entrées du menu à masquer pour l'utilisateur courant (hrefs), à passer à
 * `AppShell` (`hiddenNavHrefs`).
 *
 * Règle UNIQUE, appelée par chaque layout qui monte le menu d'un gestionnaire de
 * lieux : son espace `(gestionnaire)`, mais aussi les sections transverses
 * `(registre)` et `(programmation)`, qui ont leur propre layout.
 *
 * §06.05 l.75 — « Mon pack AG » masqué si l'organisation n'a AUCUN pack
 * (packs_antgaspi WHERE organisation_id = current_org). La RLS scope déjà
 * packs_antgaspi à l'organisation de l'appelant → un simple count des lignes
 * visibles suffit (pattern identique à la route pack-ag).
 */
export async function entreesNavMasquees(role: NavRole): Promise<string[]> {
  if (role !== 'gestionnaire_lieux') return [];

  const supabase = createSupabaseServerClient({ readonly: true });
  const { count } = await supabase
    .from('packs_antgaspi')
    .select('id', { count: 'exact', head: true });
  return (count ?? 0) > 0 ? [] : [ROUTES.gestionnaire.monPackAg];
}
