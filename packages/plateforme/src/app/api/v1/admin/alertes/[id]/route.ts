import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth.js';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import {
  readJsonBody,
  serverError,
  writeError,
  withApiTrace,
} from '@/lib/api-helpers.js';

// PATCH /api/v1/admin/alertes/[id]  body { action: 'resoudre' }
// Marque une alerte Admin in-app comme traitée (statut ouverte → resolue). Admin
// Savr uniquement. Certaines alertes se ré-arment d'elles-mêmes via trigger (ex.
// pack recrédité → f_rearm_alerte_pack) ; la résolution manuelle sert aux alertes
// traitées hors système (appel client, imputation manuelle, cf. §07/03 §3).
async function patchHandler(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireAdmin(req);
  if (auth.error) return auth.error;
  const { id } = await params;

  const parsed = await readJsonBody<{ action?: string }>(req);
  if ('error' in parsed) return parsed.error;
  if (parsed.data.action !== 'resoudre') {
    return NextResponse.json(
      { error: 'action invalide (resoudre)' },
      { status: 400 },
    );
  }

  const supabase = createAdminSupabaseClient();

  const { data: alerte, error: errLect } = await supabase
    .from('alertes_admin')
    .select('id, statut')
    .eq('id', id)
    .maybeSingle();
  if (errLect) return serverError(errLect, 'admin.alertes.read');
  if (!alerte) {
    return NextResponse.json({ error: 'Alerte introuvable' }, { status: 404 });
  }
  if (alerte.statut !== 'ouverte') {
    return NextResponse.json({ error: 'Alerte déjà résolue' }, { status: 409 });
  }

  const { error } = await supabase
    .from('alertes_admin')
    .update({
      statut: 'resolue',
      resolue_at: new Date().toISOString(),
      resolue_par_user_id: auth.ctx.userId,
    })
    .eq('id', id);
  if (error) return writeError(error, 'admin.alertes.resoudre');
  return NextResponse.json({ data: { id, statut: 'resolue' } });
}

export const PATCH = withApiTrace(patchHandler);
