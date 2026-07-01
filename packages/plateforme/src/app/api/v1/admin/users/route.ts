import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { sendEmail } from '@savr/shared/src/email/index.js';
import { requireStaff } from '@/lib/api-auth.js';
import { serverError, writeError } from '@/lib/api-helpers.js';
import {
  parseInvitationMode,
  sendSelfServiceInvitation,
} from '@/lib/invitations.js';

const ROLES_VALIDES = [
  'admin_savr',
  'ops_savr',
  'traiteur_manager',
  'traiteur_commercial',
  'agence',
  'gestionnaire_lieux',
  'client_organisateur',
] as const;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const { searchParams } = new URL(req.url);
  const organisation_id = searchParams.get('organisation_id');
  const role = searchParams.get('role');
  const actif = searchParams.get('actif');
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const limit = 50;
  const offset = (page - 1) * limit;

  let query = supabase
    .from('users')
    .select(
      'id, prenom, nom, email, role, actif, organisation_id, organisations(raison_sociale, type), derniere_connexion, created_at',
      { count: 'exact' },
    )
    .order('nom')
    .range(offset, offset + limit - 1);

  if (organisation_id) query = query.eq('organisation_id', organisation_id);
  if (role) query = query.eq('role', role);
  if (actif !== null) query = query.eq('actif', actif === 'true');

  const { data, error, count } = await query;
  if (error) return serverError(error, 'admin.users.list');

  return NextResponse.json({
    data: data ?? [],
    total: count ?? 0,
    page,
    limit,
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  const { email, prenom, nom, role, organisation_id } = body as {
    email?: string;
    prenom?: string;
    nom?: string;
    role?: string;
    organisation_id?: string;
  };
  const mode = parseInvitationMode(body.mode);

  // `email`, `role`, `organisation_id` requis dans les deux modes. `prenom`/`nom` requis
  // seulement en `direct` (en `self_service` l'invité les saisira à l'acceptation).
  if (!email || !role || !organisation_id) {
    return NextResponse.json(
      { error: 'email, role, organisation_id sont obligatoires' },
      { status: 422 },
    );
  }
  if (mode === 'direct' && (!prenom || !nom)) {
    return NextResponse.json(
      { error: 'prenom et nom sont obligatoires (mode direct)' },
      { status: 422 },
    );
  }

  if (!ROLES_VALIDES.includes(role as (typeof ROLES_VALIDES)[number])) {
    return NextResponse.json({ error: 'role invalide' }, { status: 422 });
  }

  // Promotion admin_savr réservée à admin_savr
  if (role === 'admin_savr' && auth.ctx.role !== 'admin_savr') {
    return NextResponse.json(
      { error: 'Promotion admin_savr réservée à admin Savr' },
      { status: 403 },
    );
  }

  const supabase = createAdminSupabaseClient();

  // Mode self-service : l'utilisateur crée lui-même son compte (nom + mot de passe + CGU)
  // via le lien. Le rôle et l'organisation choisis par l'Admin sont posés en metadata
  // (serveur) et appliqués à l'acceptation.
  if (mode === 'self_service') {
    const { data: orgSs } = await supabase
      .from('organisations')
      .select('nom')
      .eq('id', organisation_id)
      .maybeSingle();
    const res = await sendSelfServiceInvitation(supabase, {
      email,
      organisationId: organisation_id,
      role,
      organisationNom: (orgSs as { nom?: string } | null)?.nom ?? '',
    });
    if (!res.ok) {
      return NextResponse.json({ error: res.error }, { status: 422 });
    }
    return NextResponse.json({ email, mode }, { status: 201 });
  }

  // Mot de passe temporaire — l'utilisateur sera invité à le changer via email
  const motDePasseTemporaire =
    Math.random().toString(36).slice(2, 10) + 'Savr1!';

  const { data: authData, error: authError } =
    await supabase.auth.admin.createUser({
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

  const { data: user, error: userError } = await supabase
    .from('users')
    .insert({
      id: userId,
      organisation_id,
      email,
      prenom,
      nom,
      role,
    })
    .select('id, email, prenom, nom, role')
    .single();

  if (userError) {
    // Rollback auth user (best-effort)
    await supabase.auth.admin.deleteUser(userId).catch(() => null);
    return writeError(userError, 'admin.users.create');
  }

  // Générer lien de réinitialisation de mot de passe et envoyer email bienvenue
  const { data: linkData } = await supabase.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: {
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/auth/new-password`,
    },
  });

  const resetUrl =
    linkData?.properties?.action_link ??
    `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/auth/login`;

  // Nom de l'organisation de rattachement (variable requise du template).
  const { data: org } = await supabase
    .from('organisations')
    .select('nom')
    .eq('id', organisation_id)
    .maybeSingle();

  // ONB-04 : le slug 'bienvenue_invitation' n'existait pas au seed → throw avalé,
  // aucun email envoyé. Slug réel = 'invitation_utilisateur' (variables requises
  // prenom + organisation_nom + lien_invitation, cf. seed bloc8 + call-sites
  // gestionnaire/traiteur).
  void sendEmail('invitation_utilisateur', email, {
    prenom: prenom ?? '',
    organisation_nom: (org as { nom?: string } | null)?.nom ?? '',
    lien_invitation: resetUrl,
  }).catch(() => null);

  return NextResponse.json(user, { status: 201 });
}
