import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { applyLieuOverrides } from '@savr/adapters/src/lieu-overrides.js';
import {
  createSupabaseServerClient,
  type UserAuthContext,
} from '@/lib/api-auth.js';
import { tailleBracket } from '@/lib/dashboard-kpi.js';
import {
  CODE_ALERTE_COORDONNEES_URGENCE,
  STATUTS_ASSOCIATION,
  STATUTS_LOGISTIQUE,
  STATUT_BILAN,
  etatRapport,
  rapportReserveDonneurOrdre,
  type ActionsFiche,
  type AssociationFiche,
  type EspaceClient,
  type EvenementFiche,
  type FicheCollecteClient,
  type TourneeFiche,
} from './fiche-client-types.js';

// Chargeur UNIQUE de la fiche collecte des rôles clients (pop-up commun, §06.04
// « Fiche collecte (vue détail) », refonte Val 2026-09-29). Les trois routes GET
// /api/v1/{traiteur,agence,gestionnaire}/collectes/[id] l'appellent puis
// ajoutent leurs seuls compléments de rôle.
//
// Frontière de sécurité, dans cet ordre :
//  1. la collecte est lue avec le client de l'UTILISATEUR (RLS) : invisible ⇒
//     null, et aucune lecture service-role ne part ;
//  2. les lectures service-role qui suivent (camions, demande urgente) sont
//     bornées à CETTE collecte ; les documents sont lus sous la RLS de
//     l'utilisateur, pour les trois espaces ;
//  3. rien de confidentiel ne sort : ni notes internes (Admin), ni nom du
//     prestataire logistique (marque blanche), ni téléphone du chauffeur hors
//     de la fenêtre programmee/validee/en_cours ;
//  4. gestionnaire : l'attribution AG (repas, association) est lue par la vue
//     v_attributions_gestionnaire (§04) — aa_select n'est jamais élargie, la
//     vue ne rend que les collectes de SES lieux et 5 colonnes ;
//  5. contacts sur place et référence d'affaire : colonnes d'`evenements` hors
//     GRANT SELECT authenticated (migration 20261001103000), lues en
//     service-role sur CET événement et seulement pour qui y a titre —
//     contacts : traiteur et agence, gestionnaire sur ses seules programmations
//     (§06.05 : rien de personnel sur un traiteur tiers) ; référence d'affaire :
//     organisation programmatrice seule (arbitrages Val C2/C3 2026-10-01).

const STATUTS_EDITABLES = ['programmee', 'validee'];

const COLONNES_CONTACTS =
  'contact_principal_nom, contact_principal_telephone, contact_secours_nom, contact_secours_telephone';

interface EvenementReserve {
  contact_principal_nom: string | null;
  contact_principal_telephone: string | null;
  contact_secours_nom: string | null;
  contact_secours_telephone: string | null;
  reference_affaire?: string | null;
}

function one<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

interface EvenementRow {
  id: string;
  organisation_id: string;
  traiteur_operationnel_organisation_id: string | null;
  created_by: string | null;
  nom_evenement: string | null;
  pax: number | null;
  type_evenement_id: string | null;
  nom_client_organisateur: string | null;
  type_evenement:
    | { libelle: string | null }
    | { libelle: string | null }[]
    | null;
  lieu:
    | {
        id: string;
        nom: string;
        adresse_acces: string | null;
        code_postal: string | null;
        ville: string | null;
        acces_details: string | null;
      }
    | {
        id: string;
        nom: string;
        adresse_acces: string | null;
        code_postal: string | null;
        ville: string | null;
        acces_details: string | null;
      }[]
    | null;
}

interface CollecteRow {
  id: string;
  type: string;
  statut: string;
  statut_tms: string;
  tms_reference: string | null;
  date_collecte: string;
  heure_collecte: string | null;
  controle_acces_requis: boolean;
  informations_completes: boolean;
  informations_supplementaires: string | null;
  taux_recyclage: number | null;
  co2_net_kg: number | null;
  co2_evite_kg: number | null;
  realisee_at: string | null;
  aucun_repas_motif: string | null;
  lieu_overrides: Record<string, unknown> | null;
  evenement: EvenementRow | EvenementRow[] | null;
  collecte_flux?:
    | {
        poids_reel_kg: number | null;
        flux_dechets: { code: string } | { code: string }[] | null;
      }[]
    | null;
}

// Contexte serveur de la collecte, utile aux compléments de rôle (badge
// « Programmée par », traiteur opérationnel) — jamais sérialisé tel quel.
export interface ContexteFiche {
  organisationProgrammatriceId: string;
  traiteurOperationnelId: string | null;
}

