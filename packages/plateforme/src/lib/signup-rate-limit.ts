/**
 * Rate-limiting du formulaire d'inscription — §15 §2.6 : max 5 tentatives/IP/heure.
 *
 * La route signup utilise `auth.admin.createUser` (service role) qui CONTOURNE la
 * protection native Supabase → sans ce limiteur l'endpoint est illimité.
 *
 * ⚠ V1 best-effort, non distribué (état par instance serverless). Suffisant pour
 * freiner l'abus basique ; un attaquant réparti sur plusieurs instances/IP n'est
 * pas couvert. Le limiteur DISTRIBUÉ (table DB ou service dédié) est une décision
 * V1.1/archi laissée à Val — cf. _Divergences/RATE-LIMIT-SIGNUP_20260622.md.
 * Pas de Redis (interdit §16 sans Val), pas de table DB (hors DDL cible → G1).
 */

const WINDOW_MS = 60 * 60 * 1000; // fenêtre glissante d'1 heure
const MAX_ATTEMPTS = 5; // §15 §2.6 — la 6e tentative est refusée
const MAX_TRACKED_IPS = 10_000; // garde-fou mémoire (best-effort)

// Map IP -> timestamps (ms) des tentatives dans la fenêtre courante.
const attempts = new Map<string, number[]>();

export interface RateLimitResult {
  limited: boolean;
  /** Secondes avant qu'une tentative se libère (header Retry-After). */
  retryAfterSeconds: number;
}

/**
 * Enregistre/évalue une tentative pour `ip`. Effet de bord : consomme un crédit
 * quand la tentative est autorisée. `now` est injectable pour les tests.
 */
export function checkSignupRateLimit(
  ip: string,
  now: number = Date.now(),
): RateLimitResult {
  const cutoff = now - WINDOW_MS;
  const recent = (attempts.get(ip) ?? []).filter((t) => t > cutoff);

  if (recent.length >= MAX_ATTEMPTS) {
    // Conserve la fenêtre nettoyée ; ne consomme pas de crédit supplémentaire.
    attempts.set(ip, recent);
    const oldest = recent[0]!;
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((oldest + WINDOW_MS - now) / 1000),
    );
    return { limited: true, retryAfterSeconds };
  }

  recent.push(now);
  attempts.set(ip, recent);

  // Garde-fou mémoire : éviction grossière (FIFO d'insertion) si trop d'IP suivies.
  if (attempts.size > MAX_TRACKED_IPS) {
    const oldestKey = attempts.keys().next().value;
    if (oldestKey !== undefined) attempts.delete(oldestKey);
  }

  return { limited: false, retryAfterSeconds: 0 };
}

/**
 * Extrait l'IP cliente : 1er hop de `x-forwarded-for` (positionné par Vercel),
 * fallback `x-real-ip`, puis `unknown` (le bucket partagé reste mieux que rien).
 */
export function extractClientIp(req: { headers: Headers }): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}

/** Réinitialise l'état en mémoire (tests uniquement). */
export function _resetSignupRateLimit(): void {
  attempts.clear();
}
