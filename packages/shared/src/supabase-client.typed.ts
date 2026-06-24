// =============================================================================
// G7 (colonne-DB par route) — SHIM TYPÉ, report-only.
// =============================================================================
// Ce module n'est JAMAIS importé par le code de production. Il sert UNIQUEMENT
// au job CI `column-db` (mode rapport) via `tsconfig.column-db.json`, qui remappe
// l'import `@savr/shared/src/supabase-client.js` vers ce fichier.
//
// Effet : pendant la passe `tsc -p tsconfig.column-db.json`, les factories
// `createAdminSupabaseClient()` / `createBrowserSupabaseClient()` retournent un
// `SupabaseClient<Database>` au lieu du `SupabaseClient` non-typé de prod. Les
// `.eq('colonne', …)`, `.select('colonne')`, `.insert({ colonne })`,
// `.update({ colonne })` ciblant une colonne INEXISTANTE du schéma courant
// deviennent alors des erreurs de compilation → comptées par
// `scripts/check-column-db.ts`.
//
// Pourquoi un shim séparé (et pas typer le client de prod) : le typecheck
// bloquant (`lint-typecheck-test`) doit rester VERT en T0 (mode rapport) malgré
// les ~118 gaps de l'audit. Le client de prod reste donc non-typé ; le typage
// vit ici, derrière l'overlay report-only. Le flip bloquant (T1) se fait quand
// les routes fautives sont corrigées (lots R3 / R18).
// =============================================================================
import type { SupabaseClient as RawSupabaseClient } from '@supabase/supabase-js';
import {
  createAdminSupabaseClient as _createAdminSupabaseClient,
  createBrowserSupabaseClient as _createBrowserSupabaseClient,
} from './supabase-client.js';
import type { Database } from './database.types.js';

// Schéma applicatif par défaut (= `db: { schema: 'plateforme' }` du runtime).
// `.from('table')` se résout alors contre `Database['plateforme']['Tables']`.
// 2e générique = nom du schéma (le reste se dérive : Schema = Database['plateforme']).
export type SupabaseClient = RawSupabaseClient<Database, 'plateforme'>;

export function createBrowserSupabaseClient(): SupabaseClient {
  return _createBrowserSupabaseClient() as unknown as SupabaseClient;
}

export function createAdminSupabaseClient(): SupabaseClient {
  return _createAdminSupabaseClient() as unknown as SupabaseClient;
}
