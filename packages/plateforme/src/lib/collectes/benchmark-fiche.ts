import { NextRequest, NextResponse } from 'next/server';
import {
  createSupabaseServerClient,
  type UserAuthContext,
} from '@/lib/api-auth.js';
import { loadBenchmark, LoaderError } from '@/lib/dashboards/loaders.js';
import {
  aggregateBenchmarkPerFlux,
  type BenchmarkRow,
} from '@/lib/dashboards/cockpit-derive.js';
import { serverError } from '@/lib/api-helpers.js';

// Radar ZD de la FICHE collecte (§06.04, grain `single_collecte`) — commun aux
// routes /api/v1/{traiteur,agence,gestionnaire}/collectes/[id]/benchmark :
//  · ratio_user      = kg du flux SUR CETTE COLLECTE / pax de l'événement
//  · benchmark parc  = moyenne pondérée du segment, k-anonymat côté serveur
//
// `f_benchmark_single_collecte` porte le ratio ET la garde d'accès : elle
// n'accepte que l'organisation programmatrice ou le traiteur opérationnel. Un
// gestionnaire voit (RLS) des collectes de traiteurs tiers sur ses lieux que la
// fonction refuse : ce n'est pas une erreur, c'est « pas de radar pour cette
// collecte » (200, data null — l'écran masque le bloc). La garde n'est JAMAIS
// élargie ni contournée en service-role (arbitrage 2026-09-29) ; la visibilité
// RLS n'est lue QUE pour distinguer ce cas d'une collecte hors périmètre (404).
//
// Le repère parc vient du MÊME loader que les dashboards (même garde
// `traiteur_ids[]` par rôle, même période fixe 24 mois).

interface LigneSingle {
  flux_code: string;
  ratio_user: number | null;
}

export async function repondreBenchmarkFiche(
  req: NextRequest,
  id: string,
  ctx: UserAuthContext,
  evenementLog: string,
): Promise<NextResponse> {
  const supabase = createSupabaseServerClient();
  const { searchParams } = new URL(req.url);

  const csv = (k: string): string[] | null => {
    const v = searchParams.get(k);
    if (!v) return null;
    const arr = v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return arr.length ? arr : null;
  };

  const { data, error } = await supabase.rpc('f_benchmark_single_collecte', {
    p_collecte_id: id,
  });
  if (error) {
    if ((error.message ?? '').includes('Collecte not accessible')) {
      const { data: visible } = await supabase
        .from('collectes')
        .select('id')
        .eq('id', id)
        .maybeSingle();
      return visible
        ? NextResponse.json({ data: null })
        : NextResponse.json({ error: 'Collecte introuvable' }, { status: 404 });
    }
    return serverError(error, evenementLog);
  }

  let parc: Record<string, number>;
  try {
    // aggregateBenchmarkPerFlux (R24) recombine les segments type × taille en une
    // valeur par flux ; un flux sous le seuil k-anonymat est absent de la map.
    parc = aggregateBenchmarkPerFlux(
      (await loadBenchmark(supabase, ctx, {
        tailleCodes: csv('taille_evenement_codes'),
        bracket: null,
        typeIds: csv('type_evenement_ids'),
        lieuIds: csv('lieu_ids'),
        traiteurIds: csv('traiteur_ids'),
      })) as BenchmarkRow[],
    );
  } catch (e) {
    // Seule erreur métier atteignable ici : la garde §04 « traiteur_ids[]
    // interdit » (403). Libellé fixe écrit ici — aucun message d'origine
    // loader/Postgres n'est relayé au client (C1).
    if (e instanceof LoaderError)
      return e.status === 403
        ? NextResponse.json(
            {
              error:
                'Le filtre traiteur_ids est interdit pour ce rôle (§04 préservation compétitive)',
            },
            { status: 403 },
          )
        : serverError(e, evenementLog);
    throw e;
  }

  return NextResponse.json({
    data: {
      flux: Object.fromEntries(
        ((data ?? []) as LigneSingle[]).map((l) => [
          l.flux_code,
          {
            ratio_user: l.ratio_user,
            benchmark_kg_pax: parc[l.flux_code] ?? null,
          },
        ]),
      ),
    },
  });
}
