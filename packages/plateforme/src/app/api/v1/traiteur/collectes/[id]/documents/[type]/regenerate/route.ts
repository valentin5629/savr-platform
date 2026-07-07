// POST /api/v1/traiteur/collectes/[id]/documents/[type]/regenerate
// Régénération manuelle d'un rapport RSE par le traiteur_manager (§12 §1.2 l.92 —
// « disponible pour le traiteur_manager depuis l'espace client »). Décision Val
// 2026-07-07 (RPT-04) : §12 §1.2 prime sur §06.04 l.415 (« Régénérer = Admin Savr »),
// qui devient obsolète (cf. _Divergences RPT-04).
//
// Canal (§12 §1.2 l.92, F3 lot ⑫) : Next.js API Route SERVICE_ROLE (même mécanique que
// le batch J+1) qui vérifie APPLICATIVEMENT l'appartenance du demandeur à une
// organisation autorisée (RLS lecture de la collecte = mêmes 4 chemins que la policy
// A8 SELECT), puis régénère via le pipeline commun. Aucune écriture client directe :
// la policy rr_write_admin (§09 A8) reste inchangée. Cross-org → 403 (test P1 bloquant).
//
// [type] : SEUL 'rapport-recyclage-zd' est régénérable côté traiteur. Le bordereau ZD
// (§12 §1.1 l.37) et l'attestation de don AG (§12 §1.3 l.161) restent réservés à
// l'Admin Savr → tout autre type est rejeté en 403 avant tout effet de bord.

import { NextRequest, NextResponse } from 'next/server';

import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';

import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { regenerateCollecteDocument } from '@/lib/pdf/regenerate.js';
import type { BenchmarkFilters } from '@/lib/pdf/rapport-benchmark.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Régénération réservée au manager (§12 §1.2 l.92 : « traiteur_manager »).
const REGEN_ROLES: ClientRole[] = ['traiteur_manager'];

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; type: string }> },
): Promise<NextResponse> {
  const auth = await requireUser(req, REGEN_ROLES);
  if (auth.error) return auth.error;
  const { id, type } = await params;

  // Le traiteur ne peut régénérer QUE le rapport de recyclage ZD. Le bordereau ZD
  // (§12 §1.1 l.37) et l'attestation de don AG (§12 §1.3 l.161) restent réservés à
  // l'Admin Savr. Scénario P1 bloquant : regeneration_bordereau_et_attestation_interdites_traiteur.
  if (type !== 'rapport-recyclage-zd') {
    return NextResponse.json(
      {
        error:
          'Régénération réservée à l’Admin Savr pour ce type de document (bordereau / attestation).',
      },
      { status: 403 },
    );
  }

  // Cloisonnement applicatif : la collecte doit être VISIBLE (RLS) par le demandeur.
  const rls = createSupabaseServerClient();
  const { data: visible } = await rls
    .from('collectes')
    .select('id')
    .eq('id', id)
    .maybeSingle();

  const admin = createAdminSupabaseClient();

  if (!visible) {
    // Distinguer cross-org (existe mais hors périmètre → 403) d'un id inconnu (→ 404).
    const { data: exists } = await admin
      .from('collectes')
      .select('id')
      .eq('id', id)
      .maybeSingle();
    return exists
      ? NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
      : NextResponse.json({ error: 'Collecte introuvable' }, { status: 404 });
  }

  // Filtres benchmark optionnels choisis à la régénération (§12 §1.2).
  let benchmarkFilters: BenchmarkFilters | undefined;
  try {
    const body = (await req.json()) as {
      benchmark_filters?: BenchmarkFilters;
    } | null;
    benchmarkFilters = body?.benchmark_filters ?? undefined;
  } catch {
    /* corps vide → régénération sans surcharge de filtres */
  }

  const result = await regenerateCollecteDocument(
    admin,
    id,
    type,
    { userId: auth.ctx.userId, role: auth.ctx.role },
    benchmarkFilters,
  );

  if (!result.ok) {
    const status =
      result.code === 'UNKNOWN_TYPE'
        ? 422
        : result.code === 'NO_DOCUMENT' || result.code === 'NO_PRIOR_JOB'
          ? 409
          : 500;
    return NextResponse.json({ error: result.message }, { status });
  }

  // 202 Accepted : le rendu est asynchrone (worker PDF, cron 15 min).
  return NextResponse.json(
    { job_id: result.jobId, type: result.type },
    { status: 202 },
  );
}
