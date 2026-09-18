// =============================================================================
// G7 (colonne-DB par route) — SHIM TYPÉ de `@supabase/ssr`, report-only.
// =============================================================================
// Jumeau de `supabase-client.typed.ts`, pour l'autre porte d'entrée du client :
// `createServerClient` de `@supabase/ssr`, appelé SANS générique par
// `createSupabaseServerClient` (`@/lib/api-auth.ts`), `page-auth.ts`, le
// middleware et ~15 routes. Sans générique, `Database = any` → client non typé →
// toute colonne fantôme de ces call-sites était INVISIBLE au gate (constat #357 :
// gestionnaire/mon-organisation/profil + factures, 42703 en runtime, 0 call-site
// remonté).
//
// `tsconfig.column-db.json` remappe l'import `@supabase/ssr` vers ce fichier.
// On ré-exporte le vrai module par son chemin profond (le package n'a pas de
// champ `exports`, et un chemin profond n'est pas capté par le remap exact —
// pas de boucle), en surchargeant `createServerClient` pour qu'il retourne
// `SupabaseClient<Database, 'plateforme'>`.
//
// JAMAIS importé par le code de production (exclu du `tsconfig.json` racine).
// =============================================================================
import type {
  SupabaseClient,
  SupabaseClientOptions,
} from '@supabase/supabase-js';
import { createServerClient as _createServerClient } from '@supabase/ssr/dist/module/index.js';
import type {
  CookieMethodsServer,
  CookieMethodsServerDeprecated,
  CookieOptionsWithName,
} from '@supabase/ssr/dist/module/index.js';
import type { Database } from './database.types.js';

export * from '@supabase/ssr/dist/module/index.js';

export function createServerClient(
  supabaseUrl: string,
  supabaseKey: string,
  options: SupabaseClientOptions<'plateforme'> & {
    cookieOptions?: CookieOptionsWithName;
    cookies: CookieMethodsServer | CookieMethodsServerDeprecated;
    cookieEncoding?: 'raw' | 'base64url';
  },
): SupabaseClient<Database, 'plateforme'> {
  return _createServerClient(
    supabaseUrl,
    supabaseKey,
    options as never,
  ) as unknown as SupabaseClient<Database, 'plateforme'>;
}
