// GET /api/v1/admin/bordereaux/:id/download
// Retourne une URL pré-signée R2 (15 min) pour un bordereau de pesée ZD.
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

  const { data: bordereau, error } = await supabase
    .from('bordereaux_savr')
    .select('id, statut, pdf_fichier_id, fichiers:pdf_fichier_id(url)')
    .eq('id', id)
    .single();

  if (error || !bordereau) {
    return NextResponse.json(
      { error: 'Bordereau introuvable' },
      { status: 404 },
    );
  }

  if (bordereau.statut === 'brouillon') {
    return NextResponse.json(
      { error: 'PDF non encore généré (statut brouillon)' },
      { status: 202 },
    );
  }

  const fichier = bordereau.fichiers as unknown as { url: string } | null;
  if (!fichier?.url) {
    return NextResponse.json({ error: 'Fichier PDF absent' }, { status: 404 });
  }

  const url = await getPresignedUrl(fichier.url, 900);
  return NextResponse.json({ url, expires_in: 900 });
}
