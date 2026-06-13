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
      'id, prenom, nom, email, role, actif, telephone, organisation_id, organisations(raison_sociale, type), derniere_connexion_le, created_at',
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

  // Promotion admin_savr = admin-only
  if (body.role === 'admin_savr' && auth.ctx.role !== 'admin_savr') {
    return NextResponse.json(
      { error: 'Promotion admin_savr réservée à admin Savr' },
      { status: 403 },
    );
  }

  // Hard delete = admin-only (géré via fn_anonymize_user, pas de route PATCH)
  const allowedFields = [
    'prenom',
    'nom',
    'telephone',
    'role',
    'actif',
  ] as const;
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
