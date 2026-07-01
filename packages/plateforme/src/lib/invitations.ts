import { sendEmail } from '@savr/shared/src/email/index.js';
import type { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';

type AdminClient = ReturnType<typeof createAdminSupabaseClient>;

// Mode d'invitation d'un collaborateur (décision Val 2026-07-01 : les deux coexistent).
//  - `direct`       : l'invitant provisionne le compte tout de suite (createUser + insert
//                     profil), l'invité reçoit un lien d'activation. Rattachement garanti.
//  - `self_service` : l'invité crée lui-même son compte (prénom/nom/mot de passe + CGU)
//                     via un lien ; le rattachement à l'org de l'invitant est garanti par
//                     les metadata du compte « invited » (posées côté serveur).
export type InvitationMode = 'direct' | 'self_service';

export function parseInvitationMode(raw: unknown): InvitationMode {
  return raw === 'self_service' ? 'self_service' : 'direct';
}

export interface SelfServiceInvitationInput {
  email: string;
  organisationId: string;
  role: string;
  organisationNom: string;
}

// Envoie une invitation self-service : crée le compte Auth en état « invited » porteur
// des metadata `organisation_id` + `role` (non modifiables par l'invité), puis envoie
// l'email brandé `invitation_utilisateur` avec un lien vers la page d'acceptation portant
// le token. Le profil `plateforme.users` N'EST PAS créé ici — il l'est à l'acceptation
// (`POST /api/auth/accept-invitation`), avec capture des CGU.
export async function sendSelfServiceInvitation(
  admin: AdminClient,
  { email, organisationId, role, organisationNom }: SelfServiceInvitationInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: linkData, error } = await admin.auth.admin.generateLink({
    type: 'invite',
    email,
    options: {
      data: { organisation_id: organisationId, role },
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/auth/accept-invitation`,
    },
  });

  const hashedToken = linkData?.properties?.hashed_token;
  if (error || !hashedToken) {
    return { ok: false, error: error?.message ?? 'Lien invitation non généré' };
  }

  const lienInvitation = `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/auth/accept-invitation?token_hash=${hashedToken}&type=invite`;

  // `prenom` inconnu à ce stade (l'invité le saisira) → chaîne vide : la variable reste
  // définie, donc sendEmail ne refuse pas l'envoi (findMissingVariables).
  await sendEmail(
    'invitation_utilisateur',
    email,
    {
      prenom: '',
      organisation_nom: organisationNom,
      lien_invitation: lienInvitation,
    },
    { entityType: 'organisation', entityId: organisationId },
  );

  return { ok: true };
}
