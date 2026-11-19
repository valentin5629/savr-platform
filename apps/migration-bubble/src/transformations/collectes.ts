/**
 * Collectes Bubble → `evenements`, `collectes`, `collecte_contacts`,
 * `collecte_flux`, `attributions_antgaspi` (fiche de mapping 08).
 *
 * Bubble n'a pas d'événement : 1 collecte Bubble = 1 événement à 1 collecte,
 * nommé « Client - Lieu » (décision Val 2026-10-30).
 */
import type { Ligne } from '../csv';
import { identifiantCible } from '../identifiants';
import {
  decalerAnnees,
  horodatageParis,
  lireDateBubble,
  lireDecimal,
  lireEmails,
  lireEntier,
  lireOuiNon,
  normaliserAdresse,
  normaliserNom,
  texteBorne,
  texteOuNull,
  type DateMurale,
} from '../normalisation';
import {
  ajouterAuListing,
  type CodeFlux,
  type Contexte,
  type Plan,
} from '../plan';
import { notesReferencesTransport } from '../referentiel-tms';
import type { LieuRetenu, PassageSurLieu } from './lieux';
import type { Clients } from './organisations';
import {
  ajouterAssociationHistorique,
  ajouterTransporteurHistorique,
  type TelephoneDuContact,
  type UsageReferentiel,
} from './referentiels';

/** Longueur d'un nom recopié de Bubble dans les notes internes d'une collecte. */
const LONGUEUR_NOM_NOTE = 200;

export type StatutCible =
  | 'programmee'
  | 'cloturee'
  | 'realisee_sans_collecte'
  | 'annulee';

export interface CollecteLue {
  bubbleId: string;
  type: 'anti_gaspi' | 'zero_dechet';
  statut: StatutCible;
  /** Programmée ou créée dans Bubble à une date passée : jamais soldée, importée annulée. */
  nonSoldee: boolean;
  /** Anti-gaspi terminée sans poids ni mention « pas d'excédents » : importée « sans excédent » (Val 2026-11-16). */
  sansPoids: boolean;
  date: DateMurale;
  /** Collecte de plus de 5 ans : aucune donnée personnelle de contact n'est reprise. */
  ancienne: boolean;
  /** Organisation qui porte l'événement : l'agence si la collecte en cite une, sinon le traiteur. */
  organisationId: string;
  traiteurId: string;
  adresseCle: string;
  ligne: Ligne;
}

/** Colonnes de poids Bubble → codes du référentiel `flux_dechets` (Val 2026-11-02). */
const FLUX_BUBBLE: [string, CodeFlux][] = [
  ['Biodéchets (kg)', 'biodechet'],
  ['Carton (kg)', 'carton'],
  ['DIB (kg)', 'dechet_residuel'],
  ['Plastique (kg)', 'emballage'],
  ['Verre (kg)', 'verre'],
];

export const CONTACT_INCONNU = '—';
export const TELEPHONE_INCONNU = '-';
export const BRANCHE_MIGRATION = 'migration_bubble';
export const MOTIF_PAS_D_EXCEDENTS = 'Migration Bubble — pas d’excédents';
export const MOTIF_SANS_POIDS = 'Migration Bubble — poids du don non renseigné';

/** Poids du don : « Poids total » strictement positif, sinon null. */
function poidsDuDon(ligne: Ligne): number | null {
  const poids = lireDecimal(ligne['Poids total']);
  return poids !== null && poids > 0 ? poids : null;
}

