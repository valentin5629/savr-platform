// POST /api/v1/admin/collectes/[id]/documents/[type]/regenerate
// Régénère un PDF de la fiche collecte (§06.06 Bloc 3 « Documents » + actions
// l.283-284 : « Régénérer le rapport RSE / le bordereau ZD / l'attestation AG »).
// Ré-enqueue jobs_pdf (type_document + TEMPLATE_VERSIONS courant appliqué par le
// worker) + audit_log. Accès : admin_savr + ops_savr (requireStaff).
//
// [type] ∈ PDF_DOCUMENT_TYPES : bordereau-zd | rapport-recyclage-zd | attestation-don.

import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';
import { regenerateCollecteDocument } from '@/lib/pdf/regenerate.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; type: string }> },
): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const { id, type } = await params;
  const supabase = createAdminSupabaseClient();

  const result = await regenerateCollecteDocument(supabase, id, type, {
    userId: auth.ctx.userId,
    role: auth.ctx.role,
  });

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
