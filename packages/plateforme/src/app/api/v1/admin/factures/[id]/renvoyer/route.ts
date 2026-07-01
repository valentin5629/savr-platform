// POST /api/v1/admin/factures/:id/renvoyer
// Renvoi manuel d'une facture en_attente_pennylane ou brouillon avec numéro déjà attribué.

import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';
import { renvoyerFacture } from '@/lib/facturation/validation-admin.js';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const { id } = await params;
  const supabase = createAdminSupabaseClient();

  const result = await renvoyerFacture(supabase, id, auth.ctx.userId);

  const status = result.ok ? 200 : result.statut === 'brouillon' ? 422 : 202;
  return NextResponse.json(result, { status });
}
