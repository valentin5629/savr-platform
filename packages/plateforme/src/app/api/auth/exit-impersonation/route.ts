// POST /api/auth/exit-impersonation — met fin à une session d'impersonation
// (bouton « Quitter l'impersonation » du bandeau, ou fin auto 1h — BL-P1-AUTH-01).
//
// Purge le flag `app_metadata.impersonator_id` / `impersonation_expires_at` sur
// l'utilisateur impersoné (sinon un futur login du user réel hériterait du claim),
// puis clôt la session impersonée (signOut). Le client redirige alors vers /login :
// l'admin se ré-authentifie sur son propre compte (retour à l'espace Admin).
// NB : le restauration transparente de la session admin dépend du déclencheur UI
// (BL-P1-BOA-09, hors périmètre R14) qui sauvegarderait le token admin au clic.

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';

export async function POST(_req: NextRequest): Promise<NextResponse> {
  const cookieStore = await cookies();
  const response = NextResponse.json({ success: true });

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

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Aucune session' }, { status: 401 });
  }

  // Purge le flag impersonation (null = clé retirée du prochain token).
  try {
    const admin = createAdminSupabaseClient();
    await admin.auth.admin.updateUserById(user.id, {
      app_metadata: { impersonator_id: null, impersonation_expires_at: null },
    });
  } catch {
    // Purge best-effort : la fenêtre 1h côté hook borne déjà le flag résiduel.
  }

  // Clôt la session impersonée (efface les cookies via setAll).
  await supabase.auth.signOut();

  return response;
}
