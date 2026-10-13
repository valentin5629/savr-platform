// POST /api/v1/admin/collectes/[id]/documents/[type]/regenerate
// Régénère un PDF de la fiche collecte (§06.06 Bloc 3 « Documents » + actions
// l.283-284 : « Régénérer le rapport RSE / le bordereau ZD / l'attestation AG »).
// Ré-enqueue jobs_pdf (type_document + TEMPLATE_VERSIONS courant appliqué par le
// worker) + audit_log. Accès : admin_savr + ops_savr (requireStaff).
//
// [type] ∈ PDF_DOCUMENT_TYPES : bordereau-zd | rapport-recyclage-zd | attestation-don |
// rapport-evenement-sans-excedent (§12 §1.3-bis l.198 : régénération Admin uniquement,
// correction motif chauffeur / plaque post-saisie).
//
// Rapport de recyclage ZD : le corps `{ options: { benchmark } }` choisit la
// version, avec ou sans le radar de comparaison (décision Val 2026-10-13). Sans
// corps, le dernier rendu est reproduit. L'Admin n'a pas de barre de filtres :
// le radar reprend les filtres figés du rapport en vigueur, sinon le segment de
// la collecte (filtresRadarParDefaut). Le radar est calculé par la fonction de
// l'écran, SOUS L'IDENTITÉ de l'appelant : le k-anonymat s'applique à l'Admin
// comme aux clients — ce PDF est celui que le client télécharge.

import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { createSupabaseServerClient, requireStaff } from '@/lib/api-auth.js';
import { lireVersionDemandee } from '@/lib/collectes/rapport-regeneration.js';
import { filtresRadarParDefaut } from '@/lib/pdf/rapport-radar.js';
import {
  regenerateCollecteDocument,
  type VersionRapportRecyclage,
} from '@/lib/pdf/regenerate.js';

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

  // Seul le rapport de recyclage a deux versions ; les autres documents ignorent
  // le corps de la requête.
  let version: VersionRapportRecyclage | undefined;
  if (type === 'rapport-recyclage-zd') {
    const lu = await lireVersionDemandee(
      req,
      createSupabaseServerClient(),
      {
        userId: auth.ctx.userId,
        role: auth.ctx.role,
        // Sans objet pour un rôle staff : la fonction du parc ne lit que le rôle.
        organisationId: auth.ctx.organisationId ?? '',
      },
      id,
      'admin.collectes.rapport.regeneration',
      () => filtresRadarParDefaut(supabase, id),
    );
    if ('refus' in lu) return lu.refus;
    version = lu.version;
  }

  const result = await regenerateCollecteDocument(
    supabase,
    id,
    type,
    { userId: auth.ctx.userId, role: auth.ctx.role },
    version,
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
