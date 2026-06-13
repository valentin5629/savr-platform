import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const { id } = await params;
  const supabase = createAdminSupabaseClient();

  const { data, error } = await supabase
    .from('organisations')
    .update({ actif: false })
    .eq('id', id)
    .select('id, actif')
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: 'Organisation non trouvée' },
      { status: 404 },
    );
  }

  return NextResponse.json(data);
}
