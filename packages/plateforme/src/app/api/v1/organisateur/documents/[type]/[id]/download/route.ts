// GET /api/v1/organisateur/documents/:type/:id/download
// Retourne une URL pré-signée R2 (15 min) pour un document du client organisateur.
// type ∈ rapport | bordereau | attestation.
// Sécurité : client user-scopé → la RLS (rr_select / bord_client_orga_select /
// att_client_orga_select) est la frontière ; une ligne d'un autre organisateur → 404.
// Embargo H+24 (R-PDF2) appliqué côté serveur sur les rapports RSE (disponible_a),
// jamais contournable.
// Les deux documents d'une collecte AG (attestation, rapport sans excédent) sont
// servis sous un nom de fichier « rapport-de-don-… » (§12 §1.3-bis).
// Rapport de recyclage ZD : fabriqué au clic (décision Val 2026-10-16) et rendu
// tel quel (application/pdf), sans radar — le client organisateur n'a pas de
// fiche collecte où le choisir.

import { NextRequest, NextResponse } from 'next/server';

import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { fabriquerRapport } from '@/lib/collectes/rapport-a-la-demande.js';
import { storageKeysDesFichiers } from '@/lib/pdf/fichier-storage-key.js';
import {
  nomFichierAttestation,
  nomFichierDuRapportDeLaCollecte,
} from '@/lib/pdf/nom-fichier-rapport-de-don.js';
import { getPresignedUrl } from '@/lib/pdf/r2-client.js';
import { type SupabaseClient } from '@savr/shared/src/supabase-client.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Le rendu du rapport de recyclage prend quelques secondes.
export const maxDuration = 60;

const ORGANISATEUR_ROLES: ClientRole[] = ['client_organisateur'];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ type: string; id: string }> },
): Promise<NextResponse> {
  const auth = await requireUser(req, ORGANISATEUR_ROLES);
  if (auth.error) return auth.error;

  const { type, id } = await params;
  const supabase = createSupabaseServerClient() as unknown as SupabaseClient;

  let storageKey: string | null = null;
  let nomFichier: string | undefined;

  if (type === 'rapport') {
    const { data, error } = await supabase
      .from('rapports_rse')
      .select('id, collecte_id, disponible_a, genere_at, pdf_url')
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
    // Ligne lue sous rr_select : l'accès est établi. Le type de la collecte, lu
    // sous la même RLS, dit s'il s'agit du rapport de recyclage (fabriqué au
    // clic) ou du rapport de don (fichier stocké).
    // Collecte illisible : on sert le fichier stocké s'il existe, comme avant
    // (même tolérance que pour le nom du fichier, ci-dessous).
    const { data: col } = await supabase
      .from('collectes')
      .select('type')
      .eq('id', data.collecte_id as string)
      .maybeSingle();
    if ((col as { type: string } | null)?.type === 'zero_dechet') {
      return fabriquerRapport(
        data.collecte_id as string,
        { avecRadar: false },
        'organisateur.documents.rapport',
      );
    }
    if (!data.genere_at)
      return NextResponse.json(
        { error: 'PDF non encore généré' },
        { status: 202 },
      );
    storageKey = data.pdf_url as string | null;
    if (storageKey) {
      nomFichier = await nomFichierDuRapportDeLaCollecte(
        supabase,
        data.collecte_id as string,
      );
    }
  } else if (type === 'attestation') {
    const { data, error } = await supabase
      .from('attestations_don')
      .select('id, numero, genere_at, pdf_url')
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
    nomFichier = nomFichierAttestation(data.numero as string | null);
  } else if (type === 'bordereau') {
    const { data, error } = await supabase
      .from('bordereaux_savr')
      .select('id, genere_at, pdf_fichier_id')
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
    // pdf_fichier_id → shared.fichiers (bucket/key) : pas d'embed cross-schema.
    storageKey =
      (await storageKeysDesFichiers(supabase, [data.pdf_fichier_id])).get(
        data.pdf_fichier_id ?? '',
      ) ?? null;
  } else {
    return NextResponse.json(
      { error: 'Type de document inconnu' },
      { status: 400 },
    );
  }

  if (!storageKey)
    return NextResponse.json({ error: 'Fichier PDF absent' }, { status: 404 });

  const url = await getPresignedUrl(storageKey, 900, nomFichier);
  return NextResponse.json({ url, expires_in: 900 });
}
