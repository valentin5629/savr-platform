import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';

// CDC §06.04 §6 « Équipe » (l.669-670) — MANAGER only :
//   - Modifier le rôle d'un collaborateur (traiteur_commercial ↔ traiteur_manager) ;
//   - Suspendre un compte (soft-delete `actif=false`).
// RLS usr_manager_update (own-org). Le trigger anti-escalade R10b interdit toute
// promotion vers admin_savr ; l'allowlist ci-dessous restreint en plus aux deux
// rôles traiteur (jamais gestionnaire/agence/organisateur).

const MANAGER_ROLE: ClientRole[] = ['traiteur_manager'];
const ROLES_ASSIGNABLES = new Set(['traiteur_commercial', 'traiteur_manager']);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUser(req, MANAGER_ROLE);
  if (auth.error) return auth.error;
  const { id } = await params;

  let body: { role?: string; actif?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};

  if (body.role !== undefined) {
    if (!ROLES_ASSIGNABLES.has(body.role))
      return NextResponse.json(
        {
          error:
            'Rôle invalide (seuls traiteur_commercial et traiteur_manager sont assignables)',
        },
        { status: 422 },
      );
    patch.role = body.role;
  }

  if (body.actif !== undefined) {
    if (typeof body.actif !== 'boolean')
      return NextResponse.json(
        { error: 'actif doit être un booléen' },
        { status: 422 },
      );
    // Anti-auto-suspension : un manager ne peut pas se désactiver lui-même.
    if (body.actif === false && id === auth.ctx.userId)
      return NextResponse.json(
        { error: 'Impossible de suspendre votre propre compte' },
        { status: 403 },
      );
    patch.actif = body.actif;
  }

  if (Object.keys(patch).length === 0)
    return NextResponse.json(
      { error: 'Aucun champ modifiable fourni (role, actif)' },
      { status: 400 },
    );

  const supabase = createSupabaseServerClient();
  // UPDATE via RLS (usr_manager_update, own-org). Le trigger anti-escalade
  // backstoppe toute tentative de promotion admin_savr.
  const { data, error } = await supabase
    .from('users')
    .update(patch)
    .eq('id', id)
    .select('id, prenom, nom, email, role, actif')
    .maybeSingle();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 422 });
  if (!data)
    return NextResponse.json(
      { error: 'Utilisateur non trouvé ou hors de votre organisation' },
      { status: 404 },
    );

  return NextResponse.json({ data });
}
