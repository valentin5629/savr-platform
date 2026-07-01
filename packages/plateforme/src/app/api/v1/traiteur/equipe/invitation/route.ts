import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { sendEmail } from '@savr/shared/src/email/index.js';
import { requireUser, type ClientRole } from '@/lib/api-auth.js';
import {
  parseInvitationMode,
  sendSelfServiceInvitation,
} from '@/lib/invitations.js';

// Invitation de collaborateur = Manager only (§06.04 §6). Le commercial n'a pas
// la gestion des utilisateurs.
const MANAGER_ROLE: ClientRole[] = ['traiteur_manager'];

// POST /api/v1/traiteur/equipe/invitation — invite un collaborateur
// (n'importe quelle adresse email autorisée, décision 2026-05-29).
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, MANAGER_ROLE);
  if (auth.error) return auth.error;
  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    prenom?: string;
    nom?: string;
    mode?: string;
  };
  const mode = parseInvitationMode(body.mode);
  const email = (body.email ?? '').trim().toLowerCase();
  const prenom = (body.prenom ?? '').trim();
  const nom = (body.nom ?? '').trim();
  if (!email) {
    return NextResponse.json({ error: 'Email requis' }, { status: 422 });
  }
  // Mode `direct` : prenom + nom obligatoires (compte provisionné tout de suite,
  // `plateforme.users.prenom`/`nom` sont NOT NULL). Mode `self_service` : l'invité
  // saisira lui-même son nom à l'acceptation → seul l'email est requis ici.
  if (mode === 'direct' && (!prenom || !nom)) {
    return NextResponse.json(
      { error: 'email, prenom et nom sont requis' },
      { status: 422 },
    );
  }

  const admin = createAdminSupabaseClient();

  // Refus si l'email est déjà un membre actif de l'organisation (pas de doublon)
  const { data: existing } = await admin
    .from('users')
    .select('id')
    .eq('organisation_id', auth.ctx.organisationId)
    .ilike('email', email)
    .maybeSingle();
  if (existing) {
    return NextResponse.json(
      { error: 'Cet email est déjà un membre de votre équipe.' },
      { status: 409 },
    );
  }

  const { data: org } = await admin
    .from('organisations')
    .select('nom')
    .eq('id', auth.ctx.organisationId)
    .maybeSingle();

  // Mode self-service : l'invité crée lui-même son compte (nom + mot de passe + CGU)
  // via le lien. Le rattachement à l'org de l'invitant reste garanti (metadata posées
  // côté serveur, rôle `traiteur_commercial`).
  if (mode === 'self_service') {
    const res = await sendSelfServiceInvitation(admin, {
      email,
      organisationId: auth.ctx.organisationId,
      role: 'traiteur_commercial',
      organisationNom: org?.nom ?? '',
    });
    if (!res.ok) {
      return NextResponse.json({ error: res.error }, { status: 422 });
    }
    return NextResponse.json(
      { data: { invitation: 'envoyee', email, mode } },
      { status: 201 },
    );
  }

  // CDC §06.04 « Invitation de collaborateur » : le collaborateur est rattaché
  // AUTOMATIQUEMENT à l'organisation de l'invitant, rôle `traiteur_commercial`
  // (décision Val 2026-07-01 : rattachement garanti). On provisionne directement le
  // compte — même mécanisme que la route Admin / gestionnaire F5 — pour poser
  // `organisation_id = org de l'invitant` de façon déterministe (un lien de signup
  // self-service ne rattacherait que par domaine email, ce qui échoue sur les emails
  // perso pourtant autorisés). Pas d'inviteUserByEmail : email brandé uniquement.
  const motDePasseTemporaire =
    Math.random().toString(36).slice(2, 10) + 'Savr1!';

  const { data: authData, error: authError } =
    await admin.auth.admin.createUser({
      email,
      password: motDePasseTemporaire,
      email_confirm: true,
      user_metadata: { prenom, nom },
    });

  if (authError || !authData.user) {
    return NextResponse.json(
      { error: authError?.message ?? 'Erreur création compte' },
      { status: 422 },
    );
  }

  const userId = authData.user.id;

  const { error: userError } = await admin.from('users').insert({
    id: userId,
    organisation_id: auth.ctx.organisationId,
    email,
    prenom,
    nom,
    role: 'traiteur_commercial',
  });

  if (userError) {
    // Rollback compte Auth (best-effort) pour ne pas laisser un user orphelin.
    await admin.auth.admin.deleteUser(userId).catch(() => null);
    return NextResponse.json({ error: userError.message }, { status: 422 });
  }

  // Lien d'activation (validité gérée par Supabase Auth) → écran set password.
  const { data: linkData } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: {
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/auth/new-password`,
    },
  });
  const lienInvitation =
    linkData?.properties?.action_link ??
    `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/auth/login`;

  // Email d'invitation brandé (template catalogue §06.02 n°17). La variable
  // `lien_invitation` est REQUISE (email_templates.variables) : sans elle, sendEmail
  // refuse l'envoi et trace MISSING_VARIABLE.
  await sendEmail(
    'invitation_utilisateur',
    email,
    {
      prenom,
      organisation_nom: org?.nom ?? '',
      lien_invitation: lienInvitation,
    },
    { entityType: 'organisation', entityId: auth.ctx.organisationId },
  );

  return NextResponse.json(
    { data: { invitation: 'envoyee', email, id: userId } },
    { status: 201 },
  );
}
