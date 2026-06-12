import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { sendEmail } from '@savr/shared/src/email/index.js';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = req.nextUrl;
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type');

  if (!tokenHash || type !== 'signup') {
    return NextResponse.redirect(
      new URL('/login?error=lien_invalide', req.url),
    );
  }

  const cookieStore = await cookies();
  const response = NextResponse.redirect(new URL('/', req.url));

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const { data, error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: 'signup',
  });

  if (error || !data.user) {
    return NextResponse.redirect(
      new URL('/login?error=verification_echouee', req.url),
    );
  }

  // Envoyer l'email de bienvenue post-vérification
  try {
    const adminClient = createAdminSupabaseClient();
    const { data: userProfile } = await adminClient
      .from('users')
      .select('prenom')
      .eq('id', data.user.id)
      .maybeSingle();

    if (userProfile?.prenom) {
      await sendEmail('bienvenue_organisation', data.user.email!, {
        prenom: userProfile.prenom as string,
        organisation_nom: '',
      });
    }
  } catch {
    // Bienvenue non bloquant — l'utilisateur est quand même redirigé
  }

  return response;
}
