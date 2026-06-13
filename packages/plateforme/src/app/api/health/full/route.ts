import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

const ALLOWED_ROLES = ['admin_savr', 'ops_savr'];

export async function GET(req: NextRequest): Promise<NextResponse> {
  // Auth via token interne (CI/monitoring) ou session utilisateur
  const internalToken = req.headers.get('x-internal-token');
  const expectedToken = process.env.HEALTH_INTERNAL_TOKEN;

  const isInternalAuth = expectedToken && internalToken === expectedToken;

  if (!isInternalAuth) {
    // Vérification session Supabase
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          },
        },
      },
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
    }

    const role = user.app_metadata?.role as string | undefined;
    if (!role || !ALLOWED_ROLES.includes(role)) {
      return NextResponse.json({ error: 'Rôle insuffisant' }, { status: 403 });
    }
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const checks: Record<string, 'ok' | 'ko'> = { db: 'ko', auth: 'ko' };

  // Check DB via REST (pas de dépendance @supabase/supabase-js dans ce package)
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/health_ping`, {
      method: 'POST',
      headers: {
        apikey: supabaseKey!,
        Authorization: `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
      signal: AbortSignal.timeout(200),
    });
    checks.db = res.ok ? 'ok' : 'ko';
  } catch {
    checks.db = 'ko';
  }

  // Check Auth (Supabase Auth joignable)
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/health`, {
      headers: { apikey: supabaseKey! },
      signal: AbortSignal.timeout(3000),
    });
    checks.auth = res.ok ? 'ok' : 'ko';
  } catch {
    checks.auth = 'ko';
  }

  const allOk = Object.values(checks).every((v) => v === 'ok');

  return NextResponse.json(
    { status: allOk ? 'ok' : 'ko', checks, ts: new Date().toISOString() },
    { status: allOk ? 200 : 503 },
  );
}
