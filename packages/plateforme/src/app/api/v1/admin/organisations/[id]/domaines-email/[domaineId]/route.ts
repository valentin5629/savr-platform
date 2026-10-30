import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';
import { serverError, writeError } from '@/lib/api-helpers.js';

// CDC §06.06 « Fiche organisation » → Domaines email : « Marquer comme vérifié »
// (pose verifie_at = now()) et « Retirer la vérification », auditées. Retrait du
// domaine ajouté par l'Admin (Val 2026-10-30). Écriture sous service_role : le
// périmètre organisation est porté ICI par `.eq('organisation_id', id)`, sans
// lequel un id deviné toucherait le domaine d'une autre organisation.

type Ctx = { params: Promise<{ id: string; domaineId: string }> };

const COLS = 'id, domaine, verifie_at, created_at';

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;
  const { id, domaineId } = await params;

  let body: { verifie?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }
  if (typeof body.verifie !== 'boolean')
    return NextResponse.json(
      { error: 'Champ « verifie » (booléen) requis' },
      { status: 422 },
    );

  const supabase = createAdminSupabaseClient();
  const { data: avant, error: lectureErr } = await supabase
    .from('organisations_domaines_email')
    .select(COLS)
    .eq('id', domaineId)
    .eq('organisation_id', id)
    .maybeSingle();
  if (lectureErr)
    return serverError(lectureErr, 'admin.organisations.domaines_email.read');
  if (!avant)
    return NextResponse.json({ error: 'Domaine non trouvé' }, { status: 404 });

  // Vérifier = rattacher les futurs inscrits : jamais pour un client
  // organisateur (CLAUDE.md §4, cf. POST de la route parente).
  if (body.verifie) {
    const { data: org, error: orgErr } = await supabase
      .from('organisations')
      .select('type')
      .eq('id', id)
      .maybeSingle();
    if (orgErr)
      return serverError(orgErr, 'admin.organisations.domaines_email.org');
    if ((org as { type: string } | null)?.type === 'client_organisateur')
      return NextResponse.json(
        {
          error:
            'Un client organisateur ne rejoint jamais Savr en libre-service : ses comptes sont créés par l’équipe Savr. Aucun domaine ne peut le rattacher.',
        },
        { status: 422 },
      );
  }

  const { data, error } = await supabase
    .from('organisations_domaines_email')
    .update({ verifie_at: body.verifie ? new Date().toISOString() : null })
    .eq('id', domaineId)
    .eq('organisation_id', id)
    .select(COLS)
    .maybeSingle();
  if (error)
    return writeError(error, 'admin.organisations.domaines_email.update');
  if (!data)
    return NextResponse.json({ error: 'Domaine non trouvé' }, { status: 404 });

  await supabase.from('audit_log').insert({
    table_name: 'organisations_domaines_email',
    record_id: domaineId,
    action: 'UPDATE',
    user_id: auth.ctx.userId,
    old_values: avant,
    new_values: data,
  });

  return NextResponse.json({ data });
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;
  const { id, domaineId } = await params;

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from('organisations_domaines_email')
    .delete()
    .eq('id', domaineId)
    .eq('organisation_id', id)
    .select(COLS)
    .maybeSingle();
  if (error)
    return writeError(error, 'admin.organisations.domaines_email.delete');
  if (!data)
    return NextResponse.json({ error: 'Domaine non trouvé' }, { status: 404 });

  await supabase.from('audit_log').insert({
    table_name: 'organisations_domaines_email',
    record_id: domaineId,
    action: 'DELETE',
    user_id: auth.ctx.userId,
    old_values: data,
    new_values: null,
  });

  return NextResponse.json({ data });
}
