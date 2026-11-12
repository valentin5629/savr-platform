// GET /api/auth/reset-password/confirm — cible du lien de l'email de
// réinitialisation. Seule une route (pas un composant serveur) peut écrire les
// cookies de session ; la page `/reset-password/confirm` ne porte que le
// formulaire, une fois la session de récupération posée.
//
// Deux formes de lien :
//   - `?token_hash=…&type=recovery` : lien envoyé par Resend depuis le
//     2026-11-06 (`api/auth/reset-password/route.ts`), échangé par `verifyOtp`
//     comme `auth/verify-email`. Il marche dans n'importe quel navigateur.
//   - `?code=…` : lien de l'ancien envoi par Supabase Auth (flux PKCE). Gardé une
//     release pour les liens déjà partis (valables 1 h). Le `code_verifier` est un
//     cookie du navigateur qui a demandé le lien : ouvert ailleurs, l'échange
//     échoue et l'on renvoie sur `/reset-password` avec un motif.
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { claimsJeton } from '@/lib/claims-jeton';
import {
  codeVerificationManquant,
  facteursTotp,
} from '@/lib/code-verification';
import { ROUTES } from '@/lib/routes';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const code = req.nextUrl.searchParams.get('code');
  const tokenHash = req.nextUrl.searchParams.get('token_hash');
  const type = req.nextUrl.searchParams.get('type');
  const lienJeton = tokenHash !== null && type === 'recovery';

  // Lien tronqué / recopié à la main / déjà consommé.
  if (!lienJeton && !code) {
    return NextResponse.redirect(
      new URL('/reset-password?error=lien_invalide', req.url),
    );
  }

  const cookieStore = await cookies();
  const response = NextResponse.redirect(
    new URL('/reset-password/confirm', req.url),
  );

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

  const { data, error } = lienJeton
    ? await supabase.auth.verifyOtp({
        token_hash: tokenHash as string,
        type: 'recovery',
      })
    : await supabase.auth.exchangeCodeForSession(code!);
  if (error) {
    // Lien expiré (1 h), déjà utilisé, ou — ancien lien — ouvert dans un autre
    // navigateur que celui de la demande (cf. limite PKCE ci-dessus).
    return NextResponse.redirect(
      new URL('/reset-password?error=lien_invalide', req.url),
    );
  }

  // Compte soumis au code qui en a déjà un (équipe Savr, organisation qui
  // l'exige) : écran du code d'abord, puis retour au formulaire
  // (`api/auth/update-password` refuse sans lui). On ne change que la cible :
  // les cookies de session restent sur la réponse.
  const claims = claimsJeton(data?.session?.access_token);
  if (
    facteursTotp(data?.user?.factors).verifies.length > 0 &&
    codeVerificationManquant(claims)
  ) {
    const codeUrl = new URL(ROUTES.codeVerification, req.url);
    codeUrl.searchParams.set('next', '/reset-password/confirm');
    response.headers.set('Location', codeUrl.toString());
  }

  return response;
}