export type ResultatFiche =
  | { fiche: FicheCollecteClient; contexte: ContexteFiche }
  | { introuvable: true }
  | { erreur: unknown };

/**
 * Droits affichés dans le pied de la fiche. Reprend EXACTEMENT les gardes des
 * routes d'écriture existantes (PATCH et annulation de chaque espace) : l'écran
 * grise ce que le serveur refuserait, il n'invente aucun droit.
 */
export function droitsFiche(
  espace: EspaceClient,
  ctx: Pick<UserAuthContext, 'role' | 'userId' | 'organisationId'>,
  statut: string,
  evt: { organisation_id: string; created_by: string | null },
): ActionsFiche {
  const statutModifiable = STATUTS_EDITABLES.includes(statut);
  const mode =
    statut === 'brouillon' || statut === 'programmee'
      ? 'directe'
      : statut === 'validee'
        ? 'demande'
        : null;

  let peutModifier: boolean;
  let peutAnnuler: boolean;
  if (espace === 'traiteur') {
    // Manager : collectes de son organisation ; commercial : ses créations.
    const autorise =
      ctx.role === 'traiteur_manager'
        ? evt.organisation_id === ctx.organisationId
        : evt.created_by === ctx.userId;
    peutModifier = autorise;
    peutAnnuler = autorise;
  } else if (espace === 'agence') {
    // Donneur d'ordre : la RLS borne déjà aux collectes qu'elle a programmées.
    peutModifier = true;
    peutAnnuler = true;
  } else {
    // Gestionnaire : modifie ses propres programmations, n'annule jamais
    // (§05 « la gestion des collectes reste exclusive au traiteur »).
    peutModifier = evt.organisation_id === ctx.organisationId;
    peutAnnuler = false;
  }

  return {
    modifier: !statutModifiable ? 'absent' : peutModifier ? 'actif' : 'grise',
    annuler:
      espace === 'gestionnaire' || mode === null
        ? 'absent'
        : peutAnnuler
          ? 'actif'
          : 'grise',
    annulation: espace === 'gestionnaire' ? null : mode,
  };
}

