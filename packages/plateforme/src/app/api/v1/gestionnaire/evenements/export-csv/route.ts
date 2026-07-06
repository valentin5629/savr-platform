import { NextRequest, NextResponse } from 'next/server';
import { csvFilename } from '@savr/shared/src/csv/index.js';
import { type SupabaseClient } from '@savr/shared/src/supabase-client.js';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { csvResponse } from '@/lib/csv.js';
import {
  EVENEMENTS_SELECT,
  evenementsToCsv,
} from '@/lib/exports/evenements.js';

const ROLES: ClientRole[] = ['gestionnaire_lieux'];

// GET /api/v1/gestionnaire/evenements/export-csv
// Export CSV grain événement (§06.05 §2 / §12 §2). Périmètre gestionnaire =
// ses lieux (organisations_lieux) + filtre lieu_ids[] optionnel. Le mapping et
// le format CSV sont factorisés dans le module partagé lib/exports/evenements
// (transverse D) — colonnes figées §12 §2, dates/poids au format canonique.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;

  const supabase = createSupabaseServerClient() as unknown as SupabaseClient;
  const sp = new URL(req.url).searchParams;
  const from = sp.get('from');
  const to = sp.get('to');
  const lieuIds = sp.getAll('lieu_ids[]');
  const traiteurIds = sp.getAll('traiteur_ids[]');
  const typeEvtIds = sp.getAll('type_evenement_ids[]');
  const tailleEvts = sp.getAll('taille_evenements[]');
  const typeCollecte = sp.get('type_collecte');
  const statutFiltres = sp.getAll('statut_consolide[]');

  // Périmètre lieux du gestionnaire (défense en profondeur — la RLS
  // evt_gestionnaire_select scope déjà sur organisations_lieux).
  const { data: orgLieux } = await supabase
    .from('organisations_lieux')
    .select('lieu_id');
  const perimetreLieuIds = (orgLieux ?? []).map((r) => r.lieu_id as string);
  const lieuFilter =
    lieuIds.length > 0
      ? lieuIds.filter((id) => perimetreLieuIds.includes(id))
      : perimetreLieuIds;

  if (lieuFilter.length === 0) {
    const csv = await evenementsToCsv(supabase, []);
    return csvResponse(csvFilename('evenements', new Date()), csv);
  }

  let q = supabase
    .from('evenements')
    .select(EVENEMENTS_SELECT)
    .in('lieu_id', lieuFilter)
    .order('date_evenement', { ascending: false });

  if (from) q = q.gte('date_evenement', from);
  if (to) q = q.lte('date_evenement', to);
  // Filtres serveur (§06.05 l.283-285) — respecte les filtres actifs (l.338).
  if (traiteurIds.length > 0)
    q = q.in('traiteur_operationnel_organisation_id', traiteurIds);
  if (typeEvtIds.length > 0) q = q.in('type_evenement_id', typeEvtIds);

  const { data: evts, error } = await q;
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  // Filtres post-fetch (identiques à la liste) : Taille (pax), Type de collecte,
  // Statut consolidé — l'export « respecte les filtres actifs » (§06.05 l.338).
  const filtered = (evts ?? []).filter((e) => {
    const pax = ((e as { pax?: number }).pax as number) ?? 0;
    if (tailleEvts.length > 0 && !tailleEvts.includes(exportTaille(pax)))
      return false;
    const cs = (
      Array.isArray((e as { collectes?: unknown }).collectes)
        ? (e as { collectes: { type: string; statut: string }[] }).collectes
        : []
    ) as { type: string; statut: string }[];
    const hasZd = cs.some((c) => c.type === 'zero_dechet');
    const hasAg = cs.some((c) => c.type === 'anti_gaspi');
    if (typeCollecte === 'avec_zd' && !hasZd) return false;
    if (typeCollecte === 'avec_ag' && !hasAg) return false;
    if (typeCollecte === 'zd_et_ag' && !(hasZd && hasAg)) return false;
    if (
      statutFiltres.length > 0 &&
      !statutFiltres.includes(exportStatutConsolide(cs))
    )
      return false;
    return true;
  });

  const csv = await evenementsToCsv(
    supabase,
    filtered as Record<string, unknown>[],
  );
  return csvResponse(csvFilename('evenements', new Date()), csv);
}

function exportTaille(pax: number): string {
  if (pax < 250) return 'XS';
  if (pax < 500) return 'S';
  if (pax < 750) return 'M';
  if (pax < 1000) return 'L';
  return 'XL';
}

function exportStatutConsolide(collectes: { statut: string }[]): string {
  if (collectes.length === 0) return 'En cours';
  if (collectes.every((c) => c.statut === 'annulee')) return 'Annulé';
  const terminaux = new Set(['realisee', 'cloturee', 'annulee']);
  const tousTerminaux = collectes.every((c) => terminaux.has(c.statut));
  const auMoinsUnRealise = collectes.some(
    (c) => c.statut === 'realisee' || c.statut === 'cloturee',
  );
  if (tousTerminaux && auMoinsUnRealise) return 'Terminé';
  return 'En cours';
}
