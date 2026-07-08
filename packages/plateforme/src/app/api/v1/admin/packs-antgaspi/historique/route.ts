import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';
import { serverError, withApiTrace } from '@/lib/api-helpers.js';

/**
 * GET /api/v1/admin/packs-antgaspi/historique?organisation_id=<id>
 *
 * Historique des actions manuelles sur les packs AG d'une organisation
 * (ajustement de crédits, annulation) depuis `audit_log`. §06.06 §8 :
 * « Toutes les actions sont tracées dans audit_log avec auteur, action,
 * valeurs avant/après, motif. » Le tableau « Historique des packs » montre
 * l'état courant ; cette route restitue le JOURNAL des ajustements.
 * Lecture staff (admin_savr + ops_savr).
 */
async function getHandler(req: NextRequest): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const { searchParams } = new URL(req.url);
  const organisation_id = searchParams.get('organisation_id');
  if (!organisation_id) {
    return NextResponse.json(
      { error: 'organisation_id est obligatoire' },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();

  // Les packs de l'organisation (audit_log.record_id = pack id, pas de FK).
  const { data: packs, error: packErr } = await supabase
    .from('packs_antgaspi')
    .select('id')
    .eq('organisation_id', organisation_id);
  if (packErr) return serverError(packErr, 'admin.packs.historique.packs');

  const packIds = (packs ?? []).map((p) => p.id as string);
  if (packIds.length === 0) return NextResponse.json({ data: [] });

  const { data, error } = await supabase
    .from('audit_log')
    .select(
      'id, action, old_values, new_values, motif, created_at, auteur:users!user_id(prenom, nom)',
    )
    .eq('table_name', 'packs_antgaspi')
    .in('record_id', packIds)
    .in('action', ['pack_ajuste_manuel', 'annulation_pack'])
    .order('created_at', { ascending: false });
  if (error) return serverError(error, 'admin.packs.historique.audit');

  return NextResponse.json({ data: data ?? [] });
}

export const GET = withApiTrace(getHandler);
