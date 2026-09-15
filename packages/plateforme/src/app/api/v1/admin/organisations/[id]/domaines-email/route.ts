import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';
import { serverError } from '@/lib/api-helpers.js';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const { id } = await params;
  const supabase = createAdminSupabaseClient();

  const { data, error } = await supabase
    .from('organisations_domaines_email')
    .select('id, domaine, created_at')
    .eq('organisation_id', id)
    .order('domaine');

  if (error)
    return serverError(error, 'admin.organisations.domaines_email.list');

  return NextResponse.json({ data: data ?? [] });
}
