import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireAdmin } from '@/lib/api-auth.js';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  const { id } = await params;
  const { coefficient_kg_couvert, source_commentaire } = body as {
    coefficient_kg_couvert?: number;
    source_commentaire?: string;
  };

  if (coefficient_kg_couvert === undefined) {
    return NextResponse.json(
      { error: 'coefficient_kg_couvert est obligatoire' },
      { status: 422 },
    );
  }
  if (coefficient_kg_couvert < 0) {
    return NextResponse.json(
      { error: 'coefficient_kg_couvert doit être >= 0' },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();

  const { data: ancien } = await supabase
    .from('coefficients_perte_labo')
    .select('coefficient_kg_couvert')
    .eq('id', id)
    .single();

  const { data, error } = await supabase
    .from('coefficients_perte_labo')
    .update({ coefficient_kg_couvert, source_commentaire })
    .eq('id', id)
    .select('*')
    .single();

  if (error || !data)
    return NextResponse.json(
      { error: 'Coefficient non trouvé' },
      { status: 404 },
    );

  try {
    await supabase.from('audit_log').insert({
      table_name: 'coefficients_perte_labo',
      record_id: id,
      action: 'modification_coefficient',
      user_id: auth.ctx.userId,
      old_values: { coefficient_kg_couvert: ancien?.coefficient_kg_couvert },
      new_values: { coefficient_kg_couvert },
    });
  } catch {
    /* audit failure non-bloquante */
  }

  return NextResponse.json(data);
}
