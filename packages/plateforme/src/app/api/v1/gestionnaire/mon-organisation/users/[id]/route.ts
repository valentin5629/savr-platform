import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';

const ROLES: ClientRole[] = ['gestionnaire_lieux'];

// PATCH /api/v1/gestionnaire/mon-organisation/users/[id]
// Désactivation d'un membre de la propre organisation (F5 — UPDATE users WHERE organisation_id = self).
// Seul actif=false est autorisé (soft-delete, pas de suppression).
// Interdit de se désactiver soi-même.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;

  const { id } = await params;
  const supabase = createSupabaseServerClient();

  // Empêcher l'auto-désactivation
  const { data: me } = await supabase.auth.getUser();
  if (me?.user?.id === id)
    return NextResponse.json(
      { error: 'Impossible de se désactiver soi-même' },
      { status: 403 },
    );

  let body: { actif?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }

  if (body.actif !== false)
    return NextResponse.json(
      { error: 'Seule la désactivation (actif: false) est autorisée' },
      { status: 400 },
    );

  const { data, error } = await supabase
    .from('users')
    .update({ actif: false })
    .eq('id', id)
    .select('id, email, prenom, nom, actif')
    .maybeSingle();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data)
    return NextResponse.json(
      { error: 'Utilisateur non trouvé ou non autorisé' },
      { status: 404 },
    );

  return NextResponse.json({ data });
}
