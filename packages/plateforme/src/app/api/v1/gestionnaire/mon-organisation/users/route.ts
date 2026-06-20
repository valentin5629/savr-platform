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

  // Créer le user via le client admin (service_role requis pour inviteUserByEmail)
  const { data: invited, error: inviteErr } =
    await admin.auth.admin.inviteUserByEmail(email, {
      data: { prenom, nom, role: roleInvite },
    });

  if (inviteErr)
    return NextResponse.json({ error: inviteErr.message }, { status: 500 });

  // Envoyer l'email d'invitation via template catalogue §06.02 n°17
  await sendEmail(
    'invitation_utilisateur',
    email,
    { prenom: prenom ?? '', organisation_nom: org?.nom ?? '' },
    { entityType: 'organisation', entityId: auth.ctx.organisationId },
  );

  return NextResponse.json(
    { data: { id: invited.user?.id, email } },
    { status: 201 },
  );
}
