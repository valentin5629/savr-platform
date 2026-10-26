// Réponses des routes cumulées d'un événement (radar et rapports, décision Val
// 2026-10-26), communes aux espaces : la route de l'espace vérifie le rôle,
// puis délègue ici. L'accès est toujours celui de l'événement SOUS L'IDENTITÉ
// du demandeur (`lireEvenementVisible`), jamais retranscrit.

import { NextRequest, NextResponse } from 'next/server';

import {
  createSupabaseServerClient,
  type UserAuthContext,
} from '@/lib/api-auth.js';
import { serverError } from '@/lib/api-helpers.js';
import {
  filtresBenchmarkDeLaRequete,
  reponseFiltreInterdit,
} from '@/lib/collectes/benchmark-fiche.js';
import { lireVersionDemandee } from '@/lib/collectes/rapport-a-la-demande.js';
import { estUuid } from '@/lib/filtre-csv.js';
import {
  fabriquerRapportEvenement,
  type TypeRapportEvenement,
} from '@/lib/pdf/rapports-evenement.js';
import {
  filtresBenchmarkDuRadar,
  habillerRadar,
} from '@/lib/pdf/rapport-radar.js';

import {
  chargerBenchmarkEvenement,
  lireEvenementVisible,
  type EvenementVisible,
} from './cumul-evenement.js';

const NON_TROUVE = () =>
  NextResponse.json({ error: 'Événement non trouvé' }, { status: 404 });

async function evenementOuRefus(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  id: string,
  evenementLog: string,
): Promise<{ evenement: EvenementVisible } | { refus: NextResponse }> {
  if (!estUuid(id)) return { refus: NON_TROUVE() };
  const lu = await lireEvenementVisible(supabase, id);
  if (lu.etat === 'erreur')
    return { refus: serverError(lu.erreur, evenementLog) };
  if (lu.etat === 'introuvable') return { refus: NON_TROUVE() };
  return { evenement: lu.evenement };
}

/**
 * GET …/evenements/[id]/benchmark : radar du bilan consolidé ZD, même forme de
 * réponse que celui de la fiche collecte (`data: null` = pas de radar).
 */
export async function repondreBenchmarkEvenement(
  req: NextRequest,
  id: string,
  ctx: UserAuthContext,
  evenementLog: string,
): Promise<NextResponse> {
  const supabase = createSupabaseServerClient();
  const lu = await evenementOuRefus(supabase, id, evenementLog);
  if ('refus' in lu) return lu.refus;
  const r = await chargerBenchmarkEvenement(
    supabase,
    ctx,
    lu.evenement,
    filtresBenchmarkDeLaRequete(req),
  );
  switch (r.etat) {
    case 'ok':
      return NextResponse.json({ data: { flux: r.flux } });
    case 'sans_radar':
    case 'introuvable':
      return NextResponse.json({ data: null });
    case 'filtre_interdit':
      return reponseFiltreInterdit(r.motif);
    case 'erreur':
      return serverError(r.erreur, evenementLog);
  }
}

/**
 * POST …/evenements/[id]/rapport-rse (ZD, radar au choix comme pour une
 * collecte) et …/rapport-de-don (AG, sans radar) : le PDF lui-même.
 */
export async function repondreRapportEvenement(
  req: NextRequest,
  id: string,
  ctx: UserAuthContext,
  type: TypeRapportEvenement,
  evenementLog: string,
): Promise<NextResponse> {
  const supabase = createSupabaseServerClient();
  const lu = await evenementOuRefus(supabase, id, evenementLog);
  if ('refus' in lu) return lu.refus;
  const evenement = lu.evenement;

  // Radar au choix du demandeur sur le seul rapport ZD ; le rapport de don
  // n'en a jamais (son corps n'est pas lu).
  const version =
    type === 'zero_dechet'
      ? await lireVersionDemandee(
          req,
          async (filtres) => {
            const r = await chargerBenchmarkEvenement(
              supabase,
              ctx,
              evenement,
              filtresBenchmarkDuRadar(filtres),
            );
            return r.etat === 'ok'
              ? habillerRadar(supabase, filtres, r.flux)
              : r;
          },
          evenementLog,
          undefined,
          'cet événement',
        )
      : { version: { avecRadar: false as const } };
  if ('refus' in version) return version.refus;

  return fabriquerRapportEvenement({
    evenementId: evenement.id,
    type,
    collectes: evenement.collectes,
    version: version.version,
    rls: supabase,
    role: ctx.role,
    evenementLog,
  });
}
