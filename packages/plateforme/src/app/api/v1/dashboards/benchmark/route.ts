import { NextRequest, NextResponse } from 'next/server';
import { requireUser, createSupabaseServerClient } from '@/lib/api-auth.js';
import { loadBenchmark, LoaderError } from '@/lib/dashboards/loaders.js';

// Rôles autorisés à appeler le benchmark (§04 f_benchmark_kg_pax_zd).
const ALLOWED_ROLES = [
  'gestionnaire_lieux',
  'traiteur_manager',
  'traiteur_commercial',
  // Agence = réplique stricte §06.04 (benchmark 4 dimensions, traiteur_ids rejeté).
  'agence',
] as const;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, [...ALLOWED_ROLES]);
  if (auth.error) return auth.error;

  const supabase = createSupabaseServerClient();
  const { searchParams } = new URL(req.url);

  // Arrays passés en CSV (ex ?taille_evenement_codes=M,L). `bracket` (mono-taille)
  // = compat legacy des dashboards sans encart. Le défaut (5 brackets) + la garde
  // traiteur_ids vivent dans le loader.
  const csv = (k: string): string[] | null => {
    const v = searchParams.get(k);
    if (!v) return null;
    const arr = v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return arr.length ? arr : null;
  };

  try {
    const data = await loadBenchmark(supabase, auth.ctx, {
      tailleCodes: csv('taille_evenement_codes'),
      bracket: searchParams.get('bracket'),
      typeIds: csv('type_evenement_ids'),
      lieuIds: csv('lieu_ids'),
      traiteurIds: csv('traiteur_ids'),
      periodeDebut: searchParams.get('periode_debut'),
      periodeFin: searchParams.get('periode_fin'),
    });
    return NextResponse.json(
      { data },
      { headers: { 'Cache-Control': 'private, max-age=300' } },
    );
  } catch (e) {
    if (e instanceof LoaderError)
      return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
