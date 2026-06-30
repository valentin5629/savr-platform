// POST /api/auth/update-password — pose un nouveau mot de passe (étape « confirm »
// du reset par lien magique, OU changement de mot de passe d'un utilisateur connecté).
// A1 (backlog) : la politique de mot de passe (§09 l.84-85 : 10c + maj + chiffre +
// spécial) doit être vérifiée côté serveur AUSSI au reset, pas seulement au signup —
// le plancher GoTrue ne contrôle que la longueur. C'est le point d'enforcement serveur
// que la page de confirmation (UI) appelle après l'échange du token de récupération.

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { validatePasswordStrength } from '@/lib/password.js';

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  const { mot_de_passe } = body as { mot_de_passe?: string };
  if (!mot_de_passe) {
    return NextResponse.json({ error: 'Mot de passe requis' }, { status: 422 });
  }

  // Politique de mot de passe — même helper que le signup (A1 : signup + reset).
  const pwd = validatePasswordStrength(mot_de_passe);
  if (!pwd.ok) {
    return NextResponse.json({ error: pwd.error }, { status: 422 });
  }

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

  // Session de récupération (issue du lien magique) ou session normale d'un user
  // connecté : sans session valide, pas de changement de mot de passe possible.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: 'Session de récupération requise' },
      { status: 401 },
    );
  }

  const { error } = await supabase.auth.updateUser({ password: mot_de_passe });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 422 });
  }

  return NextResponse.json(
    { success: true },
    { status: 200, headers: response.headers },
  );
}
