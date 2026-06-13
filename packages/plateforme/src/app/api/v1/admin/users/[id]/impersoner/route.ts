import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireAdmin } from '@/lib/api-auth.js';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  const { id } = await params;
  const supabase = createAdminSupabaseClient();

  const { data: cible, error } = await supabase
    .from('users')
    .select('id, email, prenom, nom, role, organisation_id, actif')
    .eq('id', id)
    .single();

  if (error || !cible)
    return NextResponse.json(
      { error: 'Utilisateur non trouvé' },
      { status: 404 },
    );
  if (!cible.actif)
    return NextResponse.json(
      { error: "Impossible d'impersonner un compte suspendu" },
      { status: 422 },
    );

  // Générer un token de connexion temporaire via Supabase Auth Admin
  const { data: linkData, error: linkError } =
    await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: cible.email as string,
      options: {
        redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/auth/impersonate-callback?impersonator=${auth.ctx.userId}`,
      },
    });

  if (linkError || !linkData.properties?.action_link) {
    return NextResponse.json(
      { error: 'Erreur génération lien impersonation' },
      { status: 500 },
    );
  }

  // Tracer dans audit_log
  try {
    await supabase.from('audit_log').insert({
      table_name: 'users',
      record_id: id,
      action: 'impersonation',
      user_id: auth.ctx.userId,
      new_values: { impersonated_user_id: id, impersonated_email: cible.email },
    });
  } catch {
    /* audit failure non-bloquante */
  }

  return NextResponse.json({
    lien_impersonation: linkData.properties.action_link,
    cible: {
      id: cible.id,
      email: cible.email,
      prenom: cible.prenom,
      nom: cible.nom,
      role: cible.role,
    },
    expire_dans_secondes: 3600,
  });
}
