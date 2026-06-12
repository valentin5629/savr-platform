import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  const { email, mot_de_passe } = body as {
    email?: string;
    mot_de_passe?: string;
  };

  if (!email || !mot_de_passe) {
    return NextResponse.json(
      { error: 'Email et mot de passe requis' },
      { status: 422 },
    );
  }

  const cookieStore = await cookies();
  const response = NextResponse.json({});

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

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: mot_de_passe,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }

  return NextResponse.json(
    { user: { id: data.user.id, email: data.user.email } },
    {
      status: 200,
      headers: response.headers,
    },
  );
}
