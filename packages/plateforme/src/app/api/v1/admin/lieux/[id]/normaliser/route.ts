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

  const { data: lieu, error: fetchError } = await supabase
    .from('lieux')
    .select('id, actif, nom')
    .eq('id', id)
    .single();

  if (fetchError?.code === 'PGRST116' || !lieu) {
    return NextResponse.json({ error: 'Lieu introuvable' }, { status: 404 });
  }

  const { data, error } = await supabase
    .from('lieux')
    .update({ actif: true, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from('audit_log').insert({
    table_name: 'lieux',
    record_id: id,
    action: 'NORMALISE',
    user_id: auth.ctx.userId,
    new_values: { actif: true },
  });

  return NextResponse.json(data);
}
