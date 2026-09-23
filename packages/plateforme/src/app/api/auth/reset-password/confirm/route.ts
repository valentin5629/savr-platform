// GET /api/auth/reset-password/confirm — cible du lien de l'email de
// réinitialisation (template `supabase/templates/recovery.html`, variable GoTrue
// `{{ .ConfirmationURL }}` → `/auth/v1/verify` → redirection ici).
//
// Pourquoi une route API et non directement la page : `@supabase/ssr` impose
// `flowType: 'pkce'` (createServerClient.js l.33), donc GoTrue redirige avec un
// `?code=` qu'il faut ÉCHANGER contre une session — et seule une route (ou un
// middleware) peut écrire les cookies de session, pas un composant serveur.
// Même schéma que `auth/verify-email`. La page `/reset-password/confirm` ne porte
// que le formulaire, une fois la session de récupération posée.
//
// ⚠ Limite inhérente au PKCE : le `code_verifier` est un cookie posé sur le
// navigateur qui a DEMANDÉ le lien. Ouvrir l'email dans un autre navigateur
// (webview d'une app mail sur iOS, par exemple) fait échouer l'échange. Ce cas
// n'est pas une impasse : on renvoie sur `/reset-password` avec un motif affiché
// et la possibilité de redemander un lien.
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const code = req.nextUrl.searchParams.get('code');

  // Lien tronqué / recopié à la main / déjà consommé par GoTrue.
  if (!code) {
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

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    // Lien expiré (1 h, `[auth.email].otp_expiry`), déjà utilisé, ou ouvert dans
    // un autre navigateur que celui de la demande (cf. limite PKCE ci-dessus).
    return NextResponse.redirect(
      new URL('/reset-password?error=lien_invalide', req.url),
    );
  }

  return response;
}
