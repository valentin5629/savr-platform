// Espacement SORTANT défensif — « limiteur partagé » BL-P2-33 (R22g).
// =============================================================================
// §08 l.655 : rate-limit imposé côté Plateforme pour ne pas dépasser les quotas
// tiers (Pennylane 120 req/min, Resend 10 req/s). In-memory, PAR INSTANCE serverless,
// NON distribué — décision Val Q1 « Logs + défensif » (même doctrine que le limiteur
// entrant signup §15 §2.6 ; le quota distribué strict = V1.1, sans Redis ni table DB).
//
// Deux rôles complémentaires :
//   - espacement : intervalle minimal entre deux appels successifs vers un même tiers
//     → borne le débit À L'INTÉRIEUR d'un batch (seul cas de burst réel aux volumes An1) ;
//   - honorer Retry-After : après un 429 portant Retry-After, aucun appel avant l'échéance.
//
// Aux volumes An1 (~120 appels/JOUR), à débit nominal la fenêtre ne contient qu'un appel
// → l'espacement ne dort jamais ; il ne mord que sur les boucles (batch factures / envois
// groupés d'e-mails), exactement là où un 429 pourrait survenir.
// =============================================================================

export type OutboundTier = 'pennylane' | 'resend';

const MIN_INTERVAL_MS: Record<OutboundTier, number> = {
  pennylane: 500, // 120 req/min → ≥ 500 ms entre appels
  resend: 100, //    10 req/s   → ≥ 100 ms entre appels
};

const lastCallAt = new Map<OutboundTier, number>();
const notBefore = new Map<OutboundTier, number>();

let enabled = true;

// Test hook : les tests unitaires du throttle injectent leur horloge/sleep ; ce flag
// permet de neutraliser toute attente réelle si un test exerçait un chemin réel.
export function _setOutboundThrottleEnabled(v: boolean): void {
  enabled = v;
}
export function _resetOutboundThrottle(): void {
  lastCallAt.clear();
  notBefore.clear();
  enabled = true;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// À appeler AVANT chaque appel sortant vers `tier`. Dort le temps nécessaire pour
// respecter l'intervalle minimal ET un éventuel Retry-After en cours, puis réserve le
// créneau. `now`/`sleep` injectables pour les tests (déterministes, sans timer réel).
export async function throttleOutbound(
  tier: OutboundTier,
  now: () => number = Date.now,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<void> {
  if (!enabled) return;
  const t = now();
  const last = lastCallAt.get(tier);
  // 1er appel (aucun appel antérieur) : pas d'espacement à imposer — seul un Retry-After
  // en cours (notBefore) peut retarder. Les suivants respectent l'intervalle minimal.
  const earliest = Math.max(
    last === undefined ? 0 : last + MIN_INTERVAL_MS[tier],
    notBefore.get(tier) ?? 0,
  );
  const wait = earliest - t;
  if (wait > 0) await sleep(wait);
  // Réserve le créneau au plus tard atteint (empêche deux appels concurrents de coïncider).
  lastCallAt.set(tier, Math.max(t, earliest));
}

// À appeler quand `tier` renvoie 429 : décale le prochain créneau de `retryAfterSeconds`.
export function honorRetryAfter(
  tier: OutboundTier,
  retryAfterSeconds: number | null,
  now: () => number = Date.now,
): void {
  if (retryAfterSeconds && retryAfterSeconds > 0) {
    notBefore.set(tier, now() + retryAfterSeconds * 1000);
  }
}

// Parse l'en-tête Retry-After au format « secondes » (le format HTTP-date, rare côté API
// JSON, est ignoré → back-off palier standard de la retry policy §08 §6 prend le relais).
export function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const secs = Number(header.trim());
  return Number.isFinite(secs) && secs > 0 ? secs : null;
}
