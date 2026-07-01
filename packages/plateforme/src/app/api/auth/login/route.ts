import { createHash } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { logger } from '@savr/shared/src/logger/index.js';

export const runtime = 'nodejs';

// §07/01 : jamais d'email en clair dans les logs → SHA-256 (email_hash).
function hashEmail(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

// IP client (X-Forwarded-For premier maillon), pour l'agrégation bruteforce §07/03.
function clientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

// Rôle métier depuis le claim `user_role` de l'access_token (posé par le hook
// JWT), sans requête DB. Payload obligatoire de `auth.login_success` (§07/01).
function roleFromToken(token: string | undefined): string | null {
  if (!token) return null;
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const claims = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    return (claims['user_role'] as string) ?? null;
  } catch {
    return null;
  }
}

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

  const ip = clientIp(req);
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: mot_de_passe,
  });

  if (error) {
    // §07/01 auth.login_failed (warn) — alimente l'alerte bruteforce §07/03
    // (> 5/5min même email_hash ou ip), agrégée côté plateforme (Supabase Logs).
    logger.warn('auth.login_failed', {
      email_hash: hashEmail(email),
      ip,
      reason: error.message,
    });
    return NextResponse.json({ error: error.message }, { status: 401 });
  }

  logger.info('auth.login_success', {
    user_id: data.user.id,
    ip,
    role: roleFromToken(data.session?.access_token),
  });

  return NextResponse.json(
    { user: { id: data.user.id, email: data.user.email } },
    {
      status: 200,
      headers: response.headers,
    },
  );
}
