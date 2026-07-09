import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth.js';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { serverError, withApiTrace } from '@/lib/api-helpers.js';

// GET /api/v1/admin/alertes/count → { count } d'alertes ouvertes.
// Alimente la pastille de la nav Admin (visibilité : rendre le write-only lisible).
// Admin Savr uniquement. Count-only (head:true) : aucune ligne transférée.
async function getHandler(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const { count, error } = await supabase
    .from('alertes_admin')
    .select('id', { count: 'exact', head: true })
    .eq('statut', 'ouverte');
  if (error) return serverError(error, 'admin.alertes.count');
  return NextResponse.json({ count: count ?? 0 });
}

export const GET = withApiTrace(getHandler);
