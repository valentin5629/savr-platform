import type { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { lireJetonInvitation } from '@/lib/auth/jeton-invitation.js';

type AdminSupabase = ReturnType<typeof createAdminSupabaseClient>;

/**
 * État d'un lien d'invitation, lu par la page `/invitation` (affichage) et par
 * `POST /api/auth/invitation` (enregistrement du mot de passe). Une seule
 * fonction, pour que la page n'annonce jamais un lien que la route refuserait.
 *
 * - `invalide` : jeton absent, tronqué ou falsifié.
 * - `expire`   : plus de 7 jours.
 * - `utilise`  : le nonce du compte ne correspond plus (mot de passe déjà choisi,
 *                ou invitation renvoyée depuis), ou compte introuvable.
 * - `inactif`  : compte désactivé entre l'invitation et le clic.
 */
export type EtatInvitation =
  | { ok: true; userId: string; nonce: string; prenom: string; email: string }
  | { ok: false; motif: 'invalide' | 'expire' | 'utilise' | 'inactif' };

export async function lireEtatInvitation(
  admin: AdminSupabase,
  jeton: string | null | undefined,
): Promise<EtatInvitation> {
  const lecture = lireJetonInvitation(jeton);
  if (!lecture.ok) return lecture;

  const { data, error } = await admin.auth.admin.getUserById(lecture.userId);
  const compte = data?.user;
  const nonceCompte = (compte?.app_metadata as { invitation_nonce?: unknown })
    ?.invitation_nonce;
  if (error || !compte || nonceCompte !== lecture.nonce) {
    return { ok: false, motif: 'utilise' };
  }

  const { data: profil } = await admin
    .from('users')
    .select('prenom, actif')
    .eq('id', lecture.userId)
    .maybeSingle();
  const p = profil as { prenom?: string | null; actif?: boolean } | null;
  if (!p || p.actif === false) return { ok: false, motif: 'inactif' };

  return {
    ok: true,
    userId: lecture.userId,
    nonce: lecture.nonce,
    prenom: p.prenom?.trim() ?? '',
    email: compte.email ?? '',
  };
}
