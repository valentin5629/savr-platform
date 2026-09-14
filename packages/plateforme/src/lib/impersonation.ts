// Liaison serveur d'une impersonation (§09 §7, §15 §2.3).
//
// La route `POST /api/v1/admin/users/[id]/impersoner` (requireAdmin) pose sur
// l'utilisateur cible `app_metadata.impersonation_en_attente = { empreinte,
// expire_le }` et place un jeton aléatoire dans le lien. Le callback
// `/auth/impersonate-callback` ne pose `impersonator_id` que si l'empreinte
// recalculée à partir du jeton ET de l'admin annoncé correspond, dans le délai,
// puis consomme l'entrée. Sans ça, n'importe quel utilisateur muni d'un OTP
// magiclink pour son propre compte pouvait s'attribuer un `impersonator_id`
// arbitraire (écritures audit_log imputées à un admin).
//
// Pourquoi `app_metadata` : seul le service-role peut l'écrire (GoTrue refuse
// toute modification par l'utilisateur), c'est déjà le support du flag
// `impersonator_id`, et aucune table dédiée n'existe côté plateforme dans le
// DDL cible. Contrepartie : `app_metadata` est recopié dans le JWT de la cible →
// on n'y met ni l'id admin en clair, ni rien de dérivé du `token_hash` (espace
// OTP de 10^6 : son empreinte serait inversible hors ligne). Seule l'empreinte
// d'un jeton de 256 bits y figure.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const CLE_IMPERSONATION_EN_ATTENTE = 'impersonation_en_attente';

// Le lanceur navigue vers le lien dès sa réception : quelques minutes suffisent.
export const IMPERSONATION_LIEN_TTL_MS = 5 * 60 * 1000;

interface ImpersonationEnAttente {
  empreinte: string;
  expire_le: string;
}

function empreinte(jeton: string, adminId: string, cibleId: string): string {
  return createHash('sha256')
    .update(`${jeton}:${adminId}:${cibleId}`)
    .digest('hex');
}

export function preparerImpersonation(
  adminId: string,
  cibleId: string,
  maintenant = Date.now(),
): { jeton: string; enAttente: ImpersonationEnAttente } {
  const jeton = randomBytes(32).toString('base64url');
  return {
    jeton,
    enAttente: {
      empreinte: empreinte(jeton, adminId, cibleId),
      expire_le: new Date(maintenant + IMPERSONATION_LIEN_TTL_MS).toISOString(),
    },
  };
}

export type VerdictImpersonation = 'ok' | 'absente' | 'expiree' | 'invalide';

export function verifierImpersonation(
  appMetadata: Record<string, unknown> | undefined,
  jeton: string,
  adminId: string,
  cibleId: string,
  maintenant = Date.now(),
): VerdictImpersonation {
  const enAttente = appMetadata?.[CLE_IMPERSONATION_EN_ATTENTE] as
    | Partial<ImpersonationEnAttente>
    | null
    | undefined;
  if (
    !enAttente ||
    typeof enAttente.empreinte !== 'string' ||
    typeof enAttente.expire_le !== 'string'
  ) {
    return 'absente';
  }

  const expireLe = Date.parse(enAttente.expire_le);
  if (Number.isNaN(expireLe) || expireLe <= maintenant) return 'expiree';

  const attendue = Buffer.from(enAttente.empreinte, 'hex');
  const recue = Buffer.from(empreinte(jeton, adminId, cibleId), 'hex');
  if (attendue.length !== recue.length || !timingSafeEqual(attendue, recue)) {
    return 'invalide';
  }
  return 'ok';
}
