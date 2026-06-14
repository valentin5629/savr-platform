import { createClient, type SupabaseClient } from '@supabase/supabase-js';
export type { SupabaseClient } from '@supabase/supabase-js';
import { createBrowserClient } from '@supabase/ssr';

function getUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL manquant');
  return url;
}

// Client navigateur — clé anon, gestion cookies SSR via @supabase/ssr.
export function createBrowserSupabaseClient(): SupabaseClient {
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY manquant');
  return createBrowserClient(getUrl(), anonKey);
}

// Client serveur admin — clé service_role, bypass RLS.
// Usage : API Routes + actions serveur + migrations ; jamais exposé au navigateur.
export function createAdminSupabaseClient(): SupabaseClient {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY manquant');
  return createClient(getUrl(), serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
