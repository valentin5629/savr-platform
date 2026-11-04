/**
 * En-têtes de sécurité HTTP posés sur toutes les réponses (`next.config.ts`).
 *
 * Destinations du navigateur recensées le 2026-11-04 (code + relecture) :
 * - notre site (pages, API, polices auto-hébergées par next/font) ;
 * - l'API d'authentification Supabase (déconnexion, lecture et rafraîchissement
 *   de session par le client navigateur `createBrowserSupabaseClient`) ;
 * - Sentry, région Europe (`*.ingest.de.sentry.io`) ;
 * - des images : URL présignées R2, et photos des transporteurs servies par
 *   leur propre stockage (hôte non connu d'avance), d'où `img-src https:`.
 * Une destination ajoutée côté navigateur doit l'être ici, sinon il la bloque.
 */

const SUPABASE = 'https://*.supabase.co';
const SENTRY_EUROPE = 'https://*.ingest.de.sentry.io';

// Origine de NEXT_PUBLIC_SUPABASE_URL quand ce n'est pas un projet hébergé
// (base locale de l'E2E de la CI : http://localhost:54321). Ignorée si invalide.
function origineSupabaseLocale(supabaseUrl: string | undefined): string | null {
  if (!supabaseUrl) return null;
  try {
    const origine = new URL(supabaseUrl).origin;
    return origine.endsWith('.supabase.co') ? null : origine;
  } catch {
    return null;
  }
}

export function politiqueDeContenu(
  production: boolean,
  supabaseUrl?: string,
): string {
  const connexions = ["'self'", SUPABASE];
  const locale = origineSupabaseLocale(supabaseUrl);
  if (locale) connexions.push(locale);
  connexions.push(SENTRY_EUROPE);
  // `next dev` ouvre une websocket pour le rechargement à chaud.
  if (!production) connexions.push('ws:');

  return [
    "default-src 'self'",
    // Next.js injecte des scripts en ligne au chargement de la page ;
    // `next dev` a en plus besoin d'`eval` (rechargement à chaud).
    `script-src 'self' 'unsafe-inline'${production ? '' : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${connexions.join(' ')}`,
    // Aperçu des gabarits d'email (iframe `srcDoc`, page Admin).
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // Pas d'`upgrade-insecure-requests` : HSTS force déjà le https sur nos
    // domaines, et l'E2E de la CI sert le build de production en http.
  ].join('; ');
}

export function enTetesSecurite(
  production: boolean,
  supabaseUrl?: string,
): { key: string; value: string }[] {
  return [
    {
      key: 'Content-Security-Policy',
      value: politiqueDeContenu(production, supabaseUrl),
    },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    {
      key: 'Permissions-Policy',
      value: 'camera=(), microphone=(), geolocation=(), payment=()',
    },
  ];
}
