// GET /auth/impersonate-callback — consomme le lien d'impersonation généré par
// POST /api/v1/admin/users/[id]/impersoner (BL-P1-AUTH-01).
//
// Établit la session de l'utilisateur impersoné (verifyOtp, même pattern que
// /api/auth/verify-email) PUIS pose `app_metadata.impersonator_id = admin.id` +
// `impersonation_expires_at = now + 1h` sur cet utilisateur, et rafraîchit le token
// pour que le hook `fn_custom_access_token` injecte le claim top-level
// `impersonator_id` (lu par le trigger d'audit → traçabilité §09 §7 + §15 §2.3).
//
// ⚠ `impersonator` vient de l'URL : il n'est cru que s'il correspond à
// l'impersonation enregistrée côté serveur par la route `impersoner` (jeton +
// admin + cible, délai court, usage unique — src/lib/impersonation.ts). Sinon
// aucun app_metadata n'est écrit : un OTP magiclink obtenu pour son propre compte
// ne permet plus d'imputer ses écritures audit_log à un admin.
//
// La fenêtre 1h est enforce côté hook (le claim n'est plus injecté passé l'heure) :
// « fin auto au bout d'1h » garantie même si l'admin ne clique pas « Quitter ».

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import {
  CLE_IMPERSONATION_EN_ATTENTE,
  verifierImpersonation,
} from '@/lib/impersonation.js';

const IMPERSONATION_TTL_MS = 60 * 60 * 1000; // 1h (§09 §7)

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = req.nextUrl;
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type');
  const impersonatorId = searchParams.get('impersonator');
  const jeton = searchParams.get('jeton');

  if (!tokenHash || type !== 'magiclink' || !impersonatorId || !jeton) {
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

  // Tout échec après verifyOtp révoque la seule session qu'il vient d'ouvrir
  // (scope local : les autres sessions du user restent) ; ses cookies, posés sur
  // `response`, ne partent pas avec la redirection d'erreur.
  const refuser = async (): Promise<NextResponse> => {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
    return NextResponse.redirect(
      new URL('/login?error=impersonation_echouee', req.url),
    );
  };

  // 2. L'impersonation doit avoir été ouverte par CET admin pour CE user.
  const admin = createAdminSupabaseClient();
  const verdict = verifierImpersonation(
    data.user.app_metadata,
    jeton,
    impersonatorId,
    data.user.id,
  );
  if (verdict !== 'ok') {
    if (verdict === 'expiree') {
      await admin.auth.admin
        .updateUserById(data.user.id, {
          app_metadata: { [CLE_IMPERSONATION_EN_ATTENTE]: null },
        })
        .catch(() => undefined);
    }
    return refuser();
  }

  // Poser le flag impersonation (fenêtre 1h) ET consommer l'entrée en attente
  // dans la même écriture : le lien ne sert qu'une fois.
  const expiresAt = new Date(Date.now() + IMPERSONATION_TTL_MS).toISOString();
  const { error: metaError } = await admin.auth.admin.updateUserById(
    data.user.id,
    {
      app_metadata: {
        impersonator_id: impersonatorId,
        impersonation_expires_at: expiresAt,
        [CLE_IMPERSONATION_EN_ATTENTE]: null,
      },
    },
  );
  if (metaError) return refuser();

  // 3. Rafraîchir le token : le hook relit app_metadata → claim impersonator_id.
  // Échec : retirer le flag, sinon le prochain refresh du user réel (dans l'heure)
  // hériterait du claim et ses écritures seraient imputées à l'admin.
  const { error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError) {
    await admin.auth.admin
      .updateUserById(data.user.id, {
        app_metadata: { impersonator_id: null, impersonation_expires_at: null },
      })
      .catch(() => undefined);
    return refuser();
  }

  return response;
}
