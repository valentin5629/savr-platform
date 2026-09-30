import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/api-auth.js';
import { getPresignedUrl } from '@/lib/pdf/r2-client.js';

// Téléchargement du rapport d'UNE collecte depuis la fiche client — commun aux
// routes /api/v1/{traiteur,agence,gestionnaire}/collectes/[id]/rapport-rse/download.
//
//  · ZD                         → rapport de recyclage (rapports_rse, embargo H+24)
//  · AG cloturee                → attestation de don (affichée « Rapport de don »,
//                                 renommage d'affichage seul — Q5)
//  · AG realisee_sans_collecte  → rapport « Événement sans excédent alimentaire »
//                                 (rapports_rse, disponible_a = genere_at)
//
// Cloisonnement : la collecte doit d'abord être visible sous la RLS de
// l'utilisateur, puis les documents sont lus sous cette même RLS (rr_select /
// att_traiteur_select / att_gestionnaire_select) — jamais de service-role.
// Le traiteur opérationnel d'une collecte AG programmée par une agence reçoit
// donc 404 sur l'attestation de don du donneur d'ordre (D12, arbitrage Val
// 2026-09-30 ; la lecture service-role historique la lui servait).
// Embargo applicatif H+24 (R-PDF2) jamais contournable.

export async function repondreTelechargementRapport(
  id: string,
): Promise<NextResponse> {
  const rls = createSupabaseServerClient();
  const { data: collecte } = await rls
    .from('collectes')
    .select('id, type, statut')
    .eq('id', id)
    .maybeSingle();
  if (!collecte) {
    return NextResponse.json(
      { error: 'Collecte introuvable' },
      { status: 404 },
    );
  }

  const { type: collecteType, statut: collecteStatut } = collecte as {
    type: string;
    statut: string;
  };
  const servirAttestation =
    collecteType === 'anti_gaspi' &&
    collecteStatut !== 'realisee_sans_collecte';

  if (servirAttestation) {
    const { data: att } = await rls
      .from('attestations_don')
      .select('id, eligible_at, pdf_url')
      .eq('collecte_id', id)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!att) {
      return NextResponse.json(
        { error: 'Attestation introuvable' },
        { status: 404 },
      );
    }
    if (Date.now() < new Date(att.eligible_at as string).getTime()) {
      return NextResponse.json(
        { error: 'Rapport sous embargo H+24', disponible_a: att.eligible_at },
        { status: 425 },
      );
    }
    const attKey = att.pdf_url as string | null;
    if (!attKey) {
      return NextResponse.json(
        { error: 'PDF non encore généré' },
        { status: 202 },
      );
    }
    const attUrl = await getPresignedUrl(attKey, 900);
    return NextResponse.json({ url: attUrl, expires_in: 900 });
  }

  const { data: rapport } = await rls
    .from('rapports_rse')
    .select('id, disponible_a, genere_at, pdf_url')
    .eq('collecte_id', id)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!rapport) {
    return NextResponse.json({ error: 'Rapport introuvable' }, { status: 404 });
  }

  if (Date.now() < new Date(rapport.disponible_a as string).getTime()) {
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
  const storageKey = rapport.pdf_url as string | null;
  if (!storageKey) {
    return NextResponse.json({ error: 'Fichier PDF absent' }, { status: 404 });
  }

  const url = await getPresignedUrl(storageKey, 900);
  return NextResponse.json({ url, expires_in: 900 });
}
