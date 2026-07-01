import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';
import { readJsonBody, serverError } from '@/lib/api-helpers.js';

// Saisie / édition manuelle des pesées ZD par flux (§06.06 fiche collecte Bloc 2/3 :
// « Modifier les pesées par flux manuellement (ZD) », admin_savr + ops_savr, motif
// obligatoire + audit_log — RLS cf_update_staff). Comble le cas R9 (pesées MTS-1
// manquantes → escalade saisie manuelle Admin) et corrige toute pesée terrain.
//
// UPSERT par (collecte_id, flux_id) — cohérent avec la dérivation
// fn_agreger_terminal_collecte (§04 « collecte_flux dérivée »). Écrasement interdit
// après clôture (§04 + §08 3bis.7) → 409 (la correction post-clôture passe par le
// flux avoir, hors de cet endpoint).

const ZD_FLUX_CODES = [
  'biodechet',
  'emballage',
  'carton',
  'verre',
  'dechet_residuel',
] as const;

interface PeseeInput {
  flux_code: string;
  poids_reel_kg: number;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const { id } = await params;
  const parsed = await readJsonBody(req);
  if ('error' in parsed) return parsed.error;
  const body = parsed.data as { pesees?: unknown; motif?: unknown };

  // ── Validation ──────────────────────────────────────────────────────────────
  // §07/06 pt2 : correction de pesée = motif obligatoire ≥ 10 caractères.
  const motif = typeof body.motif === 'string' ? body.motif.trim() : '';
  if (motif.length < 10) {
    return NextResponse.json(
      { error: 'Motif obligatoire (≥ 10 caractères)' },
      { status: 422 },
    );
  }

  if (!Array.isArray(body.pesees) || body.pesees.length === 0) {
    return NextResponse.json(
      {
        error:
          'Au moins une pesée requise (pesees: [{ flux_code, poids_reel_kg }])',
      },
      { status: 422 },
    );
  }

  const pesees: PeseeInput[] = [];
  for (const p of body.pesees as unknown[]) {
    const row = p as { flux_code?: unknown; poids_reel_kg?: unknown };
    if (
      typeof row.flux_code !== 'string' ||
      !ZD_FLUX_CODES.includes(row.flux_code as (typeof ZD_FLUX_CODES)[number])
    ) {
      return NextResponse.json(
        { error: `flux_code invalide : ${String(row.flux_code)}` },
        { status: 422 },
      );
    }
    if (
      typeof row.poids_reel_kg !== 'number' ||
      !Number.isFinite(row.poids_reel_kg) ||
      row.poids_reel_kg < 0
    ) {
      return NextResponse.json(
        { error: `Poids invalide pour ${row.flux_code} (≥ 0 attendu)` },
        { status: 422 },
      );
    }
    pesees.push({ flux_code: row.flux_code, poids_reel_kg: row.poids_reel_kg });
  }

  const supabase = createAdminSupabaseClient();

  // ── Collecte : existence, type ZD, non clôturée ──────────────────────────────
  const { data: collecte, error: cErr } = await supabase
    .from('collectes')
    .select('id, type, statut')
    .eq('id', id)
    .single();

  if (cErr?.code === 'PGRST116' || !collecte) {
    return NextResponse.json(
      { error: 'Collecte introuvable' },
      { status: 404 },
    );
  }
  if (cErr) return serverError(cErr, 'admin.collectes.flux.get');

  if (collecte.type !== 'zero_dechet') {
    return NextResponse.json(
      { error: 'Pesées par flux réservées aux collectes ZD' },
      { status: 422 },
    );
  }
  if (collecte.statut === 'cloturee') {
    return NextResponse.json(
      {
        error:
          'Collecte clôturée : la correction des pesées passe par un avoir (édition Admin + recalcul), pas par cet endpoint',
      },
      { status: 409 },
    );
  }

  // ── Résolution flux_code → flux_id ───────────────────────────────────────────
  const codes = pesees.map((p) => p.flux_code);
  const { data: fluxRows, error: fErr } = await supabase
    .from('flux_dechets')
    .select('id, code')
    .in('code', codes);

  if (fErr) return serverError(fErr, 'admin.collectes.flux.flux_dechets');

  const idByCode = new Map(
    (fluxRows ?? []).map((f) => [f.code as string, f.id as string]),
  );
  for (const code of codes) {
    if (!idByCode.has(code)) {
      return NextResponse.json(
        { error: `Flux inconnu en base : ${code}` },
        { status: 422 },
      );
    }
  }

  // ── Snapshot avant (audit) ───────────────────────────────────────────────────
  const { data: before } = await supabase
    .from('collecte_flux')
    .select('flux_id, poids_reel_kg')
    .eq('collecte_id', id);

  // ── UPSERT par (collecte_id, flux_id) ────────────────────────────────────────
  const nowIso = new Date().toISOString();
  const upsertRows = pesees.map((p) => ({
    collecte_id: id,
    flux_id: idByCode.get(p.flux_code)!,
    poids_reel_kg: p.poids_reel_kg,
    updated_at: nowIso,
  }));

  const { data: after, error: upErr } = await supabase
    .from('collecte_flux')
    .upsert(upsertRows, { onConflict: 'collecte_id,flux_id' })
    .select('flux_id, poids_reel_kg');

  if (upErr) return serverError(upErr, 'admin.collectes.flux.upsert');

  // ── Audit §07/06 pesee_corrigee (motif obligatoire) ──────────────────────────
  await supabase.from('audit_log').insert({
    table_name: 'collecte_flux',
    record_id: id,
    action: 'pesee_corrigee',
    user_id: auth.ctx.userId,
    motif,
    old_values: { pesees: before ?? [] },
    new_values: { pesees: after ?? [] },
  });

  return NextResponse.json({ collecte_id: id, pesees: after ?? [] });
}
