import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { requireUser } from '@/lib/api-auth.js';

const ALLOWED_ROLES = [
  'traiteur_manager',
  'traiteur_commercial',
  'agence',
] as const;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, [...ALLOWED_ROLES]);
  if (auth.error) return auth.error;

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

  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const type = searchParams.get('type');

  let query = supabase.from('v_kpi_traiteur').select('*');

  if (from) query = query.gte('mois', from);
  if (to) query = query.lte('mois', to);
  if (type === 'zero_dechet' || type === 'anti_gaspi') {
    query = query.eq('type_collecte', type);
  }

  query = query.order('mois', { ascending: false });

  const { data, error } = await query;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(
    { data },
    { headers: { 'Cache-Control': 'private, max-age=60' } },
  );
}
