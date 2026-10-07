import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { jourParis } from '@savr/shared/src/temps/index.js';
import { decalerMois } from '@/lib/periodes-raccourcis';
import { serverError } from '@/lib/api-helpers.js';
import { estUuid } from '@/lib/filtre-csv.js';

const ROLES: ClientRole[] = ['gestionnaire_lieux'];

// Lecture des collectes par tranches, jusqu'à une tranche vide : PostgREST
// plafonne une réponse (`max_rows` du projet), et un nombre de collectes ne
// doit jamais être tronqué en silence (même patron que la fiche lieu).
const TRANCHE = 1000;

interface CollecteDuTraiteur {
  id: string;
  evenements: unknown;
}

function lieuDe(c: CollecteDuTraiteur): { id: string; nom: string } | null {
  const evt = (
    Array.isArray(c.evenements) ? c.evenements[0] : c.evenements
  ) as {
    lieu_id?: string | null;
    lieux?: { nom?: string | null } | { nom?: string | null }[] | null;
  } | null;
  if (!evt?.lieu_id) return null;
  const lieu = Array.isArray(evt.lieux) ? evt.lieux[0] : evt.lieux;
  return { id: evt.lieu_id, nom: lieu?.nom ?? evt.lieu_id };
}

// GET /api/v1/gestionnaire/traiteurs/[id]
// Fiche traiteur du gestionnaire (§06.05 §5, pop-up sur la liste Traiteurs —
// arbitrage Val 2026-10-07) :
//   - identité non commerciale : nom + logo, par la vue restreinte
//     v_traiteurs_gestionnaire. Champs exclus : email, téléphone, SIRET,
//     adresse, notes internes, tarifs. La « ville » de §06.05 n'a pas de
//     colonne dans organisations → non affichée (décision Val 2026-09-18) ;
//   - `lieux_intervention` : lieux du parc de l'organisation où ce traiteur a
//     eu au moins une collecte clôturée sur les 24 derniers mois, avec le
//     nombre de ces collectes — même règle (statut, fenêtre, périmètre) que la
//     colonne « Lieux d'intervention » de la liste Traiteurs, triés par nombre
//     de collectes puis par nom.
// L'onglet Activité de la fiche ne lit pas cette route : il affiche les cartes
// KPI et le graphique du dashboard (/api/v1/gestionnaire/dashboard et
// /api/v1/dashboards/evolution) filtrés sur le traiteur.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;

  const { id } = await params;
  // Un identifiant mal formé (lien saisi à la main) ne doit pas atteindre
  // PostgREST, qui répondrait par une erreur de type et non par une absence.
  if (!estUuid(id))
    return NextResponse.json({ error: 'Traiteur non trouvé' }, { status: 404 });
  const supabase = createSupabaseServerClient();

  // Périmètre lieux de l'organisation
  const { data: orgLieux, error: lieuxErr } = await supabase
    .from('organisations_lieux')
    .select('lieu_id');
  if (lieuxErr) return serverError(lieuxErr, 'gestionnaire.traiteurs.get');
  const lieuIds = (orgLieux ?? []).map((r) => r.lieu_id as string);
  if (lieuIds.length === 0)
    return NextResponse.json({ error: 'Traiteur non trouvé' }, { status: 404 });

  // Infos non-commerciales du traiteur — vue restreinte id/nom/logo_url : la table
  // organisations n'ouvre plus les traiteurs tiers au gestionnaire (20260921090000).
  const { data: orga, error: orgaErr } = await supabase
    .from('v_traiteurs_gestionnaire')
    .select('id, nom, logo_url')
    .eq('id', id)
    .maybeSingle();
  if (orgaErr) return serverError(orgaErr, 'gestionnaire.traiteurs.get');
  if (!orga)
    return NextResponse.json({ error: 'Traiteur non trouvé' }, { status: 404 });

  // 24 derniers mois en jours parisiens, comme la liste Traiteurs.
  const depuis = decalerMois(jourParis(new Date()), -24);

  const parLieu = new Map<string, { nom: string; nb_collectes: number }>();
  for (let debut = 0; ; ) {
    const { data: page, error: collectesErr } = await supabase
      .from('collectes')
      .select(
        `id,
         evenements!inner(lieu_id, traiteur_operationnel_organisation_id,
           lieux!lieu_id(nom))`,
      )
      .eq('statut', 'cloturee')
      .eq('evenements.traiteur_operationnel_organisation_id', id)
      .in('evenements.lieu_id', lieuIds)
      .gte('date_collecte', depuis)
      .order('id')
      .range(debut, debut + TRANCHE - 1);
    if (collectesErr)
      return serverError(collectesErr, 'gestionnaire.traiteurs.get.collectes');
    const lignes = (page ?? []) as unknown as CollecteDuTraiteur[];
    if (lignes.length === 0) break;
    for (const c of lignes) {
      const lieu = lieuDe(c);
      if (!lieu) continue;
      const cur = parLieu.get(lieu.id) ?? { nom: lieu.nom, nb_collectes: 0 };
      cur.nb_collectes += 1;
      parLieu.set(lieu.id, cur);
    }
    debut += lignes.length;
  }

  const lieuxIntervention = [...parLieu.entries()]
    .map(([lieuId, v]) => ({ id: lieuId, ...v }))
    .sort(
      (a, b) =>
        b.nb_collectes - a.nb_collectes || a.nom.localeCompare(b.nom, 'fr'),
    );

  return NextResponse.json({
    data: {
      id: orga.id,
      nom: orga.nom,
      logo_url: orga.logo_url ?? null,
      lieux_intervention: lieuxIntervention,
    },
  });
}
