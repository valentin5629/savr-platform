import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { isDisposableEmail } from '@savr/shared/src/email-denylist.js';
import { requireStaff } from '@/lib/api-auth.js';
import { serverError, writeError } from '@/lib/api-helpers.js';

// Domaine simple : au moins un point, pas d'espace/@, lettres/chiffres/tirets
// (même forme que la route du manager traiteur).
const DOMAINE_RE =
  /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const { id } = await params;
  const supabase = createAdminSupabaseClient();

  const { data, error } = await supabase
    .from('organisations_domaines_email')
    .select('id, domaine, verifie_at, created_at')
    .eq('organisation_id', id)
    .order('domaine');

  if (error)
    return serverError(error, 'admin.organisations.domaines_email.list');

  return NextResponse.json({ data: data ?? [] });
}

// Ajout d'un domaine par l'équipe Savr (Val 2026-10-30) : le domaine est
// VÉRIFIÉ d'emblée. `verifie_at` décide du rattachement automatique des futurs
// inscrits (api/auth/signup) ; l'Admin vaut ici preuve de contrôle, à la
// différence du manager traiteur dont la revendication reste non vérifiée.
// Domaine public (gmail…) ou jetable : refusé, il rattacherait n'importe qui.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;
  const { id } = await params;

  let body: { domaine?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }

  const domaine = String(body.domaine ?? '')
    .trim()
    .toLowerCase()
    .replace(/^@/, '');
  if (!DOMAINE_RE.test(domaine))
    return NextResponse.json(
      { error: 'Domaine invalide (ex. monentreprise.fr)' },
      { status: 422 },
    );
  if (isDisposableEmail(domaine))
    return NextResponse.json(
      { error: 'Domaine d’adresses jetables : refusé.' },
      { status: 422 },
    );

  const supabase = createAdminSupabaseClient();

  const { data: publicRow, error: publicErr } = await supabase
    .from('domaines_email_publics')
    .select('domaine')
    .eq('domaine', domaine)
    .maybeSingle();
  if (publicErr)
    return serverError(publicErr, 'admin.organisations.domaines_email.public');
  if (publicRow)
    return NextResponse.json(
      {
        error:
          'Domaine public (messagerie grand public) : il ne peut pas rattacher une organisation.',
      },
      { status: 422 },
    );

  const { data, error } = await supabase
    .from('organisations_domaines_email')
    .insert({
      organisation_id: id,
      domaine,
      verifie_at: new Date().toISOString(),
    })
    .select('id, domaine, verifie_at, created_at')
    .maybeSingle();

  if (error) {
    if (error.code === '23505')
      return NextResponse.json(
        { error: 'Ce domaine est déjà rattaché à une organisation.' },
        { status: 409 },
      );
    if (error.code === '23503')
      return NextResponse.json(
        { error: 'Organisation non trouvée' },
        { status: 404 },
      );
    return writeError(error, 'admin.organisations.domaines_email.create');
  }

  await supabase.from('audit_log').insert({
    table_name: 'organisations_domaines_email',
    record_id: (data as { id: string }).id,
    action: 'INSERT',
    user_id: auth.ctx.userId,
    old_values: null,
    new_values: data,
  });

  return NextResponse.json({ data }, { status: 201 });
}
