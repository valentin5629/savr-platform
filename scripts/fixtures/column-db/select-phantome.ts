// =============================================================================
// Fixture d'auto-test G7 (`pnpm check:column-db`) — JAMAIS exécutée.
// =============================================================================
// Compilée dans le même programme que l'app par `scripts/check-column-db.ts`.
// Chaque ligne portant le marqueur d'attente en fin de ligne (ou suivant une
// ligne qui ne contient que ce marqueur) DOIT être détectée comme colonne-DB ; toute autre ligne de ce dossier ne doit PAS l'être. Sinon le
// gate sort en erreur (détecteur inerte = le « 0 call-site » de #357).
//
// Colonne fantôme : `colonne_fantome_g7` n'existe dans aucune table.
// =============================================================================
import { createServerClient } from '@supabase/ssr';
import { createSupabaseServerClient } from '@/lib/api-auth.js';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';

// Motif #357 exact : factory `createSupabaseServerClient` (createServerClient
// sans générique), template literal multi-ligne, résultat renvoyé tel quel —
// aucun accès de propriété en aval pour faire rougir tsc.
export async function profilOpaque(): Promise<unknown> {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from('organisations')
    // G7-ATTENDU
    .select(
      `id, nom,
       colonne_fantome_g7,
       actif`,
    )
    .maybeSingle();
  return data;
}

// Même motif, via `createServerClient` appelé directement (middleware, routes
// auth, pages SSR).
export async function ssrDirect(): Promise<unknown> {
  const supabase = createServerClient('u', 'k', {
    db: { schema: 'plateforme' },
    cookies: { getAll: () => [], setAll: () => undefined },
  });
  const { data } = await supabase
    .from('factures')
    .select('id, colonne_fantome_g7'); // G7-ATTENDU
  return data;
}

// Accès en aval sur un select fantôme : compté UNE fois, à l'appel `.select`
// (les TS2339 en aval sont fusionnés).
export async function accesAval(): Promise<string | undefined> {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from('organisations')
    .select('id, colonne_fantome_g7') // G7-ATTENDU
    .maybeSingle();
  return data?.id;
}

// Filtre sur une colonne fantôme (client admin) — TS2345 historique.
export async function filtreAdmin(): Promise<unknown> {
  const { data } = await createAdminSupabaseClient()
    .from('organisations')
    .select('id')
    .eq('colonne_fantome_g7', 'x'); // G7-ATTENDU
  return data;
}

// Écriture avec une clé fantôme.
export async function ecritureFantome(): Promise<void> {
  const supabase = createSupabaseServerClient();
  await supabase
    .from('organisations')
    .update({ colonne_fantome_g7: 'x' }) // G7-ATTENDU
    .eq('id', 'x');
}

// Témoins négatifs : colonnes réelles, y compris embed et multi-ligne. Aucun
// diagnostic colonne-DB attendu (anti faux positif).
export async function temoinsValides(): Promise<unknown> {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from('organisations')
    .select(
      `id,
      nom,
      actif`,
    )
    .eq('id', 'x')
    .maybeSingle();
  return data;
}
