// GET /auth/impersonate-callback — consomme le lien d'impersonation généré par
// POST /api/v1/admin/users/[id]/impersoner (BL-P1-AUTH-01).
//
// Établit la session de l'utilisateur impersoné (verifyOtp, même pattern que
// /api/auth/verify-email) PUIS pose `app_metadata.impersonator_id = admin.id` +
// `impersonation_expires_at = now + 1h` sur cet utilisateur, et rafraîchit le token
// pour que le hook `fn_custom_access_token` injecte le claim top-level
// `impersonator_id` (lu par le trigger d'audit → traçabilité §09 §7 + §15 §2.3).
//
// La fenêtre 1h est enforce côté hook (le claim n'est plus injecté passé l'heure) :
// « fin auto au bout d'1h » garantie même si l'admin ne clique pas « Quitter ».

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';

const IMPERSONATION_TTL_MS = 60 * 60 * 1000; // 1h (§09 §7)

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = req.nextUrl;
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type');
  const impersonatorId = searchParams.get('impersonator');

  if (!tokenHash || type !== 'magiclink' || !impersonatorId) {
    return NextResponse.redirect(
      new URL('/login?error=impersonation_lien_invalide', req.url),
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

  // 1. Établir la session impersonée.
  const { data, error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: 'magiclink',
  });

  if (error || !data.user) {
    return NextResponse.redirect(
      new URL('/login?error=impersonation_echouee', req.url),
    );
  }

  // 2. Poser le flag impersonation sur la session (app_metadata) + fenêtre 1h.
  const expiresAt = new Date(Date.now() + IMPERSONATION_TTL_MS).toISOString();
  const admin = createAdminSupabaseClient();
  const { error: metaError } = await admin.auth.admin.updateUserById(
    data.user.id,
    {
      app_metadata: {
        impersonator_id: impersonatorId,
        impersonation_expires_at: expiresAt,
      },
    },
  );

  if (metaError) {
    return NextResponse.redirect(
      new URL('/login?error=impersonation_echouee', req.url),
    );
  }

  // 3. Rafraîchir le token : le hook relit app_metadata → claim impersonator_id.
  const { error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError) {
    return NextResponse.redirect(
      new URL('/login?error=impersonation_echouee', req.url),
    );
  }

  return response;
}
