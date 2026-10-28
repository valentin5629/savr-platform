import type { NextRequest } from 'next/server';
import type { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { logger } from '@savr/shared/src/logger/index.js';
import { urlApplication } from '@/lib/url-application.js';
import { ROUTES } from '@/lib/routes';
import {
  creerJetonInvitation,
  DUREE_INVITATION_MS,
  nouveauNonce,
} from '@/lib/auth/jeton-invitation.js';

type AdminSupabase = ReturnType<typeof createAdminSupabaseClient>;

/**
 * Prépare le lien de l'email d'invitation (valable 7 jours, à usage unique) d'un
 * compte que l'appelant vient de créer : un nonce neuf est posé dans
 * l'`app_metadata` du compte (une nouvelle invitation invalide la précédente),
 * puis signé dans le jeton du lien `/invitation`.
 *
 * Si le nonce ne peut pas être posé, le lien mène à « mot de passe oublié » : la
 * personne peut toujours obtenir un lien d'accès, rien n'est perdu.
 */
export async function preparerLienInvitation(
  admin: AdminSupabase,
  req: NextRequest,
  userId: string,
): Promise<string> {
  const nonce = nouveauNonce();
  const { error } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: { invitation_nonce: nonce },
  });
  if (error) {
    logger.error('invitation.nonce_non_pose', { code: error.code ?? null });
    return urlApplication(req, ROUTES.resetPassword);
  }
  const jeton = creerJetonInvitation({
    userId,
    nonce,
    expireA: Date.now() + DUREE_INVITATION_MS,
  });
  return urlApplication(
    req,
    `${ROUTES.invitation}?jeton=${encodeURIComponent(jeton)}`,
  );
}
