import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { validatePasswordStrength } from '@/lib/password.js';
import { CGU_VERSION_COURANTE } from '@/lib/cgu.js';
import {
  checkSignupRateLimit,
  extractClientIp,
} from '@/lib/signup-rate-limit.js';

// POST /api/auth/accept-invitation — l'invité finalise son compte en self-service.
// L'`organisation_id` et le `role` viennent des metadata du compte « invited » (posées
// par l'invitant côté serveur au moment de l'invitation), JAMAIS du body → rattachement
// à l'org de l'invitant garanti, pas d'escalade de privilège possible par l'invité.
// Reprend la politique du signup : rate-limit, mot de passe fort, CGU obligatoires.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const rl = checkSignupRateLimit(extractClientIp(req));
  if (rl.limited) {
    return NextResponse.json(
      { error: 'Trop de tentatives. Réessayez plus tard.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }

  let body: {
    token_hash?: string;
    prenom?: string;
    nom?: string;
    mot_de_passe?: string;
    acceptation_cgu?: boolean;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  const tokenHash = (body.token_hash ?? '').trim();
  const prenom = (body.prenom ?? '').trim();
  const nom = (body.nom ?? '').trim();
  const motDePasse = body.mot_de_passe ?? '';

  if (!tokenHash || !prenom || !nom || !motDePasse) {
    return NextResponse.json(
      { error: 'token_hash, prenom, nom et mot_de_passe sont requis' },
      { status: 422 },
    );
  }
  if (!body.acceptation_cgu) {
    return NextResponse.json(
      { error: 'Acceptation CGU obligatoire' },
      { status: 422 },
    );
  }
  const pwd = validatePasswordStrength(motDePasse);
  if (!pwd.ok) {
    return NextResponse.json({ error: pwd.error }, { status: 422 });
  }

  // Vérifier le token d'invitation (Supabase OTP type 'invite') → identifie le compte
  // « invited » et consomme le token (à usage unique).
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {},
      },
    },
  );

  const { data: otp, error: otpErr } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: 'invite',
  });

  if (otpErr || !otp.user) {
    return NextResponse.json(
      { error: "Lien d'invitation invalide ou expiré" },
      { status: 422 },
    );
  }

  const meta = (otp.user.user_metadata ?? {}) as {
    organisation_id?: string;
    role?: string;
  };
  if (!meta.organisation_id || !meta.role) {
    return NextResponse.json(
      { error: 'Invitation incomplète (organisation ou rôle manquant)' },
      { status: 422 },
    );
  }

  const admin = createAdminSupabaseClient();

  // Idempotence : si le profil existe déjà, l'invitation a déjà été acceptée.
  const { data: existing } = await admin
    .from('users')
    .select('id')
    .eq('id', otp.user.id)
    .maybeSingle();
  if (existing) {
    return NextResponse.json(
      { error: 'Invitation déjà acceptée' },
      { status: 409 },
    );
  }

  // Définir le mot de passe choisi par l'invité sur le compte « invited ».
  const { error: pwErr } = await admin.auth.admin.updateUserById(otp.user.id, {
    password: motDePasse,
  });
  if (pwErr) {
    return NextResponse.json({ error: pwErr.message }, { status: 422 });
  }

  // Créer le profil : `organisation_id` + `role` viennent des metadata (serveur), CGU
  // persistées comme preuve opposable (horodatage + version, cf. R6 / signup).
  const { error: insErr } = await admin.from('users').insert({
    id: otp.user.id,
    organisation_id: meta.organisation_id,
    email: otp.user.email ?? '',
    prenom,
    nom,
    role: meta.role,
    cgu_accepte_le: new Date().toISOString(),
    cgu_version: CGU_VERSION_COURANTE,
  });
  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 422 });
  }

  return NextResponse.json(
    { data: { id: otp.user.id, organisation_id: meta.organisation_id } },
    { status: 201 },
  );
}
