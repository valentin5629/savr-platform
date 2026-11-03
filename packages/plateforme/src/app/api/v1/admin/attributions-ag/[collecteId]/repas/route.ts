import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';
import { serverError } from '@/lib/api-helpers.js';
import { logger } from '@savr/shared/src/logger/index.js';

// PATCH /api/v1/admin/attributions-ag/[collecteId]/repas
// Saisie ou correction directe du nombre de repas réalisés d'une collecte AG
// (§06.09 §5 « il peut la corriger manuellement avec motif obligatoire » ;
// scénario correction_volume_repas_realise_regenere_attestation).
// Sur changement de volume_repas_realise, trg_regenerer_attestation refait
// l'attestation émise (nouvelle version + CO₂ recalculé au facteur du moment).
//
// Ouverte une fois la collecte réalisée (realisee, cloturee) : avant, rien n'a
// été collecté ; « sans excédent » n'a pas de repas. Une correction d'une valeur
// déjà posée exige un motif (≥ 10 car.), comme la route /poids ; la 1re saisie non.
const STATUTS_OUVERTS = ['realisee', 'cloturee'];
const REPAS_MAX = 100_000;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ collecteId: string }> },
): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const { collecteId } = await params;

  let body: { volume_repas_realise?: unknown; motif?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  const repas = body.volume_repas_realise;
  if (
    typeof repas !== 'number' ||
    !Number.isInteger(repas) ||
    repas < 0 ||
    repas > REPAS_MAX
  ) {
    return NextResponse.json(
      {
        error: `Le nombre de repas doit être un entier entre 0 et ${REPAS_MAX.toLocaleString('fr-FR')}`,
      },
      { status: 422 },
    );
  }

  const supabase = createAdminSupabaseClient();

  const { data: collecte, error: collecteErr } = await supabase
    .from('collectes')
    .select('type, statut')
    .eq('id', collecteId)
    .single();
  if (collecteErr?.code === 'PGRST116' || !collecte) {
    return NextResponse.json(
      { error: 'Collecte introuvable' },
      { status: 404 },
    );
  }
  if (collecteErr) {
    return serverError(collecteErr, 'admin.attributions_ag.repas.collecte');
  }
  const c = collecte as { type: string; statut: string };
  if (c.type !== 'anti_gaspi' || !STATUTS_OUVERTS.includes(c.statut)) {
    return NextResponse.json(
      {
        error:
          'Le nombre de repas réalisés ne se saisit que sur une collecte Anti-Gaspi réalisée',
      },
      { status: 422 },
    );
  }

  const { data: avant, error: fetchErr } = await supabase
    .from('attributions_antgaspi')
    .select('id, volume_repas_realise')
    .eq('collecte_id', collecteId)
    .single();
  if (fetchErr?.code === 'PGRST116' || !avant) {
    return NextResponse.json(
      { error: 'Attribution introuvable' },
      { status: 404 },
    );
  }
  if (fetchErr) {
    return serverError(fetchErr, 'admin.attributions_ag.repas.lecture');
  }
  const ancien = (avant as { id: string; volume_repas_realise: number | null })
    .volume_repas_realise;

  if (ancien === repas) {
    return NextResponse.json({ data: avant });
  }

  const motif = typeof body.motif === 'string' ? body.motif.trim() : '';
  if (ancien != null && motif.length < 10) {
    return NextResponse.json(
      {
        error:
          'Un motif d’au moins 10 caractères est requis pour corriger le nombre de repas (§06.09)',
      },
      { status: 422 },
    );
  }

  const { data, error } = await supabase
    .from('attributions_antgaspi')
    .update({ volume_repas_realise: repas })
    .eq('collecte_id', collecteId)
    .select('id, volume_repas_realise')
    .single();
  if (error) {
    return serverError(error, 'admin.attributions_ag.repas.update');
  }

  const { error: auditErr } = await supabase.from('audit_log').insert({
    table_name: 'attributions_antgaspi',
    record_id: (avant as { id: string }).id,
    action: 'volume_repas_saisi_admin',
    user_id: auth.ctx.userId,
    role: auth.ctx.role,
    motif: motif || null,
    old_values: { volume_repas_realise: ancien },
    new_values: { volume_repas_realise: repas },
  });
  if (auditErr) {
    // La valeur est écrite : l'échec d'audit se signale sans annuler la saisie.
    logger.warn('admin.attributions_ag.repas.audit_failed', {
      collecte_id: collecteId,
      error: auditErr.message,
    });
  }

  return NextResponse.json({ data });
}
