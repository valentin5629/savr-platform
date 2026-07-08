import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth.js';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { serverError, withApiTrace } from '@/lib/api-helpers.js';

// GET /api/v1/admin/demandes-suppression?statut=en_attente
// File in-app des demandes de suppression RGPD à traiter sous 48h (§15 §3.3 l.101).
// Admin Savr uniquement. Embed du demandeur via la FK nommée (deux FK vers users).
async function getHandler(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;

  const supabase = createAdminSupabaseClient();
  const { searchParams } = new URL(req.url);
  const statut = searchParams.get('statut') ?? 'en_attente';

  const { data, error } = await supabase
    .from('demandes_suppression')
    .select(
      'id, user_id, statut, justification, demande_le, traitee_le, traitee_par, ' +
        'demandeur:users!demandes_suppression_user_id_fkey(email, prenom, nom, organisation_id)',
    )
    .eq('statut', statut)
    .order('demande_le', { ascending: true });

  if (error) return serverError(error, 'admin.demandes_suppression.list');
  return NextResponse.json({ data: data ?? [] });
}

export const GET = withApiTrace(getHandler);
