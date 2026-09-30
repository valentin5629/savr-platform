// GET /api/v1/registre/options — lieux et traiteurs du registre du périmètre,
// options des filtres « Lieu » / « Traiteur » à choix multiple (§06.03).
// Mêmes garde et vue RLS-safe que la liste `GET /api/v1/registre`.

import { NextRequest, NextResponse } from 'next/server';

import { type SupabaseClient } from '@savr/shared/src/supabase-client.js';

import { createSupabaseServerClient } from '@/lib/api-auth.js';
import { requireRegistreUser } from '@/lib/registre/guard.js';
import { fetchRegistreOptions } from '@/lib/registre/registre.js';
import { serverError } from '@/lib/api-helpers.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireRegistreUser(req);
  if (auth.error) return auth.error;

  const supabase = createSupabaseServerClient() as unknown as SupabaseClient;
  try {
    return NextResponse.json(await fetchRegistreOptions(supabase));
  } catch (e) {
    return serverError(e, 'registre.options');
  }
}
