import { NextRequest, NextResponse } from 'next/server';
import { requireUser, type ClientRole } from '@/lib/api-auth.js';
import { writeError } from '@/lib/api-helpers.js';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';

// CDC §06.04 §6 (l.662) — suppression d'un domaine email autorisé par le MANAGER
// (own-org, RLS ode_manager_write). Hard-delete : la table n'est référencée par
// aucune FK entrante (simple référentiel d'onboarding).

const MANAGER_ROLE: ClientRole[] = ['traiteur_manager'];

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUser(req, MANAGER_ROLE);
  if (auth.error) return auth.error;
  const { id } = await params;

  // Écriture sous service_role (cf. 20260923180000 : `authenticated` n'a plus
  // DELETE sur cette table). La RLS `ode_manager_write` portait jusqu'ici le
  // filtre own-org ; en `service_role` elle est contournée, donc le périmètre
  // doit être écrit ICI, explicitement — sans le `.eq('organisation_id', …)`
  // ci-dessous, un manager supprimerait le domaine de n'importe quelle
  // organisation en devinant un id.
  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from('organisations_domaines_email')
    .delete()
    .eq('id', id)
    .eq('organisation_id', auth.ctx.organisationId)
    .select('id')
    .maybeSingle();

  if (error)
    return writeError(error, 'traiteur.mon_organisation.domaines_email.delete');
  if (!data)
    return NextResponse.json(
      { error: 'Domaine non trouvé ou hors de votre organisation' },
      { status: 404 },
    );

  return NextResponse.json({ data });
}
