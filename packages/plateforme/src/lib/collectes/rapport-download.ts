import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
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
// l'utilisateur. Les documents sont ensuite lus :
//  · 'service' (traiteur) : service-role borné à CETTE collecte, comme la route
//    traiteur historique (BL-P1-TRAIT-03) ;
//  · 'rls' (agence, gestionnaire) : sous LEUR RLS (rr_select /
//    att_traiteur_select / att_gestionnaire_select) — jamais de service-role.
// Embargo applicatif H+24 (R-PDF2) jamais contournable.

export async function repondreTelechargementRapport(
  id: string,
  lecture: 'service' | 'rls',
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

  const docs = lecture === 'rls' ? rls : createAdminSupabaseClient();

  const { type: collecteType, statut: collecteStatut } = collecte as {
    type: string;
    statut: string;
  };
  const servirAttestation =
    collecteType === 'anti_gaspi' &&
    collecteStatut !== 'realisee_sans_collecte';

  if (servirAttestation) {
    const { data: att } = await docs
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

  const { data: rapport } = await docs
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
