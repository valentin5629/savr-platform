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

  // Générer un OTP magiclink via Supabase Auth Admin. On récupère le `hashed_token`
  // (pas l'action_link) : le lien pointe vers NOTRE route callback qui l'échange via
  // verifyOtp (même pattern que /api/auth/verify-email) → la session impersonée est
  // établie côté serveur, et le callback y pose `app_metadata.impersonator_id`.
  const { data: linkData, error: linkError } =
    await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: cible.email as string,
    });

  const tokenHash = linkData?.properties?.hashed_token;
  if (linkError || !tokenHash) {
    return NextResponse.json(
      { error: 'Erreur génération lien impersonation' },
      { status: 500 },
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
  const lienImpersonation =
    `${appUrl}/auth/impersonate-callback` +
    `?token_hash=${encodeURIComponent(tokenHash)}` +
    `&type=magiclink&impersonator=${encodeURIComponent(auth.ctx.userId)}`;

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
    lien_impersonation: lienImpersonation,
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