function statutCible(
  ligne: Ligne,
  type: CollecteLue['type'],
  jour: string,
  jourReference: string,
): Pick<CollecteLue, 'statut' | 'nonSoldee' | 'sansPoids'> | null {
  const autre = { nonSoldee: false, sansPoids: false };
  switch ((ligne['Statut'] ?? '').trim()) {
    case 'Terminée': {
      if (type !== 'anti_gaspi') return { statut: 'cloturee', ...autre };
      if (lireOuiNon(ligne["Pas d'excédents"]) === true)
        return { statut: 'realisee_sans_collecte', ...autre };
      // Un don clôturé porte un poids : sans poids, la collecte est « sans excédent ».
      return poidsDuDon(ligne) === null
        ? {
            statut: 'realisee_sans_collecte',
            nonSoldee: false,
            sansPoids: true,
          }
        : { statut: 'cloturee', ...autre };
    }
    case 'Annulée':
      return { statut: 'annulee', ...autre };
    case 'Programmée':
    case 'Créée':
      return jour >= jourReference
        ? { statut: 'programmee', ...autre }
        : { statut: 'annulee', nonSoldee: true, sansPoids: false };
    default:
      return null;
  }
}

export function lireCollectes(
  lignes: Ligne[],
  clients: Clients,
  ctx: Contexte,
  plan: Plan,
): CollecteLue[] {
  const seuilAnciennete = decalerAnnees(ctx.jourReference, -5);
  const lues: CollecteLue[] = [];
  for (const ligne of lignes) {
    const bubbleId = ligne['unique id']!.trim();
    const rejeter = (motif: string) =>
      plan.rejets.push({ sourceType: 'collecte', bubbleId, motif });
    const nomClient = normaliserNom(ligne['Nom du client']);
    const decision = ctx.decisions.exclusions.get(bubbleId) ?? '';
    const exclue = decision === 'oui';
    if (decision !== '' || /\b(test|tests)\b/.test(nomClient))
      plan.aValider.exclusions.push({
        source: 'collecte',
        bubble_id: bubbleId,
        nom: ligne['Nom du client'] ?? '',
        motif_propose: 'nom du client évoquant un test',
        exclure: decision,
      });
    if (exclue || clients.clientExclu(ligne['User entreprise'] ?? '')) {
      rejeter('écartée par décision (donnée de test)');
      continue;
    }
    const typeBubble = (ligne['Type'] ?? '').trim();
    const type =
      typeBubble === 'NOURRITURE'
        ? 'anti_gaspi'
        : typeBubble === 'DECHET'
          ? 'zero_dechet'
          : null;
    if (!type) {
      rejeter(`type inconnu « ${typeBubble} »`);
      continue;
    }
    const date = lireDateBubble(ligne['Heure du pickup']);
    if (!date) {
      rejeter('date de collecte illisible');
      continue;
    }
    const adresseCle = normaliserAdresse(ligne['Lieu']);
    if (adresseCle === '') {
      rejeter('adresse du lieu vide');
      continue;
    }
    const statut = statutCible(ligne, type, date.jour, ctx.jourReference);
    if (!statut) {
      rejeter(`statut inconnu « ${(ligne['Statut'] ?? '').trim()} »`);
      continue;
    }
    let traiteurId =
      clients.organisationParNom(ligne['User entreprise'] ?? '') ??
      clients.organisationParEmail(lireEmails(ligne['User'])[0] ?? '');
    if (!traiteurId) {
      traiteurId = clients.organisationSansClient();
      ajouterAuListing(plan, 'collectes-sans-client', {
        bubble_id: bubbleId,
        identifiant: ligne['Identifiant'] ?? '',
        entreprise_bubble: ligne['User entreprise'] ?? '',
      });
    }
    const agenceId = (ligne['Agence'] ?? '').trim()
      ? clients.organisationParAgence(ligne['Agence']!)
      : null;
    if (statut.nonSoldee)
      ajouterAuListing(plan, 'collectes-non-soldees', {
        bubble_id: bubbleId,
        identifiant: ligne['Identifiant'] ?? '',
        statut_bubble: (ligne['Statut'] ?? '').trim(),
        date: date.jour,
      });
    lues.push({
      bubbleId,
      type,
      ...statut,
      date,
      ancienne: date.jour < seuilAnciennete,
      organisationId: agenceId ?? traiteurId,
      traiteurId,
      adresseCle,
      ligne,
    });
  }
  return lues;
}

