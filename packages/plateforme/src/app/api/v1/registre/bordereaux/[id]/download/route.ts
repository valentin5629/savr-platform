// GET /api/v1/registre/bordereaux/:id/download — URL pré-signée R2 (15 min) du
// bordereau ZD, depuis le registre. Tous les rôles autorisés (sauf agence) ; la
// RLS bordereaux_savr est la frontière (un bordereau hors périmètre → 404).

import { NextRequest, NextResponse } from 'next/server';

import { createSupabaseServerClient } from '@/lib/api-auth.js';
import { getPresignedUrl } from '@/lib/pdf/r2-client.js';
import { requireRegistreUser } from '@/lib/registre/guard.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireRegistreUser(req);
  if (auth.error) return auth.error;

  const { id } = await params;
  const supabase = createSupabaseServerClient();

  const { data, error } = await supabase
    .from('bordereaux_savr')
    .select('id, statut, fichiers:pdf_fichier_id(url)')
    .eq('id', id)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json(
      { error: 'Bordereau introuvable' },
      { status: 404 },
    );
  }

  if (data.statut === 'brouillon') {
    return NextResponse.json(
      { error: 'PDF non encore généré (statut brouillon)' },
      { status: 202 },
    );
  }

  const fichier = data.fichiers as { url?: string } | { url?: string }[] | null;
  const storageKey = Array.isArray(fichier)
    ? (fichier[0]?.url ?? null)
    : (fichier?.url ?? null);
  if (!storageKey) {
    return NextResponse.json({ error: 'Fichier PDF absent' }, { status: 404 });
  }

  const url = await getPresignedUrl(storageKey, 900);
  return NextResponse.json({ url, expires_in: 900 });
}
