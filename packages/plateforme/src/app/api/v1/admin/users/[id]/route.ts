import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const { id } = await params;
  const supabase = createAdminSupabaseClient();

  const { data: user, error } = await supabase
    .from('users')
    .select(
      'id, prenom, nom, email, role, actif, organisation_id, organisations(raison_sociale, type), derniere_connexion, created_at',
    )
    .eq('id', id)
    .single();

  if (error || !user)
    return NextResponse.json(
      { error: 'Utilisateur non trouvé' },
      { status: 404 },
    );

  return NextResponse.json(user);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  const { id } = await params;
  const isAdmin = auth.ctx.role === 'admin_savr';

  const VALID_ROLES = [
    'admin_savr',
    'ops_savr',
    'traiteur_manager',
    'traiteur_commercial',
    'agence',
    'gestionnaire_lieux',
    'client_organisateur',
  ];

  // Validation de la valeur de rôle
  if ('role' in body && !VALID_ROLES.includes(body.role as string)) {
    return NextResponse.json(
      { error: 'Valeur de rôle invalide' },
      { status: 422 },
    );
  }

  // §09 (matrice étendue ops_savr) : ops PEUT suspendre (`actif`) et réassigner un
  // rôle NON-admin. SEULE la promotion vers `admin_savr` est réservée à admin_savr
  // (BL-P1-AUTH-03 : l'ancien blocage global sur `role`/`actif` divergeait de §09).
  // La rétrogradation / modification d'un compte admin_savr existant est couverte
  // plus bas (garde `targetUser.role === 'admin_savr'`). Défense en profondeur DB :
  // `fn_users_block_role_escalation` (R10b), mais cette route passe par le
  // service_role qui la bypasse → la garde applicative est ici la seule protection.
  if (!isAdmin && (body.role as string) === 'admin_savr') {
    return NextResponse.json(
      { error: 'Promotion en admin Savr réservée à admin Savr' },
      { status: 403 },
    );
  }

  // Staff (admin + ops) : mêmes champs éditables ; ops est borné par les deux
  // gardes admin_savr ci-dessus/ci-dessous.
  const allowedFields = ['prenom', 'nom', 'role', 'actif'];

  const updatePayload: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (field in body) updatePayload[field] = body[field];
  }

  if (Object.keys(updatePayload).length === 0) {
    return NextResponse.json(
      { error: 'Aucun champ à mettre à jour' },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();

  // Fetch target user — seul admin_savr peut modifier un compte admin_savr
  const { data: targetUser, error: fetchErr } = await supabase
    .from('users')
    .select('id, role')
    .eq('id', id)
    .single();

  if (fetchErr?.code === 'PGRST116' || !targetUser) {
    return NextResponse.json(
      { error: 'Utilisateur non trouvé' },
      { status: 404 },
    );
  }

  if ((targetUser as { role: string }).role === 'admin_savr' && !isAdmin) {
    return NextResponse.json(
      { error: "Modification d'un admin Savr réservée à admin Savr" },
      { status: 403 },
    );
  }

  const { data: user, error } = await supabase
    .from('users')
    .update(updatePayload)
    .eq('id', id)
    .select('id, prenom, nom, email, role, actif')
    .single();

  if (error || !user)
    return NextResponse.json(
      { error: 'Utilisateur non trouvé' },
      { status: 404 },
    );

  return NextResponse.json(user);
}