export function passagesSurLieux(lues: CollecteLue[]): PassageSurLieu[] {
  return lues.map((c) => ({
    adresse: c.ligne['Lieu']!,
    nomDuLieu: c.ligne['Nom du lieu'] ?? '',
    // Consigne d'une collecte de plus de 5 ans : texte libre, non repris (peut nommer un contact).
    instruction: c.ancienne ? '' : (c.ligne['Instruction lieu'] ?? ''),
    plaqueRequise: lireOuiNon(c.ligne["besoin de l'immatriculation"]) === true,
    jour: c.date.jour,
    creation: lireDateBubble(c.ligne['Creation Date']),
    traiteurId: c.traiteurId,
  }));
}

/** Dernière collecte et types de collecte par transporteur Bubble ; dernière collecte anti-gaspi par point de dépôt. */
export function usageDesReferentiels(lues: CollecteLue[]): {
  transporteurs: UsageReferentiel;
  derniereCollecteParPointDepot: Map<string, string>;
} {
  const transporteurs: UsageReferentiel = {
    derniereCollecte: new Map(),
    typesCollecte: new Map(),
  };
  const derniereCollecteParPointDepot = new Map<string, string>();
  for (const c of lues) {
    const t = (c.ligne['Transporteur'] ?? '').trim();
    if (t) {
      if (c.date.jour > (transporteurs.derniereCollecte.get(t) ?? ''))
        transporteurs.derniereCollecte.set(t, c.date.jour);
      transporteurs.typesCollecte.set(
        t,
        (transporteurs.typesCollecte.get(t) ?? new Set()).add(c.type),
      );
    }
    const p = (c.ligne['Point de dépot'] ?? '').trim();
    if (
      p &&
      c.type === 'anti_gaspi' &&
      c.date.jour > (derniereCollecteParPointDepot.get(p) ?? '')
    )
      derniereCollecteParPointDepot.set(p, c.date.jour);
  }
  return { transporteurs, derniereCollecteParPointDepot };
}

export interface Dependances {
  clients: Clients;
  lieuParAdresse: Map<string, LieuRetenu>;
  associationParNom: Map<string, string>;
  transporteurParBubbleId: Map<string, { id: string; nom: string }>;
  poidsParBubbleId: Map<string, Ligne>;
  /** Pack débité par la collecte (identifiant Bubble de la collecte → identifiant du pack). */
  packParCollecte: Map<string, string>;
  telephoneDuContact: TelephoneDuContact;
}

