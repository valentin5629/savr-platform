import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';

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
    return NextResponse.json({ error: error.message }, { status: 500 });
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

  const supabase = createSupabaseServerClient();
  // INSERT via RLS (ode_manager_write, own-org). La contrainte UNIQUE(domaine)
  // est GLOBALE : un domaine déjà rattaché (même à une autre org) → 409.
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
    return NextResponse.json({ error: error.message }, { status: 422 });
  }

  return NextResponse.json({ data }, { status: 201 });
}
