import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { loadBenchmark, LoaderError } from '@/lib/dashboards/loaders.js';
import { serverError } from '@/lib/api-helpers.js';

// Bloc 3 ZD de la FICHE collecte (§06.04) — grain `single_collecte` :
//  · ratio_user      = kg du flux SUR CETTE COLLECTE / pax de l'événement
//  · benchmark parc  = moyenne pondérée du segment, k-anonymat ≥5 côté serveur
//
// Sans paramètre, le point de comparaison est le segment de la collecte
// (type d'événement × taille) : c'est l'initialisation décrite au CDC. Dès que
// l'utilisateur touche l'encart de filtres, le repère parc est recalculé via le
// MÊME loader que les dashboards (garde `traiteur_ids[]` interdite incluse) ;
// `ratio_user` ne bouge pas — c'est une donnée de la collecte, pas du parc.
const TRAITEUR_ROLES: ClientRole[] = [
  'traiteur_manager',
  'traiteur_commercial',
];

interface LigneSingle {
  flux_code: string;
  taille_evenement: string | null;
  ratio_user: number | null;
  benchmark_kg_pax: number | null;
  nb_collectes_segment: number | null;
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
  // visibilité de la collecte (fail fast « Collecte not accessible ») : un id
  // d'une autre organisation ne renvoie donc rien d'exploitable → 404.
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

  const lignes = (data ?? []) as LigneSingle[];
  const items = new Map<
    string,
    { ratio_user: number | null; benchmark_kg_pax: number | null; nb: number }
  >();
  for (const l of lignes) {
    items.set(l.flux_code, {
      ratio_user: l.ratio_user,
      benchmark_kg_pax: l.benchmark_kg_pax,
      nb: l.nb_collectes_segment ?? 0,
    });
  }
  const taille_evenement = lignes[0]?.taille_evenement ?? null;

  // Filtres benchmark personnalisés → le repère parc est recalculé sur le segment
  // demandé (les jauges, elles, restent celles de la collecte).
  const filtresFournis =
    searchParams.has('periode_debut') ||
    searchParams.has('periode_fin') ||
    searchParams.has('type_evenement_ids') ||
    searchParams.has('taille_evenement_codes') ||
    searchParams.has('lieu_ids');

  if (filtresFournis) {
    try {
      const parc = (await loadBenchmark(supabase, auth.ctx, {
        tailleCodes: csv('taille_evenement_codes'),
        bracket: null,
        typeIds: csv('type_evenement_ids'),
        lieuIds: csv('lieu_ids'),
        traiteurIds: csv('traiteur_ids'),
        periodeDebut: searchParams.get('periode_debut'),
        periodeFin: searchParams.get('periode_fin'),
      })) as Array<{
        flux_code: string;
        kg_par_pax_moyen: number | null;
        nb_collectes_segment: number | null;
      }>;
      // Agrégat par flux : le loader rend une ligne par segment (type × taille),
      // donc plusieurs lignes dès que le filtre couvre plusieurs types ou tailles.
      // On les combine en pondérant par l'effectif du segment. APPROXIMATION
      // assumée : la définition parc pondère au TONNAGE (Σpoids / Σpax) et le
      // poids exact serait Σpax, que f_benchmark_kg_pax_zd n'expose pas. L'écart
      // ne joue qu'entre segments de kg/pax très différents ; le corriger
      // exigerait d'élargir la sortie de la fonction, partagée avec les
      // dashboards — hors périmètre de cette PR.
      const parFlux = new Map<string, { somme: number; nb: number }>();
      for (const p of parc) {
        if (p.kg_par_pax_moyen == null) continue;
        const nb = p.nb_collectes_segment ?? 0;
        const cur = parFlux.get(p.flux_code) ?? { somme: 0, nb: 0 };
        cur.somme += Number(p.kg_par_pax_moyen) * nb;
        cur.nb += nb;
        parFlux.set(p.flux_code, cur);
      }
      for (const [code, cur] of items) {
        const agg = parFlux.get(code);
        // Segment sous le seuil k-anonymat ⇒ aucune ligne ⇒ repère masqué.
        cur.benchmark_kg_pax = agg && agg.nb > 0 ? agg.somme / agg.nb : null;
        cur.nb = agg?.nb ?? 0;
      }
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
  }

  return NextResponse.json({
    data: {
      taille_evenement,
      flux: Object.fromEntries(
        [...items].map(([code, v]) => [
          code,
          {
            ratio_user: v.ratio_user,
            benchmark_kg_pax: v.benchmark_kg_pax,
            nb_collectes_segment: v.nb,
          },
        ]),
      ),
    },
  });
}
