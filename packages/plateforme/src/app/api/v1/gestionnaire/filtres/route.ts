import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';

const ROLES: ClientRole[] = ['gestionnaire_lieux'];

// GET /api/v1/gestionnaire/filtres
// Options des filtres globaux du dashboard + de la liste Événements (§06.05 §1 l.99-107) :
//  - Lieux    : lieux rattachés à l'organisation (organisations_lieux)
//  - Traiteurs: traiteurs intervenus sur ≥ 1 collecte sur ces lieux (24 derniers mois)
//  - Types    : référentiel types_evenements (actif)
// Portée « parc de l'organisation » — distinct des listes « parc Savr » de l'encart
// benchmark (/api/v1/dashboards/benchmark/filtres).
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;
  void auth;

  const supabase = createSupabaseServerClient();

  const { data: orgLieux } = await supabase
    .from('organisations_lieux')
    .select('lieu_id');
  const lieuIds = (orgLieux ?? []).map((r) => r.lieu_id as string);

  if (lieuIds.length === 0) {
    return NextResponse.json({
      data: { lieux: [], traiteurs: [], types: [] },
    });
  }

  // Lieux du périmètre (v_lieux_clients = whitelist, masque les champs sensibles).
  const { data: lieuxRows } = await supabase
    .from('v_lieux_clients')
    .select('id, nom')
    .in('id', lieuIds)
    .order('nom', { ascending: true });

  // Traiteurs intervenus (fenêtre 24 mois, cohérente avec la liste Traiteurs §06.05 §5).
  const since24m = new Date();
  since24m.setMonth(since24m.getMonth() - 24);
  const since24mStr = since24m.toISOString().slice(0, 10);

  const { data: collectes } = await supabase
    .from('collectes')
    .select(
      `id,
       evenements!inner(lieu_id, traiteur_operationnel_organisation_id,
         organisations!traiteur_operationnel_organisation_id(id, nom))`,
    )
    .in('evenements.lieu_id', lieuIds)
    .gte('date_collecte', since24mStr);

  const traiteurMap = new Map<string, string>();
  for (const c of collectes ?? []) {
    const evt = Array.isArray(c.evenements) ? c.evenements[0] : c.evenements;
    const orgs = (
      evt as unknown as { organisations?: { id: string; nom: string } }
    )?.organisations;
    if (orgs?.id) traiteurMap.set(orgs.id, orgs.nom);
  }
  const traiteurs = [...traiteurMap.entries()]
    .map(([id, nom]) => ({ id, nom }))
    .sort((a, b) => a.nom.localeCompare(b.nom));

  // Types d'événement (référentiel).
  const { data: types } = await supabase
    .from('types_evenements')
    .select('id, libelle')
    .eq('actif', true)
    .order('ordre_affichage', { ascending: true });

  return NextResponse.json({
    data: {
      lieux: (lieuxRows ?? []).map((l) => ({
        id: l.id as string,
        nom: l.nom as string,
      })),
      traiteurs,
      types: (types ?? []).map((t) => ({
        id: t.id as string,
        libelle: t.libelle as string,
      })),
    },
  });
}
