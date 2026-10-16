import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireAdmin } from '@/lib/api-auth.js';
import { serverError, businessError } from '@/lib/api-helpers.js';

// POST /api/v1/admin/collectes/:id/rattacher-pack
// Rattache après coup une collecte Anti-Gaspi programmée sans pack au pack actif
// de son organisation, pris plus tard (décision Val 2026-10-16) : un crédit est
// décompté, la ligne de la collecte quitte tout brouillon de facture unitaire
// sans numéro. Une facture numérotée (partie chez Pennylane, ou rejetée et
// revenue en brouillon avec son numéro) est laissée telle quelle : la réponse
// porte `facture_numerotee: true`, l'Admin émet l'avoir ou la corrige.
// Réservé à admin_savr : l'action retire une ligne de facture, ce que la matrice
// §09 refuse à ops_savr (« Éditer ligne / montant : Non »).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  const { id } = await params;

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase.rpc('rpc_rattacher_collecte_pack', {
    p_collecte_id: id,
    p_user_id: auth.ctx.userId,
    p_role: auth.ctx.role,
  });

  if (error) {
    const code = error.code ?? '';
    if (code === 'P0002')
      return NextResponse.json(
        { error: 'Collecte non trouvée' },
        { status: 404 },
      );
    // P0003 / P0006 = `RAISE EXCEPTION '<libellé métier>'` de la RPC, écrits pour
    // l'Admin (collecte non rattachable, aucun pack actif) → conservés.
    if (code === 'P0003' || code === 'P0006')
      return businessError(
        error,
        'admin.collectes.rattacher_pack.conflit',
        ['P0003', 'P0006'],
        409,
      );
    return serverError(error, 'admin.collectes.rattacher_pack.inattendu');
  }

  return NextResponse.json(data);
}
