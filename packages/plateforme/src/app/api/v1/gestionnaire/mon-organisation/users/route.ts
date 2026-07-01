import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { sendEmail } from '@savr/shared/src/email/index.js';

const ROLES: ClientRole[] = ['gestionnaire_lieux'];

// GET /api/v1/gestionnaire/mon-organisation/users
// Liste des membres de la propre organisation (F5 — gestionnaire_lieux peut gérer les users de son org).
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;
  void auth;

  const supabase = createSupabaseServerClient();

  const { data, error } = await supabase
    .from('users')
    .select(
      `id, email, prenom, nom, role, actif, created_at, derniere_connexion`,
    )
    .order('nom');

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: data ?? [] });
}

// POST /api/v1/gestionnaire/mon-organisation/users
// Invitation d'un nouveau membre (F5 — INSERT users WHERE organisation_id = self).
// Body : { email, prenom, nom, role }
// Role autorisé : gestionnaire_lieux uniquement (pas d'escalade de privilège).
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;

  const supabase = createSupabaseServerClient();
  const admin = createAdminSupabaseClient();

  let body: { email?: string; prenom?: string; nom?: string; role?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }

  const { email, prenom, nom, role } = body;
  if (!email || !prenom || !nom)
    return NextResponse.json(
      { error: 'email, prenom et nom sont requis' },
      { status: 400 },
    );

  // Seul le rôle gestionnaire_lieux peut être créé (pas d'escalade de privilège)
  const roleInvite = role ?? 'gestionnaire_lieux';
  if (roleInvite !== 'gestionnaire_lieux')
    return NextResponse.json(
      { error: 'Seul le rôle gestionnaire_lieux peut être invité ici' },
      { status: 403 },
    );

  // Vérifier que l'email n'est pas déjà utilisé dans l'organisation
  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  if (existing)
    return NextResponse.json(
      { error: 'Cet email est déjà associé à un compte' },
      { status: 409 },
    );

  // Récupérer le nom de l'organisation pour le template email
  const { data: org } = await admin
    .from('organisations')
    .select('nom')
    .eq('id', auth.ctx.organisationId)
    .maybeSingle();

  // Créer le compte Auth (service_role requis). On n'utilise PAS inviteUserByEmail :
  // il enverrait un email natif Supabase non brandé, alors que le CDC §06.05 F5 exige
  // l'email template §06.02 n°17 `invitation_utilisateur` avec lien d'activation. Même
  // mécanisme que la route Admin (createUser + generateLink recovery), un seul email.
  const motDePasseTemporaire =
    Math.random().toString(36).slice(2, 10) + 'Savr1!';

  const { data: authData, error: authError } =
    await admin.auth.admin.createUser({
      email,
      password: motDePasseTemporaire,
      email_confirm: true,
      user_metadata: { prenom, nom },
    });

  if (authError || !authData.user)
    return NextResponse.json(
      { error: authError?.message ?? 'Erreur création compte' },
      { status: 422 },
    );

  const userId = authData.user.id;

  // Le collaborateur invité devient gestionnaire_lieux de la même organisation
  // (CDC §06.05 F5 + RLS F5 `users INSERT organisation_id = self`).
  const { error: userError } = await admin.from('users').insert({
    id: userId,
    organisation_id: auth.ctx.organisationId,
    email,
    prenom,
    nom,
    role: roleInvite,
  });

  if (userError) {
    // Rollback compte Auth (best-effort) pour ne pas laisser un user orphelin.
    await admin.auth.admin.deleteUser(userId).catch(() => null);
    return NextResponse.json({ error: userError.message }, { status: 422 });
  }

  // Lien d'activation (validité 7 jours, gérée par Supabase Auth) → écran set password.
  const { data: linkData } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: {
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/auth/new-password`,
    },
  });
  const lienActivation =
    linkData?.properties?.action_link ??
    `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/auth/login`;

  // Email d'invitation brandé (template catalogue §06.02 n°17). La variable
  // `lien_invitation` est REQUISE (email_templates.variables) : sans elle, sendEmail
  // refuse l'envoi et trace MISSING_VARIABLE.
  await sendEmail(
    'invitation_utilisateur',
    email,
    {
      prenom: prenom ?? '',
      organisation_nom: org?.nom ?? '',
      lien_invitation: lienActivation,
    },
    { entityType: 'organisation', entityId: auth.ctx.organisationId },
  );

  return NextResponse.json({ data: { id: userId, email } }, { status: 201 });
}
