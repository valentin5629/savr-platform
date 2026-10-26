import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@savr/shared/src/logger/index.js';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { serverError } from '@/lib/api-helpers.js';
import { tailleBracket } from '@/lib/dashboard-kpi.js';
import {
  adresseLieu,
  consoliderEvenement,
  un,
  type CollecteAConsolider,
  type UnOuListe,
} from '@/lib/evenements-gestionnaire.js';
import { estUuid } from '@/lib/filtre-csv.js';
import { typesEvenementDesCollectes } from '@/lib/collectes/types-evenement-collectes.js';
import { chargerFicheCollecteClient } from '@/lib/collectes/fiche-client.js';
import type { FicheCollecteClient } from '@/lib/collectes/fiche-client-types.js';

const ROLES: ClientRole[] = ['gestionnaire_lieux'];

type CollecteBrute = CollecteAConsolider & {
  id: string;
  heure_collecte: string | null;
  created_at: string | null;
  type_evenement: UnOuListe<{ libelle: string | null }>;
};

type EvenementBrut = {
  id: string;
  organisation_id: string;
  nom_evenement: string | null;
  date_evenement: string | null;
  pax: number | null;
  nom_client_organisateur: string | null;
  lieux: UnOuListe<{
    nom: string | null;
    adresse_acces: string | null;
    code_postal: string | null;
    ville: string | null;
    acces_details: string | null;
  }>;
  organisations: UnOuListe<{
    id: string;
    nom: string | null;
    logo_url: string | null;
  }>;
  types_evenements: UnOuListe<{ libelle: string | null }>;
  collectes: CollecteBrute[] | null;
};

const NON_TROUVE = () =>
  NextResponse.json({ error: 'Événement non trouvé' }, { status: 404 });

// GET /api/v1/gestionnaire/evenements/[id]
// Fiche événement du gestionnaire, en lecture seule (§06.05 §2 « Détail
// événement », remise par Val le 2026-10-18) : en-tête de l'événement, bilan
// CONSOLIDÉ sur ses collectes (lib/evenements-gestionnaire) et, pour chaque
// collecte, sa fiche telle que la sert la route de la fiche collecte (contacts,
// chauffeurs, état des rapports — onglets de la fiche événement, décision Val
// 2026-10-26). Même chargeur, donc mêmes règles de visibilité : contacts d'une
// collecte de traiteur tiers masqués, référence interne réservée à
// l'organisation qui a programmé.
//
// Périmètre = RLS de la session (evenements puis collectes), comme la liste.
// Un événement hors périmètre, un brouillon ou un identifiant mal formé → 404,
// sans distinguer « n'existe pas » de « pas à vous ». Brouillon = événement dont
// les collectes sont toutes des brouillons, même filtre que la liste (un
// brouillon a une date : la date seule ne l'écarte pas).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUser(req, ROLES);
  if (auth.error) return auth.error;

  const { id } = await params;
  if (!estUuid(id)) return NON_TROUVE();

  const supabase = createSupabaseServerClient();
  // Le traiteur passe par la vue restreinte v_traiteurs_gestionnaire (id, nom,
  // logo) comme sur les autres écrans du rôle ; son logo est une clé R2, servie
  // par le proxy …/traiteurs/[id]/logo — elle ne sort pas de la route.
  const { data, error } = await supabase
    .from('evenements')
    .select(
      `id, organisation_id, nom_evenement, date_evenement, pax,
       nom_client_organisateur,
       lieux!lieu_id(nom, adresse_acces, code_postal, ville, acces_details),
       organisations:v_traiteurs_gestionnaire!traiteur_operationnel_organisation_id(id, nom, logo_url),
       types_evenements!type_evenement_id(libelle),
       collectes(id, type, statut, date_collecte, heure_collecte, created_at,
         taux_recyclage, co2_evite_kg,
         type_evenement:types_evenements!type_evenement_id(libelle),
         collecte_flux(poids_reel_kg, flux_dechets!flux_id(code)),
         attributions_antgaspi:v_attributions_gestionnaire(
           volume_repas_realise, association_id, association_nom,
           association_ville)),
       hors_brouillon:collectes(id)`,
    )
    .eq('id', id)
    .not('date_evenement', 'is', null)
    .neq('hors_brouillon.statut', 'brouillon')
    .or('hors_brouillon.not.is.null,collectes.is.null')
    .maybeSingle();

  if (error) return serverError(error, 'gestionnaire.evenements.get');
  if (!data) return NON_TROUVE();

  const evt = data as unknown as EvenementBrut;
  const collectes = [...(evt.collectes ?? [])].sort(
    (a, b) =>
      (a.date_collecte ?? '').localeCompare(b.date_collecte ?? '') ||
      (a.heure_collecte ?? '').localeCompare(b.heure_collecte ?? '') ||
      a.id.localeCompare(b.id),
  );
  const bilan = consoliderEvenement(collectes);

  // Déchets labo estimés : seulement si l'événement a au moins une collecte ZD
  // (arbitrage Val 2026-10-07). Fonction SECURITY DEFINER : seuls les kg sortent.
  let dechetsLaboKg: number | null = null;
  if (bilan.nb_collectes_zd > 0) {
    const { data: kg, error: echec } = await supabase.rpc(
      'f_dechets_labo_estimes',
      { p_evenement_id: id },
    );
    if (echec)
      logger.warn('gestionnaire.evenements.dechets_labo_echec', {
        evenement_id: id,
        code: echec.code,
      });
    else dechetsLaboKg = kg as number | null;
  }

  // Une fiche par collecte, sous la même session : rien de plus que ce que la
  // fiche collecte lui servirait.
  const resultats = await Promise.all(
    collectes.map((c) =>
      chargerFicheCollecteClient(c.id, auth.ctx, 'gestionnaire'),
    ),
  );
  const fiches: FicheCollecteClient[] = [];
  for (const r of resultats) {
    if ('erreur' in r)
      return serverError(r.erreur, 'gestionnaire.evenements.get.fiches');
    if ('fiche' in r) fiches.push(r.fiche);
  }

  const traiteur = un(evt.organisations);
  const lieu = un(evt.lieux);

  return NextResponse.json({
    data: {
      id: evt.id,
      nom_evenement: evt.nom_evenement,
      date_evenement: evt.date_evenement,
      pax: evt.pax,
      taille_bracket: tailleBracket(evt.pax ?? 0),
      // Types de SES COLLECTES, dans l'ordre de la collecte n°1 (décision Val
      // 2026-10-24, lot C1, Q2) ; la copie de l'événement n'est qu'un repli.
      type_evenement: typesEvenementDesCollectes(
        collectes,
        un(evt.types_evenements)?.libelle ?? null,
      ),
      // « Client Organisateur si renseigné par le traiteur » (§06.05 §2).
      client_nom: evt.nom_client_organisateur?.trim() || null,
      lieu_nom: lieu?.nom ?? null,
      lieu_adresse: adresseLieu(lieu),
      traiteur: traiteur
        ? { id: traiteur.id, nom: traiteur.nom, a_logo: !!traiteur.logo_url }
        : null,
      dechets_labo_kg: dechetsLaboKg,
      // « Ajouter une collecte » : sur ses propres programmations seulement —
      // la route d'ajout répond 404 sur l'événement d'un traiteur tiers tenu
      // sur ses lieux.
      ajouter_collecte: evt.organisation_id === auth.ctx.organisationId,
      bilan,
      // Instructions d'accès du lieu de référence (les précisions propres à
      // une collecte sont sur sa fiche).
      lieu_acces_details: lieu?.acces_details?.trim() || null,
      fiches,
    },
  });
}
