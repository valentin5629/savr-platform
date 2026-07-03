// GET /api/v1/admin/collectes/[id]/audit
// Alimente le Bloc 7 « Historique + Audit log » de la fiche collecte Admin
// (§06.06 l.268-270) : timeline des changements de statut + actions Admin/Ops.
// Accès : admin_savr + ops_savr (requireStaff).
//
// Filtre = audit_log des actions portées directement sur la collecte
// (table_name='collectes', record_id=collecteId). L'auteur est désigné par le rôle
// (audit_log.role : admin_savr | ops_savr — §06.06 l.271).

import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const { id } = await params;
  const supabase = createAdminSupabaseClient();

  const { data, error } = await supabase
    .from('audit_log')
    .select(
      'id, created_at, user_id, role, action, old_values, new_values, motif, impersonator_id',
    )
    .eq('table_name', 'collectes')
    .eq('record_id', id)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Date de recrédit auto (Bloc 4 — §06.06 l.247). Le trigger fn_trg_pack_recredit
  // détache le pack (pack_antgaspi_id := NULL) et audite sur table_name='packs_antgaspi'
  // avec old_values.collecte_id_annulee = cette collecte → lookup dédié.
  const { data: recredit } = await supabase
    .from('audit_log')
    .select('created_at')
    .eq('action', 'pack_recredite_annulation_collecte')
    .eq('old_values->>collecte_id_annulee', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({
    data: data ?? [],
    recredit_at:
      (recredit as { created_at: string } | null)?.created_at ?? null,
  });
}
