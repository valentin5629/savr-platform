import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { jourParis } from '@savr/shared/src/temps/index.js';
import { serverError } from '@/lib/api-helpers.js';
import { estUuid } from '@/lib/filtre-csv.js';
import { estLieuDuParc } from '@/lib/lieux/parc.js';
import {
  CODE_ALERTE_LIEU_MODIFICATION,
  ENTITE_ALERTE_LIEU,
} from '@/lib/lieux/demande-modification.js';

const ROLES: ClientRole[] = ['gestionnaire_lieux'];

// Lecture des collectes du lieu par tranches, jusqu'à une tranche vide :
// PostgREST plafonne une réponse (`max_rows` du projet), et rien ne doit être
// tronqué en silence quel que soit ce plafond (même patron que
// lib/registre/registre.ts).
const TRANCHE = 1000;

interface CollecteDuLieu {
  id: string;
  type: string;
  statut: string;
  date_collecte: string | null;
  taux_recyclage: number | null;
  evenements: unknown;
  collecte_flux: { poids_reel_kg?: number | null }[] | null;
}

function traiteurDe(c: CollecteDuLieu): { id: string; nom: string } | null {
  const evt = Array.isArray(c.evenements) ? c.evenements[0] : c.evenements;
  return (
    (evt as { organisations?: { id: string; nom: string } | null } | null)
      ?.organisations ?? null
  );
}

function poidsDe(c: CollecteDuLieu): number {
  return (c.collecte_flux ?? []).reduce(
    (s, f) => s + (f.poids_reel_kg ?? 0),
    0,
  );
}

// GET /api/v1/gestionnaire/lieux/[id]
// Fiche lieu du gestionnaire (§06.05 §3, pop-up sur la liste Lieux) :
//   - informations via v_lieux_clients (masque commentaire_lieu, siren,
//     email_gestionnaire, reference_citeo, commentaires_internes) ;
//   - `traiteurs` : traiteurs opérant sur le lieu, calculés à la lecture depuis
//     ses collectes (traiteur opérationnel de l'événement, tous statuts, sans
//     limite de date — même règle de COMPTAGE que la fiche lieu Admin, §04
//     note sous la table `lieux` ; le périmètre, lui, est celui que la RLS
//     rend à la session, là où l'Admin lit tout), avec leur nombre de
//     collectes et leur tonnage ZD. Le
//     tonnage ne somme que les collectes clôturées, comme le « Tonnage ZD »
//     de la liste Lieux et l'onglet Activité (pesées validées) ;
//   - `collectes` : collectes clôturées des 12 derniers mois (onglet Activité) ;
//   - `demande_modification_possible` : le lieu est dans le PARC de
//     l'organisation (`organisations_lieux`) — seul cas où la fiche propose le
//     bouton de demande ; un lieu simplement lisible (programmation passée sur
//     un lieu détaché depuis) reste en consultation ;
//   - `demande_modification_en_cours` : une demande de modification attend
//     l'équipe Savr (le bouton de la fiche est alors neutralisé). Toujours
//     `false` hors parc. Un lieu n'ayant qu'un gestionnaire rattaché (règle
//     tenue par la route Admin des lieux, pas par une contrainte de base),
//     cet état ne se lit pas d'une organisation à l'autre.
// Toutes les collectes sont lues avec la session de l'utilisateur : la RLS de
// `collectes` et de `evenements` borne ce qu'il lit.
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
    return NextResponse.json({ error: 'Lieu non trouvé' }, { status: 404 });
  const supabase = createSupabaseServerClient();

  const { data: lieu, error } = await supabase
    .from('v_lieux_clients')
    .select(
      `id, nom, nom_alternatif, adresse_acces, code_postal, ville, region,
       latitude, longitude, type_vehicule_max, capacite_maximum, acces_office,
       stationnement, acces_details, contraintes_horaires, flux_autorises,
       volume_max_bacs, controle_acces_requis_default, photos_urls, actif`,
    )
    .eq('id', id)
    .maybeSingle();

  if (error) return serverError(error, 'gestionnaire.lieux.get');
  if (!lieu)
    return NextResponse.json({ error: 'Lieu non trouvé' }, { status: 404 });

  const parc = await estLieuDuParc(supabase, auth.ctx.organisationId, id);
  if (!parc.ok) return serverError(parc.error, 'gestionnaire.lieux.get.parc');

  const toutes: CollecteDuLieu[] = [];
  for (let debut = 0; ; ) {
    const { data: page, error: collectesErr } = await supabase
      .from('collectes')
      .select(
        `id, type, statut, date_collecte, taux_recyclage,
         evenements!inner(lieu_id, traiteur_operationnel_organisation_id,
           organisations:v_traiteurs_gestionnaire!traiteur_operationnel_organisation_id(id, nom)),
         collecte_flux(poids_reel_kg)`,
      )
      .eq('evenements.lieu_id', id)
      .order('date_collecte', { ascending: false })
      .order('id')
      .range(debut, debut + TRANCHE - 1);
    if (collectesErr)
      return serverError(collectesErr, 'gestionnaire.lieux.get.collectes');
    const lignes = (page ?? []) as unknown as CollecteDuLieu[];
    if (lignes.length === 0) break;
    toutes.push(...lignes);
    debut += lignes.length;
  }

  const parTraiteur = new Map<
    string,
    { nom: string; nb_collectes: number; tonnage_kg: number }
  >();
  for (const c of toutes) {
    const traiteur = traiteurDe(c);
    if (!traiteur) continue;
    const cur = parTraiteur.get(traiteur.id) ?? {
      nom: traiteur.nom,
      nb_collectes: 0,
      tonnage_kg: 0,
    };
    cur.nb_collectes += 1;
    if (c.statut === 'cloturee') cur.tonnage_kg += poidsDe(c);
    parTraiteur.set(traiteur.id, cur);
  }
  const traiteurs = [...parTraiteur.entries()]
    .map(([traiteurId, v]) => ({ id: traiteurId, ...v }))
    .sort(
      (a, b) =>
        b.nb_collectes - a.nb_collectes || a.nom.localeCompare(b.nom, 'fr'),
    );

  // Onglet Activité : collectes clôturées des 12 derniers mois (ordre de
  // lecture conservé : plus récentes d'abord).
  const since12m = new Date();
  since12m.setMonth(since12m.getMonth() - 12);
  const sinceStr = jourParis(since12m);
  const collectes = toutes.filter(
    (c) =>
      c.statut === 'cloturee' &&
      c.date_collecte != null &&
      c.date_collecte >= sinceStr,
  );

  // `alertes_admin` est fermée aux rôles clients : lecture service-role, pour
  // un lieu du parc seulement (vérifié ci-dessus sous la session). Seule
  // l'existence d'une demande ouverte est renvoyée, jamais son contenu.
  let demandeEnCours = false;
  if (parc.duParc) {
    const { data: demande, error: demandeErr } =
      await createAdminSupabaseClient()
        .from('alertes_admin')
        .select('id')
        .eq('code', CODE_ALERTE_LIEU_MODIFICATION)
        .eq('entity_type', ENTITE_ALERTE_LIEU)
        .eq('entity_id', id)
        .eq('statut', 'ouverte')
        .limit(1)
        .maybeSingle();
    if (demandeErr)
      return serverError(demandeErr, 'gestionnaire.lieux.get.demande');
    demandeEnCours = Boolean(demande);
  }

  return NextResponse.json({
    data: {
      ...lieu,
      collectes,
      traiteurs,
      demande_modification_possible: parc.duParc,
      demande_modification_en_cours: demandeEnCours,
    },
  });
}
