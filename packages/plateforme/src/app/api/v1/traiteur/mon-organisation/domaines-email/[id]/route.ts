import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';

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

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('organisations_domaines_email')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 422 });
  if (!data)
    return NextResponse.json(
      { error: 'Domaine non trouvé ou hors de votre organisation' },
      { status: 404 },
    );

  return NextResponse.json({ data });
}
