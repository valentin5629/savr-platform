import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { loadBenchmark, LoaderError } from '@/lib/dashboards/loaders.js';
import {
  aggregateBenchmarkPerFlux,
  type BenchmarkRow,
} from '@/lib/dashboards/cockpit-derive.js';
import { serverError } from '@/lib/api-helpers.js';

// Bloc 3 ZD de la FICHE collecte (§06.04) — grain `single_collecte` :
//  · ratio_user      = kg du flux SUR CETTE COLLECTE / pax de l'événement
//  · benchmark parc  = moyenne pondérée du segment, k-anonymat ≥5 côté serveur
//
// Deux appels, deux rôles distincts. `f_benchmark_single_collecte` porte le ratio
// de la collecte ET la garde de visibilité (fail fast « Collecte not accessible »).
// Le repère parc vient toujours du MÊME loader que les dashboards, avec les
// filtres de l'encart — que la page initialise sur le segment de la collecte
// (type × taille) et 12 mois glissants, comme le CDC le demande. Un chemin unique :
// la garde « traiteur_ids[] interdit » s'arme donc sur toute requête, pas
// seulement sur celles qui portent un autre filtre.
const TRAITEUR_ROLES: ClientRole[] = [
  'traiteur_manager',
  'traiteur_commercial',
];

interface LigneSingle {
  flux_code: string;
  ratio_user: number | null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUser(req, TRAITEUR_ROLES);
  if (auth.error) return auth.error;
  const { id } = await params;

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

  // Grain collecte. La fonction est SECURITY DEFINER et re-vérifie elle-même la
  // visibilité de la collecte : un id d'une autre organisation lève, d'où le 404.
  const { data, error } = await supabase.rpc('f_benchmark_single_collecte', {
    p_collecte_id: id,
  });
  if (error) {
    if ((error.message ?? '').includes('Collecte not accessible'))
      return NextResponse.json(
        { error: 'Collecte introuvable' },
        { status: 404 },
      );
    return serverError(error, 'traiteur.collectes.benchmark');
  }

  let parc: Record<string, number>;
  try {
    // aggregateBenchmarkPerFlux (R24) recombine les segments type × taille en une
    // valeur par flux ; un flux sous le seuil k-anonymat est absent de la map.
    parc = aggregateBenchmarkPerFlux(
      (await loadBenchmark(supabase, auth.ctx, {
        tailleCodes: csv('taille_evenement_codes'),
        bracket: null,
        typeIds: csv('type_evenement_ids'),
        lieuIds: csv('lieu_ids'),
        traiteurIds: csv('traiteur_ids'),
        periodeDebut: searchParams.get('periode_debut'),
        periodeFin: searchParams.get('periode_fin'),
      })) as BenchmarkRow[],
    );
  } catch (e) {
    // Seule erreur métier atteignable ici : la garde §04 « traiteur_ids[]
    // interdit au traiteur » (403). Libellé fixe écrit ici — aucun message
    // d'origine loader/Postgres n'est relayé au client (C1).
    if (e instanceof LoaderError)
      return e.status === 403
        ? NextResponse.json(
            {
              error:
                'Le filtre traiteur_ids est interdit pour ce rôle (§04 préservation compétitive)',
            },
            { status: 403 },
          )
        : serverError(e, 'traiteur.collectes.benchmark');
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