export function transformerCollectes(
  lues: CollecteLue[],
  deps: Dependances,
  ctx: Contexte,
  plan: Plan,
): void {
  // Fiches inactives qui portent les dons dont Bubble ne dit pas l'association
  // ou le transporteur (Val 2026-11-16) ; créées seulement si une collecte s'en sert.
  let associationHistoriqueId: string | null = null;
  let transporteurHistoriqueId: string | null = null;
  for (const c of lues) {
    const l = c.ligne;
    const lieu = deps.lieuParAdresse.get(c.adresseCle);
    if (!lieu) {
      plan.rejets.push({
        sourceType: 'collecte',
        bubbleId: c.bubbleId,
        motif: 'lieu introuvable',
      });
      continue;
    }
    const evenementId = identifiantCible('evenement', c.bubbleId);
    const collecteId = identifiantCible('collecte', c.bubbleId);
    const instant = horodatageParis(c.date);
    const creation = lireDateBubble(l['Creation Date']);
    const modification = lireDateBubble(l['Modified Date']);
    const created_at = creation ? horodatageParis(creation) : ctx.instantImport;
    const updated_at = modification
      ? horodatageParis(modification)
      : created_at;

    const convives = lireEntier(l['Nombre de convives']);
    const paxConnu = convives !== null && convives > 0 && convives <= 100_000;
    const pax = paxConnu ? convives : 0;

    // Contacts sur place : jamais repris pour une collecte de plus de 5 ans (Val 2026-11-06).
    const contactPrincipal =
      (c.ancienne ? null : texteBorne(l['Contact 1'], 120)) ?? CONTACT_INCONNU;
    const contactSecours = c.ancienne ? null : texteBorne(l['Contact 2'], 120);
    // Téléphone : celui du contact repris au référentiel, sous le même nom, chez le
    // traiteur puis chez l'organisation de la collecte (Val 2026-11-19, C2).
    const telephoneDe = (nom: string | null) =>
      nom === null || nom === CONTACT_INCONNU
        ? null
        : (deps.telephoneDuContact(c.traiteurId, nom) ??
          deps.telephoneDuContact(c.organisationId, nom));
    const telephonePrincipal =
      telephoneDe(contactPrincipal) ?? TELEPHONE_INCONNU;
    const telephoneSecours = telephoneDe(contactSecours);
    const commercial = c.ancienne
      ? null
      : [
          lireEmails(l['mail du commercial'])[0],
          texteOuNull(l['numero du commercial']),
        ]
          .filter(Boolean)
          .join(' ');
    const client = texteOuNull(l['Nom du client']);

    // Email à qui rendre l'événement à son inscription : le commercial qui a programmé
    // la collecte dans Bubble, sinon le contact du traiteur. L'auteur importé reste le
    // compte système ; la réattribution est un lot du produit.
    const emailCommercial = lireEmails(l['mail du commercial'])[0] ?? null;
    const emailContact =
      deps.clients.emailContactParOrganisation.get(c.traiteurId) ?? null;
    if (emailCommercial || emailContact)
      plan.auteursEvenements.push({
        evenement_id: evenementId,
        email: emailCommercial ?? emailContact,
        provenance: emailCommercial ? 'commercial' : 'contact_traiteur',
      });

    plan.tables.evenements.push({
      id: evenementId,
      organisation_id: c.organisationId,
      traiteur_operationnel_organisation_id: c.traiteurId,
      // Une agence Bubble n'a pas d'entité de facturation : celle du traiteur est retenue.
      entite_facturation_id:
        deps.clients.entiteParOrganisation.get(c.organisationId) ??
        deps.clients.entiteParOrganisation.get(c.traiteurId),
      lieu_id: lieu.id,
      created_by: deps.clients.compteSystemeId,
      nom_evenement: client ? `${client} - ${lieu.nom}` : lieu.nom,
      type_evenement_id: ctx.typeEvenementAutreId,
      pax,
      contact_principal_nom: contactPrincipal,
      contact_principal_telephone: telephonePrincipal,
      contact_secours_nom: contactSecours,
      contact_secours_telephone: telephoneSecours,
      nom_client_organisateur: client,
      reference_affaire: texteOuNull(l['Identifiant']),
      notes_internes: commercial
        ? `Migration Bubble — commercial: ${commercial}`
        : 'Migration Bubble',
      created_at,
      updated_at,
    });

    // Poids, association, transporteur.
    const transporteur = deps.transporteurParBubbleId.get(
      (l['Transporteur'] ?? '').trim(),
    );
    const pointDepot = texteOuNull(l['Point de dépot']);
    // Recopié dans les notes internes : borné, sans caractère de contrôle (C32).
    const pointDepotNote = texteBorne(l['Point de dépot'], LONGUEUR_NOM_NOTE);
    const associationId =
      c.type === 'anti_gaspi' && pointDepot
        ? deps.associationParNom.get(pointDepot)
        : undefined;
    const poidsRepas = poidsDuDon(l);
    const pesees: [CodeFlux, number][] = [];
    if (c.type === 'zero_dechet') {
      const poids = deps.poidsParBubbleId.get(
        (l['Poids déchets'] ?? '').trim(),
      );
      for (const [colonne, code] of FLUX_BUBBLE) {
        const kg = lireDecimal(poids?.[colonne]);
        if (kg !== null && kg > 0) pesees.push([code, kg]);
      }
    }
    const cloturee = c.statut === 'cloturee';
    // Une anti-gaspi clôturée porte toujours un poids (sinon elle est « sans excédent »).
    const attribuee = cloturee && c.type === 'anti_gaspi';
    const attributionIncomplete =
      attribuee && (!associationId || !transporteur);

    const partiel =
      !paxConnu ||
      !lieu.situe ||
      attributionIncomplete ||
      (cloturee && c.type === 'zero_dechet' && pesees.length === 0);

    const packId =
      c.type === 'anti_gaspi'
        ? (deps.packParCollecte.get(c.bubbleId) ?? null)
        : null;
    const terminee = cloturee || c.statut === 'realisee_sans_collecte';

    plan.tables.collectes.push({
      id: collecteId,
      evenement_id: evenementId,
      type: c.type,
      statut: c.statut,
      // Jamais transmise par la nouvelle plateforme : rien à synchroniser avec un prestataire.
      statut_tms: 'non_envoye',
      // Marque de l'import : ce qui permettra d'écarter l'historique des traitements de documents.
      origine: BRANCHE_MIGRATION,
      date_collecte: c.date.jour,
      heure_collecte: c.date.heure,
      controle_acces_requis:
        lireOuiNon(l["besoin de l'immatriculation"]) === true,
      aucun_repas_motif:
        c.statut !== 'realisee_sans_collecte'
          ? null
          : c.sansPoids
            ? MOTIF_SANS_POIDS
            : MOTIF_PAS_D_EXCEDENTS,
      motif_incident:
        c.statut !== 'annulee'
          ? null
          : c.nonSoldee
            ? 'Migration Bubble — collecte non soldée'
            : 'Migration Bubble — annulée (motif non tracé)',
      // Annulée mais toujours comptée par son pack dans Bubble : crédit conservé.
      annulation_tardive: c.statut === 'annulee' ? packId !== null : null,
      notes_internes: [
        'Migration Bubble',
        texteOuNull(l['Identifiant'])
          ? `Identifiant: ${l['Identifiant']!.trim()}`
          : null,
        ...notesReferencesTransport(
          texteOuNull(l['MTS_1_tour_or_customer_order_id']),
          texteOuNull(l['Everest_mission_ref']),
        ),
        c.type === 'zero_dechet' && pointDepotNote
          ? `Exutoire: ${pointDepotNote}`
          : null,
        // Association ou transporteur nommés par Bubble mais absents de l'attribution.
        c.type === 'anti_gaspi' &&
        pointDepotNote &&
        !(attribuee && associationId)
          ? `Point de dépôt: ${pointDepotNote}`
          : null,
        transporteur && !attribuee ? `Transporteur: ${transporteur.nom}` : null,
        texteOuNull(l['formule']) ? `Formule: ${l['formule']!.trim()}` : null,
        !c.ancienne && texteOuNull(l['Commentaires_interne'])
          ? `Commentaire: ${l['Commentaires_interne']!.trim()}`
          : null,
      ]
        .filter((n) => n !== null)
        .join('\n'),
      informations_supplementaires: c.ancienne
        ? null
        : texteBorne(l['Instruction lieu'], 1000, true),
      // Référence de l'ancien logiciel : jamais sur une collecte à venir, que la
      // nouvelle plateforme doit pouvoir envoyer comme une collecte neuve.
      tms_reference:
        c.statut === 'programmee'
          ? null
          : texteOuNull(l['MTS_1_tour_or_customer_order_id']),
      informations_completes: true,
      historique_partiel: partiel,
      pack_antgaspi_id: packId,
      realisee_at: terminee ? instant : null,
      pax,
      created_at,
      updated_at,
    });
    plan.tables.collecte_contacts.push({
      collecte_id: collecteId,
      contact_principal_nom: contactPrincipal,
      contact_principal_telephone: telephonePrincipal,
      contact_secours_nom: contactSecours,
      contact_secours_telephone: telephoneSecours,
    });
    plan.correspondances.push(
      {
        sourceType: 'evenement',
        bubbleId: c.bubbleId,
        table: 'evenements',
        cibleId: evenementId,
        fusionne: false,
      },
      {
        sourceType: 'collecte',
        bubbleId: c.bubbleId,
        table: 'collectes',
        cibleId: collecteId,
        fusionne: false,
      },
    );

    if (cloturee) {
      for (const [code, kg] of pesees) {
        const id = identifiantCible('flux', `${c.bubbleId}:${code}`);
        plan.tables.collecte_flux.push({
          id,
          collecte_id: collecteId,
          flux_id: ctx.fluxParCode[code],
          poids_reel_kg: kg,
          created_at,
          updated_at: created_at,
        });
        plan.correspondances.push({
          sourceType: 'flux',
          bubbleId: `${c.bubbleId}:${code}`,
          table: 'collecte_flux',
          cibleId: id,
          fusionne: false,
        });
      }
    } else if (pesees.length > 0)
      ajouterAuListing(plan, 'poids-non-repris', {
        bubble_id: c.bubbleId,
        identifiant: l['Identifiant'] ?? '',
        statut: c.statut,
        motif: 'pesées présentes sur une collecte non terminée',
      });

    if (c.statut === 'realisee_sans_collecte' && poidsRepas !== null)
      ajouterAuListing(plan, 'poids-non-repris', {
        bubble_id: c.bubbleId,
        identifiant: l['Identifiant'] ?? '',
        statut: c.statut,
        motif: 'collecte « sans excédent » qui porte un poids',
      });
    if (c.sansPoids)
      ajouterAuListing(plan, 'ag-sans-poids', {
        bubble_id: c.bubbleId,
        identifiant: l['Identifiant'] ?? '',
        date: c.date.jour,
        point_depot: pointDepot ?? '',
        transporteur: transporteur?.nom ?? '',
      });
    if (attribuee) {
      const id = identifiantCible('attribution', c.bubbleId);
      plan.tables.attributions_antgaspi.push({
        id,
        collecte_id: collecteId,
        association_id:
          associationId ??
          (associationHistoriqueId ??= ajouterAssociationHistorique(ctx, plan)),
        transporteur_id:
          transporteur?.id ??
          (transporteurHistoriqueId ??= ajouterTransporteurHistorique(
            ctx,
            plan,
          )),
        // Valeur réservée à l'import : jamais produite par l'algorithme d'attribution.
        branche_attribution: BRANCHE_MIGRATION,
        mode_validation: 'manuel_top1',
        valide_at: instant,
        poids_repas_kg: poidsRepas,
        volume_repas_realise: Math.ceil(poidsRepas! / ctx.poidsParRepasKg),
        created_at: instant,
      });
      plan.correspondances.push({
        sourceType: 'attribution',
        bubbleId: c.bubbleId,
        table: 'attributions_antgaspi',
        cibleId: id,
        fusionne: false,
      });
    }
    if (attributionIncomplete)
      ajouterAuListing(plan, 'ag-attribution-historique', {
        bubble_id: c.bubbleId,
        identifiant: l['Identifiant'] ?? '',
        date: c.date.jour,
        manque: [
          associationId ? null : 'association',
          transporteur ? null : 'transporteur',
        ]
          .filter((m) => m !== null)
          .join(' et '),
        poids_total_kg: poidsRepas,
      });
    if (partiel)
      ajouterAuListing(plan, 'collectes-historique-partiel', {
        bubble_id: c.bubbleId,
        identifiant: l['Identifiant'] ?? '',
        type: c.type,
        statut: c.statut,
        date: c.date.jour,
        raisons: [
          paxConnu ? null : 'nombre de convives absent',
          lieu.situe ? null : 'lieu non situé',
          attributionIncomplete
            ? 'association ou transporteur non renseigné dans Bubble'
            : null,
          cloturee && c.type === 'zero_dechet' && pesees.length === 0
            ? 'aucune pesée'
            : null,
        ]
          .filter((r) => r !== null)
          .join(', '),
      });
  }
}
