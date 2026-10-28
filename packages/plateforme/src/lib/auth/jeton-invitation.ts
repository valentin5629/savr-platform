import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Jeton du lien d'invitation (CDC §06.02 §17 : « Ce lien est valide pendant
 * 7 jours », décision Val 2026-10-28).
 *
 * Pourquoi un jeton Savr plutôt qu'un lien Supabase : un lien de récupération
 * Supabase expire au plus tard après 24 h (plafond de la configuration
 * d'authentification, partagé avec « mot de passe oublié ») et ne peut servir
 * qu'une fois, si bien qu'une messagerie qui analyse les liens (Outlook) le
 * consomme avant le clic. Ce jeton-ci ne fait rien quand on l'ouvre : il
 * n'est utilisé qu'à l'envoi du mot de passe choisi.
 *
 * Format : `<charge>.<signature>`, en base64url. La charge porte l'utilisateur,
 * l'instant d'expiration et un nonce à usage unique, recopié dans l'`app_metadata`
 * du compte (non modifiable par l'utilisateur). La signature est un HMAC-SHA256
 * dont la clé est dérivée de la clé de service Supabase, déjà secrète côté
 * serveur : aucun réglage nouveau.
 */

export const DUREE_INVITATION_MS = 7 * 24 * 60 * 60 * 1000;

interface Charge {
  u: string; // identifiant du compte invité
  n: string; // nonce à usage unique
  e: number; // expiration, en ms depuis l'époque
}

export type LectureJeton =
  | { ok: true; userId: string; nonce: string; expireA: number }
  | { ok: false; motif: 'invalide' | 'expire' };

function cle(): Buffer {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error('SUPABASE_SERVICE_ROLE_KEY manquante');
  return createHmac('sha256', secret).update('savr:invitation:v1').digest();
}

function signer(charge: string): string {
  return createHmac('sha256', cle()).update(charge).digest('base64url');
}

export function nouveauNonce(): string {
  return randomBytes(24).toString('base64url');
}

export function creerJetonInvitation(params: {
  userId: string;
  nonce: string;
  expireA: number;
}): string {
  const charge: Charge = {
    u: params.userId,
    n: params.nonce,
    e: params.expireA,
  };
  const encodee = Buffer.from(JSON.stringify(charge)).toString('base64url');
  return `${encodee}.${signer(encodee)}`;
}

export function lireJetonInvitation(
  jeton: string | null | undefined,
  maintenant: number = Date.now(),
): LectureJeton {
  if (typeof jeton !== 'string' || jeton.length > 1000) {
    return { ok: false, motif: 'invalide' };
  }
  const parties = jeton.split('.');
  if (parties.length !== 2) return { ok: false, motif: 'invalide' };
  const [encodee, signature] = parties as [string, string];

  const attendue = Buffer.from(signer(encodee));
  const recue = Buffer.from(signature);
  if (attendue.length !== recue.length || !timingSafeEqual(attendue, recue)) {
    return { ok: false, motif: 'invalide' };
  }

  let charge: Partial<Charge>;
  try {
    charge = JSON.parse(Buffer.from(encodee, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, motif: 'invalide' };
  }
  if (
    typeof charge.u !== 'string' ||
    typeof charge.n !== 'string' ||
    typeof charge.e !== 'number' ||
    !charge.u ||
    !charge.n
  ) {
    return { ok: false, motif: 'invalide' };
  }
  if (maintenant >= charge.e) return { ok: false, motif: 'expire' };
  return { ok: true, userId: charge.u, nonce: charge.n, expireA: charge.e };
}
