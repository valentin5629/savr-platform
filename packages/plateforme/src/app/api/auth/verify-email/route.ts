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
      .select('prenom, organisation_id')
      .eq('id', data.user.id)
      .maybeSingle();

    // Le clic sur ce lien PROUVE que l'utilisateur possède bien cette adresse.
    // C'est le seul moment du parcours où l'on apprend quelque chose de vrai sur
    // son domaine email : on marque donc ici `verifie_at` sur le rattachement de
    // CE domaine à SON organisation.
    //
    // Pourquoi cela compte : `organisations_domaines_email` décide à quelle
    // organisation les inscriptions suivantes sont rattachées, et n'importe quel
    // traiteur_manager peut y revendiquer un domaine quelconque sans la moindre
    // preuve (POST …/mon-organisation/domaines-email). Sans cette marque, une
    // revendication en l'air vaudrait autant qu'un domaine réellement contrôlé.
    // La marque est posée SEULEMENT si la ligne appartient déjà à l'organisation
    // de l'utilisateur : elle confirme un rattachement existant, elle n'en crée
    // aucun et n'en déplace aucun.
    const domaineUtilisateur = data.user.email?.split('@')[1]?.toLowerCase();
    if (userProfile?.organisation_id && domaineUtilisateur) {
      await adminClient
        .from('organisations_domaines_email')
        .update({ verifie_at: new Date().toISOString() })
        .eq('domaine', domaineUtilisateur)
        .eq('organisation_id', userProfile.organisation_id)
        .is('verifie_at', null);
    }

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
