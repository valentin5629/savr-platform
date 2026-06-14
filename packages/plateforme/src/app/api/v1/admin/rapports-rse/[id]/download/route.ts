// GET /api/v1/admin/rapports-rse/:id/download
// Retourne une URL pré-signée R2 (15 min) pour un rapport de recyclage ZD.
// Contrôle applicatif embargo H+24 : refuse si now() < disponible_a (R-PDF2).
// Accès : admin_savr + ops_savr.

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

  const { data: rapport, error } = await supabase
    .from('rapports_rse')
    .select('id, disponible_a, genere_at, pdf_url, fichiers:pdf_url(url)')
    .eq('id', id)
    .single();

  if (error || !rapport) {
    return NextResponse.json({ error: 'Rapport introuvable' }, { status: 404 });
  }

  // Contrôle embargo applicatif (R-PDF2) — jamais contournable même pour admin
  const disponibleA = new Date(rapport.disponible_a as string);
  if (Date.now() < disponibleA.getTime()) {
    return NextResponse.json(
      {
        error: 'Rapport sous embargo H+24',
        disponible_a: rapport.disponible_a,
      },
      { status: 425 },
    );
  }

  if (!rapport.genere_at) {
    return NextResponse.json(
      { error: 'PDF non encore généré' },
      { status: 202 },
    );
  }

  // pdf_url stocke la clé R2 directement (pas un fichier_id)
  const storageKey = rapport.pdf_url as string | null;
  if (!storageKey) {
    return NextResponse.json({ error: 'Fichier PDF absent' }, { status: 404 });
  }

  const url = await getPresignedUrl(storageKey, 900);
  return NextResponse.json({ url, expires_in: 900 });
}
