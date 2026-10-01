import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { serverError } from '@/lib/api-helpers.js';
import {
  enrichirLignesCollectes,
  lireFiltresListeCollectes,
} from '@/lib/collectes/liste-collectes-client.js';
import { inTextes } from '@/lib/filtre-csv.js';

const TRAITEUR_ROLES: ClientRole[] = [
  'traiteur_manager',
  'traiteur_commercial',
];

// GET /api/v1/traiteur/collectes — liste des collectes de l'orga (§06.04 §3).
// La RLS (col_select) garantit le cloisonnement : toutes les collectes de l'orga
// (lecture alignée manager pour le commercial — révision 2026-05-29) + collectes
// où le traiteur est opérationnel. Tri date décroissante.
//
// Filtres §06.04 §3 « Filtres disponibles » (BL-P2-14, volet filtres) :
//   type (sélecteur ZD/AG) · statut (multi) · période (from/to) · lieu_ids
//   (multi) · client (multi, noms du client organisateur) · info_incomplete
//   (oui|non) · programmee_par (multi, organisations programmatrices) — lus
//   par lireFiltresListeCollectes, commun à la liste agence et à l'export CSV.
// S'y ajoutent les paramètres de DRILL-DOWN depuis les Top listes du dashboard
// (commercial_id, association_id, perimetre), qui ne sont pas des filtres d'UI.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, TRAITEUR_ROLES);
  if (auth.error) return auth.error;

  const supabase = createSupabaseServerClient();
  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type'); // 'zero_dechet' | 'anti_gaspi'
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const filtres = lireFiltresListeCollectes(searchParams);
  // Drill-down « Top 5 commerciaux » du dashboard → filtre sur le commercial
  // créateur (evenements.created_by). Reste scopé org par la RLS col_select.
  const commercialId = searchParams.get('commercial_id');
  // Miroir exact du dashboard : `perimetre=organisation` restreint aux événements
  // POSSÉDÉS par l'org (evenements.organisation_id) — comme le calcul des Top
  // listes — au lieu du périmètre RLS plus large (org + opéré pour tiers).
  const perimetre = searchParams.get('perimetre');
  // Drill-down « Top associations bénéficiaires » (AG) → collectes attribuées à
  // cette association (attributions_antgaspi.association_id, collecte_id UNIQUE).
  const associationId = searchParams.get('association_id');

  // Typé `string` (pas template-literal) → overload générique supabase, sinon le
  // parser de types échoue sur la concaténation conditionnelle de l'embed.
  // Résultats collecte réalisée (affichés sur la carte à `cloturee`) : CO₂ évité
  // (colonne collectes, ZD+AG), poids ZD (Σ collecte_flux) et repas AG
  // (Σ attributions_antgaspi.volume_repas_realise) — mêmes sources que la fiche
  // et les dashboards, agrégées ci-dessous par ligne.
  const selectBase: string = `id, type, statut, statut_tms, date_collecte, heure_collecte,
       informations_completes, taux_recyclage, co2_evite_kg, realisee_at,
       collecte_flux(poids_reel_kg),
       evenements!inner(
         id, organisation_id, traiteur_operationnel_organisation_id, created_by,
         nom_evenement, pax, nom_client_organisateur,
         lieux!lieu_id(id, nom, adresse_acces, code_postal, ville)
       )`;
  // Embed inner sur attributions_antgaspi UNIQUEMENT si on filtre par association
  // (sinon l'inner join exclurait les collectes ZD, dépourvues d'attribution) ;
  // sinon embed left pour récupérer les repas donnés (AG réalisée).
  const select = associationId
    ? `${selectBase}, attributions_antgaspi!inner(association_id, volume_repas_realise)`
    : `${selectBase}, attributions_antgaspi(volume_repas_realise)`;

  let query = supabase
    .from('collectes')
    .select(select)
    .order('date_collecte', { ascending: false });

  if (type === 'zero_dechet' || type === 'anti_gaspi') {
    query = query.eq('type', type);
  }
  if (filtres.statuts.length > 0) query = query.in('statut', filtres.statuts);
  if (from) query = query.gte('date_collecte', from);
  if (to) query = query.lte('date_collecte', to);
  if (filtres.lieuIds.length > 0)
    query = query.in('evenements.lieu_id', filtres.lieuIds);
  if (commercialId) query = query.eq('evenements.created_by', commercialId);
  if (perimetre === 'organisation')
    query = query.eq('evenements.organisation_id', auth.ctx.organisationId);
  if (associationId)
    query = query.eq('attributions_antgaspi.association_id', associationId);
  // « Client Organisateur » : keyé sur le NOM (evenements.nom_client_organisateur),
  // obligatoire à la confirmation d'une programmation, et non sur
  // client_organisateur_organisation_id qui est un rattachement réservé Admin
  // (NULL sur les événements programmés par un traiteur) — cf. route /filtres.
  if (filtres.clients.length > 0)
    query = query.filter(
      'evenements.nom_client_organisateur',
      'in',
      inTextes(filtres.clients),
    );
  if (filtres.informationsCompletes !== null)
    query = query.eq('informations_completes', filtres.informationsCompletes);
  // « Programmée par » : organisations ayant programmé l'événement.
  if (filtres.programmeePar.length > 0)
    query = query.in('evenements.organisation_id', filtres.programmeePar);

  const { data, error } = await query;
  if (error) return serverError(error, 'traiteur.collectes.list');

  // Champs calculés (programmée par tiers, rapport réservé, résultats) : calcul
  // commun avec la liste agence (§06.11 = §06.04 à l'identique).
  const rows = enrichirLignesCollectes(data, auth.ctx.organisationId);

  return NextResponse.json({ data: rows });
}
