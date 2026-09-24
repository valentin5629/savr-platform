import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { writeError, serverError } from '@/lib/api-helpers.js';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';

// CDC §06.04 §6 (l.662) — Domaines email autorisés (onboarding auto des
// collaborateurs) : ajout/suppression par le MANAGER. Lecture own-org : manager
// + commercial (RLS ode_own_org_read). Écriture : manager only (ode_manager_write).

const READ_ROLES: ClientRole[] = ['traiteur_manager', 'traiteur_commercial'];
const MANAGER_ROLE: ClientRole[] = ['traiteur_manager'];

// Domaine simple : au moins un point, pas d'espace/@, lettres/chiffres/tirets.
const DOMAINE_RE =
  /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, READ_ROLES);
  if (auth.error) return auth.error;

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('organisations_domaines_email')
    .select('id, domaine, verifie_at, created_at')
    .eq('organisation_id', auth.ctx.organisationId)
    .order('domaine');

  if (error)
    return serverError(error, 'traiteur.mon_organisation.domaines_email.list');
  return NextResponse.json({ data: data ?? [] });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, MANAGER_ROLE);
  if (auth.error) return auth.error;

  let body: { domaine?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }

  const domaine = (body.domaine ?? '').trim().toLowerCase();
  if (!DOMAINE_RE.test(domaine))
    return NextResponse.json(
      { error: 'Domaine invalide (ex. monentreprise.fr)' },
      { status: 422 },
    );

  // Écriture sous service_role : depuis 20260923180000, `authenticated` n'a plus
  // INSERT/UPDATE/DELETE sur cette table. Le motif est que `verifie_at` y décide
  // du rattachement automatique des futurs inscrits — laisser le client écrire la
  // table, c'était le laisser se décerner lui-même la preuve de contrôle d'un
  // domaine qu'il ne possède pas.
  // Le périmètre reste porté par la route : rôle vérifié par `requireUser`
  // ci-dessus, et `organisation_id` pris du CONTEXTE, jamais du corps de requête.
  // `verifie_at` n'est délibérément PAS écrit ici : une revendication n'est pas
  // une preuve. Seul api/auth/verify-email la pose.
  const supabase = createAdminSupabaseClient();
  // La contrainte UNIQUE(domaine) est GLOBALE : un domaine déjà rattaché (même à
  // une autre org) → 409.
  const { data, error } = await supabase
    .from('organisations_domaines_email')
    .insert({ organisation_id: auth.ctx.organisationId, domaine })
    .select('id, domaine, verifie_at, created_at')
    .maybeSingle();

  if (error) {
    if (error.code === '23505')
      return NextResponse.json(
        { error: 'Ce domaine est déjà rattaché à une organisation.' },
        { status: 409 },
      );
    return writeError(error, 'traiteur.mon_organisation.domaines_email.create');
  }

  return NextResponse.json({ data }, { status: 201 });
}
