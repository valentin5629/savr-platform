// Vérification de signature webhook svix (provider Resend) — BL-P1-API-09.
// Implémentée avec node:crypto (cohérent avec l'autre webhook entrant de la Plateforme,
// pas de dépendance SDK ajoutée). Schéma svix standard (https://docs.svix.com/receiving/verifying-payloads) :
//   • secret format `whsec_<base64>` ; clé = base64-decode après le préfixe.
//   • contenu signé = `${svix-id}.${svix-timestamp}.${rawBody}`.
//   • signature attendue = base64(HMAC-SHA256(clé, contenu)).
//   • header `svix-signature` = liste espacée de `v1,<base64>` → match timing-safe
//     d'au moins une.
//   • anti-rejeu : `svix-timestamp` dans une fenêtre de tolérance (±5 min).

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface SvixHeaders {
  id: string;
  timestamp: string;
  signature: string;
}

const TOLERANCE_SECONDS = 5 * 60;

/** Calcule la signature svix base64 d'un payload (réutilisé en test pour forger un envoi valide). */
export function computeSvixSignature(
  secret: string,
  id: string,
  timestamp: string,
  body: string,
): string {
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const toSign = `${id}.${timestamp}.${body}`;
  return createHmac('sha256', secretBytes).update(toSign).digest('base64');
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Vérifie une signature webhook svix. Fail-closed : tout champ manquant, timestamp
 * hors fenêtre ou signature non concordante → false (aucune écriture côté appelant).
 */
export function verifySvixSignature(
  secret: string,
  headers: Partial<SvixHeaders>,
  body: string,
  nowSeconds?: number,
): boolean {
  const { id, timestamp, signature } = headers;
  if (!secret || !id || !timestamp || !signature) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const now = nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > TOLERANCE_SECONDS) return false;

  const expected = computeSvixSignature(secret, id, timestamp, body);
  for (const part of signature.split(' ')) {
    if (!part) continue;
    const comma = part.indexOf(',');
    const provided = comma === -1 ? part : part.slice(comma + 1);
    if (safeEqual(provided, expected)) return true;
  }
  return false;
}
