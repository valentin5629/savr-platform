import { redirect } from 'next/navigation';
import { createSupabaseServerClient, getVerifiedClaims } from '@/lib/api-auth';
import {
  loadTraiteurDashboard,
  loadBenchmark,
  loadBenchmarkFiltres,
  type LoaderCtx,
} from '@/lib/dashboards/loaders';
import type { BenchmarkFilterOptions } from '@/components/dashboards/index.js';
import type { MultiOption } from '@/components/dashboards/MultiSelectFilter';
import type { BenchmarkFilters } from '@/components/dashboards/BenchmarkFilterBar';
import type { BenchmarkRow } from '@/lib/dashboards/cockpit-derive';
import { TraiteurDashboardClient } from './traiteur-dashboard-client';

// Lecture cookies + agrégats live par utilisateur → jamais statique.
export const dynamic = 'force-dynamic';

/**
 * Dashboard traiteur (§06.04 / §11) — SERVER COMPONENT (R-perf).
 *
 * Le premier rendu est fait CÔTÉ SERVEUR, données incluses : auth locale (getClaims,
 * 0 aller-retour — le layout a déjà validé la session via getUser), puis UN Promise.all
 * des loaders (kpi + évolution + blocs + marge + benchmark + options benchmark) à côté
 * de la base. Supprime le temps mort d'hydratation (~0,6 s) et la vague sérialisée
 * benchmark→filtres. L'interactivité (onglets/filtres/N-1) vit dans le composant client,
 * qui re-fetch via l'endpoint consolidé `/api/v1/dashboards/traiteur-full`.
 *
 * Périmètre : `traiteur_manager` + `traiteur_commercial` (gate middleware + layout ;
 * défense en profondeur ici : scope org des loaders sous l'identité de l'appelant).
 */

// Période par défaut — 12 derniers mois (§11 l.179, aligné DashboardFilterBar).
function defaultPeriod(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setMonth(from.getMonth() - 12);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export default async function TraiteurDashboardPage() {
  // Défense en profondeur (le layout garde déjà /traiteur/*) — auth LOCALE.
  const supabase = createSupabaseServerClient({ readonly: true });
  const claims = await getVerifiedClaims(supabase);
  if (!claims) redirect('/login');
  if (
    claims.role !== 'traiteur_manager' &&
    claims.role !== 'traiteur_commercial'
  ) {
    redirect('/403');
  }
  if (!claims.organisationId) redirect('/403');

  const ctx: LoaderCtx = {
    userId: claims.userId,
    role: claims.role,
    organisationId: claims.organisationId,
  };

  const { from, to } = defaultPeriod();
  // Filtres benchmark par défaut = 12 mois glissants (comme BenchmarkFilterBar),
  // type/taille hérités des filtres globaux (vides côté traiteur).
  const benchmarkFilters: BenchmarkFilters = {
    periode_debut: from,
    periode_fin: to,
    type_evenement_ids: [],
    taille_evenement_codes: [],
    lieu_ids: [],
    traiteur_ids: [],
  };

  // UN SEUL Promise.all serveur : dashboard (onglet ZD) + repère parc + options.
  // Le benchmark/filtres est chargé DANS ce Promise.all (plus de 2e vague sérielle).
  const [dashboard, benchmarkFiltres, benchmarkData] = await Promise.all([
    loadTraiteurDashboard(supabase, ctx, { from, to, type: 'zero_dechet' }),
    loadBenchmarkFiltres(supabase, ctx),
    loadBenchmark(supabase, ctx, {
      periodeDebut: benchmarkFilters.periode_debut,
      periodeFin: benchmarkFilters.periode_fin,
    }),
  ]);

  const options: BenchmarkFilterOptions = {
    lieux: benchmarkFiltres.lieux as MultiOption[],
    traiteurs: benchmarkFiltres.traiteurs as MultiOption[],
    types: benchmarkFiltres.types as { id: string; libelle: string }[],
  };

  return (
    <TraiteurDashboardClient
      initialData={dashboard}
      initialFilters={{ from, to }}
      benchmark={{
        rows: benchmarkData as BenchmarkRow[],
        options,
        filters: benchmarkFilters,
      }}
    />
  );
}
