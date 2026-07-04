// GET /api/v1/admin/attestations/:id/download
// Retourne une URL pré-signée R2 (15 min) pour une attestation de don AG.
// Contrôle applicatif embargo H+24 : refuse si now() < eligible_at.
// Accès : admin_savr + ops_savr (requireStaff).
//
// pdf_url stocke la clé R2 ("bucket/key") directement (posée par le worker PDF via
// linkFichierToEntity), comme rapports_rse — pas un fichier_id.

import { NextRequest, NextResponse } from 'next/server';

import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';

import { requireStaff } from '@/lib/api-auth.js';
import { getPresignedUrl } from '@/lib/pdf/r2-client.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const { id } = await params;
  const supabase = createAdminSupabaseClient();

  const { data: attestation, error } = await supabase
    .from('attestations_don')
    .select('id, statut, eligible_at, genere_at, pdf_url')
    .eq('id', id)
    .single();

  if (error || !attestation) {
    return NextResponse.json(
      { error: 'Attestation introuvable' },
      { status: 404 },
    );
  }

  // Embargo H+24 (§12) — jamais contournable, même pour un admin.
  const eligibleAt = attestation.eligible_at
    ? new Date(attestation.eligible_at as string)
    : null;
  if (eligibleAt && Date.now() < eligibleAt.getTime()) {
    return NextResponse.json(
      {
        error: 'Attestation sous embargo H+24',
        eligible_at: attestation.eligible_at,
      },
      { status: 425 },
    );
  }

  if (!attestation.genere_at) {
    return NextResponse.json(
      { error: 'PDF non encore généré' },
      { status: 202 },
    );
  }

  const storageKey = attestation.pdf_url as string | null;
  if (!storageKey) {
    return NextResponse.json({ error: 'Fichier PDF absent' }, { status: 404 });
  }

  const url = await getPresignedUrl(storageKey, 900);
  return NextResponse.json({ url, expires_in: 900 });
}
