import { createClient, type SupabaseClient } from '@supabase/supabase-js';
export type { SupabaseClient } from '@supabase/supabase-js';
import { createBrowserClient } from '@supabase/ssr';

function getUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL manquant');
  return url;
}

// Schéma applicatif par défaut. Toutes nos tables sont dans `plateforme.*`
// (et `shared.*`) — jamais `public`. Sans ce réglage, supabase-js envoie
// `Accept-Profile: public` et toute requête échoue (PGRST205 public.<table>
// introuvable). Pour les tables `shared.*`, utiliser `.schema('shared')`.
const DEFAULT_SCHEMA = 'plateforme';

// Client navigateur — clé anon, gestion cookies SSR via @supabase/ssr.
export function createBrowserSupabaseClient(): SupabaseClient {
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY manquant');
  // Cast : le schéma non-`public` change les génériques du type retourné ;
  // l'objet runtime est identique et tous les appelants typent `SupabaseClient`.
  return createBrowserClient(getUrl(), anonKey, {
    db: { schema: DEFAULT_SCHEMA },
  }) as unknown as SupabaseClient;
}

// Client serveur admin — clé service_role, bypass RLS.
// Usage : API Routes + actions serveur + migrations ; jamais exposé au navigateur.
export function createAdminSupabaseClient(): SupabaseClient {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY manquant');
  return createClient(getUrl(), serviceKey, {
    db: { schema: DEFAULT_SCHEMA },
    auth: { autoRefreshToken: false, persistSession: false },
  }) as unknown as SupabaseClient;
}
