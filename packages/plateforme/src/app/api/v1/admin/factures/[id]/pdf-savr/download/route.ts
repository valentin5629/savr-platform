// GET /api/v1/admin/factures/:id/pdf-savr/download
// Retourne une URL pré-signée R2 (15 min) pour la COPIE DE TRAVAIL PDF d'une facture
// (§06.08 §1 — pas la facture légale, celle-ci = pdf_url_pennylane / Factur-X).
// pdf_url_savr stocke la clé R2 ("bucket/key") posée par le worker PDF via
// linkFichierToEntity (entity_type='factures'), comme rapports_rse / attestations_don.
// Accès : admin_savr + ops_savr (requireStaff).

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

  const { data: facture, error } = await supabase
    .from('factures')
    .select('id, pdf_url_savr')
    .eq('id', id)
    .single();

  if (error || !facture) {
    return NextResponse.json({ error: 'Facture introuvable' }, { status: 404 });
  }

  const storageKey = facture.pdf_url_savr as string | null;
  if (!storageKey) {
    // Copie de travail pas encore générée (job PDF en attente / facture non émise).
    return NextResponse.json(
      { error: 'PDF de travail non encore généré' },
      { status: 202 },
    );
  }

  const url = await getPresignedUrl(storageKey, 900);
  return NextResponse.json({ url, expires_in: 900 });
}
