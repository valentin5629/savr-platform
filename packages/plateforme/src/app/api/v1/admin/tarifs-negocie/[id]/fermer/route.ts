import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireAdmin } from '@/lib/api-auth.js';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  const { id } = await params;
  const today = new Date().toISOString().slice(0, 10);
  const supabase = createAdminSupabaseClient();

  const { data, error } = await supabase
    .from('tarifs_negocie')
    .update({ valide_jusqu_au: today })
    .eq('id', id)
    .is('valide_jusqu_au', null)
    .select('id, valide_jusqu_au')
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: 'Remise non trouvée ou déjà fermée' },
      { status: 404 },
    );
  }

  return NextResponse.json(data);
}
