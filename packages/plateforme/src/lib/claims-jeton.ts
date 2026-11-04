/**
 * Claims du payload d'un JWT Supabase, SANS vérification de signature.
 *
 * À n'appeler que sur le jeton d'une session déjà validée auprès de GoTrue
 * (`getUser()`, `exchangeCodeForSession()`…). Module PUR, compatible Edge
 * (`atob`, pas de `Buffer`). Jeton absent ou illisible → `{}`.
 */
export function claimsJeton(
  token: string | null | undefined,
): Record<string, unknown> {
  try {
    const payload = token?.split('.')[1];
    if (!payload) return {};
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    const claims: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return claims !== null && typeof claims === 'object'
      ? (claims as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
