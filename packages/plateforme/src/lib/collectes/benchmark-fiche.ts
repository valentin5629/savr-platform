import { NextRequest, NextResponse } from 'next/server';
import {
  createSupabaseServerClient,
  type UserAuthContext,
} from '@/lib/api-auth.js';
import {
  ERREUR_FILTRE_HORS_PERIMETRE,
  ERREUR_FILTRE_TRAITEURS_INTERDIT,
  loadBenchmark,
  LoaderError,
} from '@/lib/dashboards/loaders.js';
import {
  aggregateBenchmarkPerFlux,
  type BenchmarkRow,
} from '@/lib/dashboards/cockpit-derive.js';
import { serverError } from '@/lib/api-helpers.js';

// Radar ZD de la FICHE collecte (§06.04, grain `single_collecte`) — commun aux
// routes /api/v1/{traiteur,agence,gestionnaire}/collectes/[id]/benchmark :
//  · ratio_user      = kg du flux SUR CETTE COLLECTE / pax de CETTE collecte
//                      (lot C1 ; NULL à 0 convive)
//  · benchmark parc  = moyenne pondérée du segment, k-anonymat côté serveur
//
// `f_benchmark_single_collecte` porte le ratio ET la garde d'accès : elle
// accepte l'organisation programmatrice, le traiteur opérationnel et, depuis la
// décision Val du 2026-10-20, le gestionnaire dont l'organisation est rattachée
// au lieu d'un événement daté (collectes de traiteurs tiers sur ses lieux). Une
// collecte que la RLS montre pour une autre raison (`f_collecte_visible` : par
// exemple l'organisation de l'appelant nommée client organisateur de
// l'événement, rattachement fait par l'Admin) reste refusée
// par la fonction : ce n'est pas une erreur, c'est « pas de radar pour cette
// collecte » (200, data null — l'écran masque le bloc). La garde n'est jamais
// contournée en service-role ; la visibilité RLS n'est lue QUE pour distinguer
// ce cas d'une collecte hors périmètre (404).
//
// Le repère parc vient du MÊME loader que les dashboards (même garde
// `traiteur_ids[]` par rôle, même garde de périmètre du gestionnaire, même
// période fixe 24 mois).

interface LigneSingle {
  flux_code: string;
  ratio_user: number | null;
}

/** kg/convive de la collecte et repère parc, par code de flux. */
export type FluxBenchmarkFiche = Record<
  string,
  { ratio_user: number | null; benchmark_kg_pax: number | null }
>;

export interface FiltresBenchmarkFiche {
  tailleCodes: string[] | null;
  typeIds: string[] | null;
  lieuIds: string[] | null;
  traiteurIds: string[] | null;
}

export type BenchmarkFiche =
  | { etat: 'ok'; flux: FluxBenchmarkFiche }
  /** Collecte visible sous la RLS, mais refusée par la fonction : pas de radar pour elle. */
  | { etat: 'sans_radar' }
  | { etat: 'introuvable' }
  /**
   * Filtre refusé au rôle : périmètre du gestionnaire (§06.05) ou filtre
   * « traiteurs » interdit aux rôles traiteur et agence (§04).
   */
  | { etat: 'filtre_interdit'; motif: 'perimetre' | 'traiteurs' }
  | { etat: 'erreur'; erreur: unknown };

/**
 * Radar de la fiche pour UNE collecte et un jeu de filtres, lu sous l'identité
 * de l'appelant. Source unique de l'écran (route `…/benchmark`) et du rapport
 * PDF demandé avec radar (régénération) : les deux affichent les mêmes chiffres.
 */
export async function chargerBenchmarkFiche(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  ctx: UserAuthContext,
  id: string,
  filtres: FiltresBenchmarkFiche,
): Promise<BenchmarkFiche> {
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
      return visible ? { etat: 'sans_radar' } : { etat: 'introuvable' };
    }
    return { etat: 'erreur', erreur: error };
  }

  let parc: Record<string, number>;
  try {
    // aggregateBenchmarkPerFlux (R24) recombine les segments type × taille en une
    // valeur par flux ; un flux sous le seuil k-anonymat est absent de la map.
    parc = aggregateBenchmarkPerFlux(
      (await loadBenchmark(supabase, ctx, {
        tailleCodes: filtres.tailleCodes,
        bracket: null,
        typeIds: filtres.typeIds,
        lieuIds: filtres.lieuIds,
        traiteurIds: filtres.traiteurIds,
      })) as BenchmarkRow[],
    );
  } catch (e) {
    // Deux erreurs métier atteignables ici (403), une par famille de rôles : la
    // garde de périmètre pour le gestionnaire (§06.05), la garde §04
    // « traiteur_ids[] interdit » pour les rôles traiteur et agence. Seul le
    // motif sort d'ici — aucun message d'origine loader/Postgres (C1).
    if (e instanceof LoaderError && e.status === 403)
      return {
        etat: 'filtre_interdit',
        motif: ctx.role === 'gestionnaire_lieux' ? 'perimetre' : 'traiteurs',
      };
    if (e instanceof LoaderError) return { etat: 'erreur', erreur: e };
    throw e;
  }

  return {
    etat: 'ok',
    flux: Object.fromEntries(
      ((data ?? []) as LigneSingle[]).map((l) => [
        l.flux_code,
        {
          ratio_user: l.ratio_user,
          benchmark_kg_pax: parc[l.flux_code] ?? null,
        },
      ]),
    ),
  };
}

/** 403 au libellé FIXE, choisi sur le motif (écran et régénération du rapport). */
export function reponseFiltreInterdit(
  motif: 'perimetre' | 'traiteurs',
): NextResponse {
  return NextResponse.json(
    {
      error:
        motif === 'perimetre'
          ? ERREUR_FILTRE_HORS_PERIMETRE
          : ERREUR_FILTRE_TRAITEURS_INTERDIT,
    },
    { status: 403 },
  );
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

  const r = await chargerBenchmarkFiche(supabase, ctx, id, {
    tailleCodes: csv('taille_evenement_codes'),
    typeIds: csv('type_evenement_ids'),
    lieuIds: csv('lieu_ids'),
    traiteurIds: csv('traiteur_ids'),
  });
  switch (r.etat) {
    case 'ok':
      return NextResponse.json({ data: { flux: r.flux } });
    case 'sans_radar':
      return NextResponse.json({ data: null });
    case 'introuvable':
      return NextResponse.json(
        { error: 'Collecte introuvable' },
        { status: 404 },
      );
    case 'filtre_interdit':
      return reponseFiltreInterdit(r.motif);
    case 'erreur':
      return serverError(r.erreur, evenementLog);
  }
}
