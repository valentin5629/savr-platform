// GET /api/v1/organisateur/documents/:type/:id/download
// Retourne une URL pré-signée R2 (15 min) pour un document du client organisateur.
// type ∈ rapport | bordereau | attestation.
// Sécurité : client user-scopé → la RLS (rr_select / bord_client_orga_select /
// att_client_orga_select) est la frontière ; une ligne d'un autre organisateur → 404.
// Embargo H+24 (R-PDF2) appliqué côté serveur sur les rapports RSE (disponible_a),
// jamais contournable.

import { NextRequest, NextResponse } from 'next/server';

import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { getPresignedUrl } from '@/lib/pdf/r2-client.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ORGANISATEUR_ROLES: ClientRole[] = ['client_organisateur'];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ type: string; id: string }> },
): Promise<NextResponse> {
  const auth = await requireUser(req, ORGANISATEUR_ROLES);
  if (auth.error) return auth.error;

  const { type, id } = await params;
  const supabase = createSupabaseServerClient();

  let storageKey: string | null = null;

  if (type === 'rapport') {
    const { data, error } = await supabase
      .from('rapports_rse')
      .select('id, disponible_a, genere_at, pdf_url')
      .eq('id', id)
      .maybeSingle();
    if (error || !data)
      return NextResponse.json(
        { error: 'Rapport introuvable' },
        { status: 404 },
      );

    const dispoA = new Date(data.disponible_a as string);
    if (Date.now() < dispoA.getTime()) {
      return NextResponse.json(
        { error: 'Rapport sous embargo H+24', disponible_a: data.disponible_a },
        { status: 425 },
      );
    }
    if (!data.genere_at)
      return NextResponse.json(
        { error: 'PDF non encore généré' },
        { status: 202 },
      );
    storageKey = data.pdf_url as string | null;
  } else if (type === 'attestation') {
    const { data, error } = await supabase
      .from('attestations_don')
      .select('id, genere_at, pdf_url')
      .eq('id', id)
      .maybeSingle();
    if (error || !data)
      return NextResponse.json(
        { error: 'Attestation introuvable' },
        { status: 404 },
      );
    if (!data.genere_at)
      return NextResponse.json(
        { error: 'PDF non encore généré' },
        { status: 202 },
      );
    storageKey = data.pdf_url as string | null;
  } else if (type === 'bordereau') {
    const { data, error } = await supabase
      .from('bordereaux_savr')
      .select('id, genere_at, fichiers:pdf_fichier_id(url)')
      .eq('id', id)
      .maybeSingle();
    if (error || !data)
      return NextResponse.json(
        { error: 'Bordereau introuvable' },
        { status: 404 },
      );
    if (!data.genere_at)
      return NextResponse.json(
        { error: 'PDF non encore généré' },
        { status: 202 },
      );
    const fichier = data.fichiers as
      | { url?: string }
      | { url?: string }[]
      | null;
    storageKey = Array.isArray(fichier)
      ? (fichier[0]?.url ?? null)
      : (fichier?.url ?? null);
  } else {
    return NextResponse.json(
      { error: 'Type de document inconnu' },
      { status: 400 },
    );
  }

  if (!storageKey)
    return NextResponse.json({ error: 'Fichier PDF absent' }, { status: 404 });

  const url = await getPresignedUrl(storageKey, 900);
  return NextResponse.json({ url, expires_in: 900 });
}
