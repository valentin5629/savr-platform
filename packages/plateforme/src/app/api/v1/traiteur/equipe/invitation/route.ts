import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { sendEmail } from '@savr/shared/src/email/index.js';
import { requireUser, type ClientRole } from '@/lib/api-auth.js';

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
  };
  const email = (body.email ?? '').trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ error: 'Email requis' }, { status: 422 });
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

  // Le compte est créé en auto-service au clic sur le lien d'invitation
  // (rattachement automatique à l'organisation de l'invitant, rôle commercial).
  await sendEmail(
    'invitation_utilisateur',
    email,
    {
      prenom: body.prenom ?? '',
      organisation_nom: org?.nom ?? '',
    },
    { entityType: 'organisation', entityId: auth.ctx.organisationId },
  );

  return NextResponse.json(
    { data: { invitation: 'envoyee', email } },
    { status: 201 },
  );
}
