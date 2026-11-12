/**
 * Plafond des demandes « mot de passe oublié » (CDC §09 §1 : 3 demandes par heure
 * et par email).
 *
 * Depuis le 2026-11-06 (Val), le lien est fabriqué par `auth.admin.generateLink`
 * et l'email part par Resend : le plafond natif de Supabase Auth ne s'applique
 * plus. Ce module le remplace, et ajoute un plafond par adresse IP pour qu'une
 * même source ne puisse pas viser des centaines d'adresses.
 *
 * ⚠ Même limite que `signup-rate-limit.ts` : compteurs en mémoire, par instance
 * de serveur. C'est un frein, pas un plafond exact.
 */

const FENETRE_MS = 60 * 60 * 1000;
export const MAX_DEMANDES_PAR_EMAIL = 3;
export const MAX_DEMANDES_PAR_IP = 10;
const MAX_CLES_SUIVIES = 10_000; // garde-fou mémoire

// Clé → instants (ms) des demandes acceptées dans la fenêtre courante.
const demandes = new Map<string, number[]>();

function recentes(cle: string, maintenant: number): number[] {
  return (demandes.get(cle) ?? []).filter((t) => t > maintenant - FENETRE_MS);
}

/**
 * Rend `true` si la demande dépasse un des deux plafonds (rien n'est compté),
 * `false` sinon (la demande est comptée). `maintenant` est injectable pour les tests.
 */
export function demandeReinitialisationLimitee(
  email: string,
  ip: string,
  maintenant: number = Date.now(),
): boolean {
  const cleEmail = `email:${email.trim().toLowerCase()}`;
  const cleIp = `ip:${ip}`;
  const parEmail = recentes(cleEmail, maintenant);
  const parIp = recentes(cleIp, maintenant);
  if (
    parEmail.length >= MAX_DEMANDES_PAR_EMAIL ||
    parIp.length >= MAX_DEMANDES_PAR_IP
  ) {
    return true;
  }
  demandes.set(cleEmail, [...parEmail, maintenant]);
  demandes.set(cleIp, [...parIp, maintenant]);
  while (demandes.size > MAX_CLES_SUIVIES) {
    const plusAncienne = demandes.keys().next().value;
    if (plusAncienne === undefined) break;
    demandes.delete(plusAncienne);
  }
  return false;
}

/** Réinitialise l'état en mémoire (tests uniquement). */
export function _resetDemandesReinitialisation(): void {
  demandes.clear();
}