export async function chargerFicheCollecteClient(
  id: string,
  ctx: UserAuthContext,
  espace: EspaceClient,
): Promise<ResultatFiche> {
  const rls = createSupabaseServerClient();
  const { data, error } = await rls
    .from('collectes')
    .select(
      `id, type, statut, statut_tms, tms_reference, date_collecte, heure_collecte,
       controle_acces_requis, informations_completes, informations_supplementaires,
       taux_recyclage, co2_net_kg, co2_evite_kg, realisee_at, aucun_repas_motif,
       lieu_overrides,
       evenement:evenements!inner(
         id, organisation_id, traiteur_operationnel_organisation_id, created_by,
         nom_evenement, pax, type_evenement_id, nom_client_organisateur,
         type_evenement:types_evenements!type_evenement_id(libelle),
         lieu:lieux!lieu_id(id, nom, adresse_acces, code_postal, ville, acces_details)
       ),
       collecte_flux(poids_reel_kg, flux_dechets(code))`,
    )
    .eq('id', id)
    .maybeSingle();

  if (error) return { erreur: error };
  if (!data) return { introuvable: true };

  const c = data as unknown as CollecteRow;
  const evt = one(c.evenement);
  const isAg = c.type === 'anti_gaspi';
  const avecCamions = STATUTS_LOGISTIQUE.includes(c.statut);
  const avecAssociation = isAg && STATUTS_ASSOCIATION.includes(c.statut);
  // Frontière 5 : qui a titre aux colonnes réservées de l'événement.
  const programmeParSoi = evt?.organisation_id === ctx.organisationId;
  const contactsVisibles =
    Boolean(evt) && (espace !== 'gestionnaire' || programmeParSoi);

  const admin = createAdminSupabaseClient();
  // AG realisee_sans_collecte : pas d'attestation, le rapport est « Événement
  // sans excédent » (rapports_rse, sans embargo). ZD : rapports_rse. AG
  // cloturee : l'attestation de don.
  const useRapportsRse = !isAg || c.statut === 'realisee_sans_collecte';

  // Documents sous la RLS de l'utilisateur, pour les trois espaces (rr_select /
  // att_traiteur_select / att_gestionnaire_select), comme leurs routes de
  // téléchargement. Le traiteur opérationnel d'une collecte AG programmée par
  // une agence ne lit donc pas l'attestation de don du donneur d'ordre (D12,
  // arbitrage Val 2026-09-30) ; le rapport RSE ZD lui reste servi (rr_select).
  const [ctRes, rapRes, attRes, aaRes, alerteRes, evtRes] = await Promise.all([
    avecCamions
      ? admin
          .from('collecte_tournees')
          .select(
            'rang, tournee:tournees(plaque_immatriculation, chauffeur_nom, chauffeur_telephone, type_vehicule)',
          )
          .eq('collecte_id', id)
          .order('rang', { ascending: true })
      : Promise.resolve({ data: [] as unknown[], error: null }),
    useRapportsRse
      ? rls
          .from('rapports_rse')
          .select('disponible_a, genere_at, regenere_at')
          .eq('collecte_id', id)
          .order('version', { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    useRapportsRse
      ? Promise.resolve({ data: null, error: null })
      : rls
          .from('attestations_don')
          .select('eligible_at, pdf_url')
          .eq('collecte_id', id)
          .order('version', { ascending: false })
          .limit(1)
          .maybeSingle(),
    // Attribution AG sous la RLS de l'utilisateur. Traiteur et agence : la table
    // (aa_select). Gestionnaire : la vue v_attributions_gestionnaire, seul chemin
    // qui lui rende une collecte programmée par un traiteur tiers (C-1) — nom et
    // ville de l'association à plat, sa description par l'`association_id` de la
    // vue (associations, policy asso_read).
    avecAssociation
      ? espace === 'gestionnaire'
        ? rls
            .from('v_attributions_gestionnaire')
            .select(
              'volume_repas_realise, association_nom, association_ville, association:associations(description_rapport_impact)',
            )
            .eq('collecte_id', id)
            .maybeSingle()
        : rls
            .from('attributions_antgaspi')
            .select(
              'volume_repas_realise, association:associations!association_id(nom, ville, description_rapport_impact)',
            )
            .eq('collecte_id', id)
            .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    avecCamions
      ? admin
          .from('alertes_admin')
          .select('id')
          .eq('code', CODE_ALERTE_COORDONNEES_URGENCE)
          .eq('entity_id', id)
          .eq('statut', 'ouverte')
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    contactsVisibles && evt
      ? admin
          .from('evenements')
          .select(
            programmeParSoi
              ? `${COLONNES_CONTACTS}, reference_affaire`
              : COLONNES_CONTACTS,
          )
          .eq('id', evt.id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  // Un échec de cette lecture ne doit pas se lire comme « aucun contact ».
  if (evtRes.error) return { erreur: evtRes.error };
  const reserve = evtRes.data as EvenementReserve | null;

  // ── Camions (Logistique) ────────────────────────────────────────────────
  type TourneeRow = TourneeFiche;
  const tournees: TourneeFiche[] = (
    (ctRes.data ?? []) as Array<{ tournee: TourneeRow | TourneeRow[] | null }>
  )
    .map((r) => one(r.tournee))
    .filter((t): t is TourneeRow => Boolean(t))
    .map((t) => ({
      chauffeur_nom: t.chauffeur_nom,
      plaque_immatriculation: t.plaque_immatriculation,
      chauffeur_telephone: t.chauffeur_telephone,
      type_vehicule: t.type_vehicule,
    }));

  // ── Documents ───────────────────────────────────────────────────────────
  const rap = rapRes.data as {
    disponible_a: string | null;
    genere_at: string | null;
    regenere_at: string | null;
  } | null;
  const att = attRes.data as {
    eligible_at: string | null;
    pdf_url: string | null;
  } | null;
  const maintenant = Date.now();
  const rapport_rse_disponible = useRapportsRse
    ? Boolean(rap?.genere_at) &&
      rap?.disponible_a != null &&
      new Date(rap.disponible_a).getTime() <= maintenant
    : Boolean(att?.pdf_url) &&
      att?.eligible_at != null &&
      new Date(att.eligible_at).getTime() <= maintenant;
  const rapport_rse_regenere = useRapportsRse && Boolean(rap?.regenere_at);
  const rapport_reserve_donneur_ordre =
    espace === 'traiteur' &&
    rapportReserveDonneurOrdre(c, evt?.organisation_id, ctx.organisationId);

  // ── Bilan ───────────────────────────────────────────────────────────────
  // ZD « Réalisée » : pesées par flux (collecte_flux, lue sous RLS avec la
  // collecte). Valeurs figées à la clôture, jamais recalculées ici.
  let bilan_flux: Record<string, number> | null = null;
  if (!isAg && c.statut === STATUT_BILAN) {
    bilan_flux = {};
    for (const cf of c.collecte_flux ?? []) {
      const code = one(cf.flux_dechets)?.code;
      if (!code || cf.poids_reel_kg == null) continue;
      bilan_flux[code] = (bilan_flux[code] ?? 0) + Number(cf.poids_reel_kg);
    }
  }

  // Deux formes selon le chemin de lecture : la table embarque l'association
  // entière, la vue du gestionnaire porte nom et ville À PLAT.
  interface AssoEmbed {
    nom?: string;
    ville?: string | null;
    description_rapport_impact: string | null;
  }
  const aa = aaRes.data as {
    volume_repas_realise: number | null;
    association_nom?: string | null;
    association_ville?: string | null;
    association?: AssoEmbed | AssoEmbed[] | null;
  } | null;
  // Repas donnés : volume de l'attribution, pour les trois espaces (table sous
  // aa_select, ou vue du gestionnaire).
  const repas_donnes = aa?.volume_repas_realise ?? null;
  const asso = one(aa?.association ?? null);
  const assoNom = aa?.association_nom ?? asso?.nom ?? null;
  const association: AssociationFiche | null =
    assoNom != null
      ? {
          nom: assoNom,
          ville: aa?.association_ville ?? asso?.ville ?? null,
          description: asso?.description_rapport_impact ?? null,
        }
      : null;

  // ── Événement + lieu effectif ───────────────────────────────────────────
  const lieuRef = one(evt?.lieu ?? null);
  // Lieu EFFECTIF de cette collecte : même fusion que celle transmise au
  // transporteur (surcharges saisies à la programmation, allowlist + gardes).
  const lieuEffectif = lieuRef
    ? applyLieuOverrides(lieuRef, c.lieu_overrides)
    : null;
  const evenement: EvenementFiche | null = evt
    ? {
        id: evt.id,
        nom_evenement: evt.nom_evenement,
        pax: evt.pax,
        type_evenement_id: evt.type_evenement_id,
        type_evenement: one(evt.type_evenement),
        nom_client_organisateur: evt.nom_client_organisateur,
        reference_affaire: reserve?.reference_affaire ?? null,
        contacts_visibles: contactsVisibles,
        contact_principal_nom: reserve?.contact_principal_nom ?? null,
        contact_principal_telephone:
          reserve?.contact_principal_telephone ?? null,
        contact_secours_nom: reserve?.contact_secours_nom ?? null,
        contact_secours_telephone: reserve?.contact_secours_telephone ?? null,
        lieu: lieuEffectif
          ? {
              id: lieuEffectif.id,
              nom: lieuEffectif.nom,
              adresse_acces: lieuEffectif.adresse_acces,
              code_postal: lieuEffectif.code_postal,
              ville: lieuEffectif.ville,
              acces_details: lieuEffectif.acces_details,
            }
          : null,
      }
    : null;

  const fiche: FicheCollecteClient = {
    id: c.id,
    type: c.type,
    statut: c.statut,
    statut_tms: c.statut_tms,
    tms_reference: c.tms_reference,
    date_collecte: c.date_collecte,
    heure_collecte: c.heure_collecte,
    controle_acces_requis: c.controle_acces_requis,
    informations_completes: c.informations_completes,
    informations_supplementaires: c.informations_supplementaires,
    taux_recyclage: c.taux_recyclage,
    co2_net_kg: c.co2_net_kg,
    co2_evite_kg: c.co2_evite_kg,
    realisee_at: c.realisee_at,
    aucun_repas_motif: c.aucun_repas_motif,
    // Entête §06.04 « Type d'événement + taille » : bracket canonique, jamais
    // inventé sans pax.
    taille_bracket: evt?.pax != null ? tailleBracket(evt.pax) : null,
    evenement,
    tournees,
    coordonnees_urgence_demandee: Boolean(alerteRes.data),
    bilan_flux,
    repas_donnes,
    association,
    rapport_rse_disponible,
    rapport_rse_regenere,
    rapport_reserve_donneur_ordre,
    rapport_etat: etatRapport({
      reserve: rapport_reserve_donneur_ordre,
      disponible: rapport_rse_disponible,
      statut: c.statut,
      realisee_at: c.realisee_at,
      maintenant,
    }),
    actions: evt
      ? droitsFiche(espace, ctx, c.statut, {
          organisation_id: evt.organisation_id,
          created_by: evt.created_by,
        })
      : { modifier: 'absent', annuler: 'absent', annulation: null },
  };

  return {
    fiche,
    contexte: {
      organisationProgrammatriceId: evt?.organisation_id ?? '',
      traiteurOperationnelId:
        evt?.traiteur_operationnel_organisation_id ?? null,
    },
  };
}
