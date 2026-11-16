/**
 * Packs et abonnements Bubble → `plateforme.packs_antgaspi` (fiche de mapping 07).
 *
 * Les crédits consommés ne viennent jamais de Bubble : ils sont recomptés
 * depuis les collectes rattachées, selon la règle du débit à la programmation
 * (décision Val 2026-11-02). Aucun déclencheur ne débite pendant l'import.
 */
import type { Ligne } from '../csv';
import { identifiantCible } from '../identifiants';
import {
  horodatageParis,
  lireDateBubble,
  lireEmails,
  lireEntier,
  lireOuiNon,
} from '../normalisation';
import {
  ajouterAuListing,
  type Contexte,
  type LigneCible,
  type Plan,
} from '../plan';
import type { CollecteLue } from './collectes';

const TYPES_PACK: Record<number, string> = {
  10: 'pack_10',
  30: 'pack_30',
  60: 'pack_60',
};

interface Candidat {
  ligne: LigneCible;
  organisationId: string;
  achat: string;
  /** Les packs passent avant les abonnements quand deux lignes d'une organisation se disent actives. */
  rang: number;
}

export function transformerPacks(
  packs: Ligne[],
  abonnements: Ligne[],
  lues: CollecteLue[],
  organisationParEmail: (email: string) => string | null,
  ctx: Contexte,
  plan: Plan,
): Map<string, string> {
  const packParCollecte = new Map<string, string>();
  const candidats: Candidat[] = [];
  const antiGaspi = lues.filter((c) => c.type === 'anti_gaspi');

  // Packs : la collecte cite son pack (« pack lié »), le pack liste ses collectes.
  const listees = new Map<string, Set<string>>();
  const packConnu = new Map<string, { id: string; organisationId: string }>();
  const lignesPacks = new Map<string, LigneCible>();
  for (const l of packs) {
    const bubbleId = l['unique id']!.trim();
    const rejeter = (motif: string) => {
      plan.rejets.push({ sourceType: 'pack', bubbleId, motif });
      ajouterAuListing(plan, 'packs-a-arbitrer', {
        bubble_id: bubbleId,
        source: 'pack',
        motif,
      });
    };
    const organisationId = organisationParEmail(lireEmails(l['User'])[0] ?? '');
    if (!organisationId) {
      rejeter('organisation de l’acheteur non retrouvée');
      continue;
    }
    const credits = lireEntier(l['Type']);
    if (credits === null || credits <= 0) {
      rejeter(`taille de pack illisible « ${l['Type'] ?? ''} »`);
      continue;
    }
    const statutBubble = (l['Status'] ?? '').trim();
    if (!['Actif', 'Consommé', 'En attente'].includes(statutBubble)) {
      rejeter(`statut inconnu « ${statutBubble} »`);
      continue;
    }
    const achat = lireDateBubble(l['Creation Date']);
    const id = identifiantCible('pack', bubbleId);
    packConnu.set(bubbleId, { id, organisationId });
    listees.set(
      bubbleId,
      new Set(
        (l['Collectes liées'] ?? '')
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean),
      ),
    );
    const created_at = achat ? horodatageParis(achat) : ctx.instantImport;
    lignesPacks.set(bubbleId, {
      id,
      organisation_id: organisationId,
      statut: statutBubble === 'Consommé' ? 'epuise' : 'actif',
      date_achat: achat?.jour ?? ctx.jourReference,
      mode_facturation: 'par_collecte',
      type_pack: TYPES_PACK[credits] ?? 'personnalise',
      credits_initiaux: credits,
      credits_consommes: 0,
      commentaires: `Migration Bubble — Status source: ${statutBubble}`,
      created_at,
      updated_at: created_at,
    });
    if (statutBubble === 'En attente')
      ajouterAuListing(plan, 'packs-a-arbitrer', {
        bubble_id: bubbleId,
        source: 'pack',
        motif: 'statut Bubble « En attente » : importé actif, à confirmer',
      });
    plan.correspondances.push({
      sourceType: 'pack',
      bubbleId,
      table: 'packs_antgaspi',
      cibleId: id,
      fusionne: false,
    });
  }

  const compte = new Map<string, number>();
  for (const c of lues) {
    const lie = (c.ligne['pack lié'] ?? '').trim();
    if (!lie) continue;
    const signaler = (motif: string) =>
      ajouterAuListing(plan, 'packs-liens-a-verifier', {
        collecte_bubble_id: c.bubbleId,
        identifiant: c.ligne['Identifiant'] ?? '',
        pack_bubble_id: lie,
        motif,
      });
    if (c.type !== 'anti_gaspi') {
      signaler('pack cité par une collecte zéro déchet : ignoré');
      continue;
    }
    const pack = packConnu.get(lie);
    if (!pack) {
      signaler('pack inconnu ou rejeté');
      continue;
    }
    const listee = listees.get(lie)!.has(c.bubbleId);
    if (c.statut === 'annulee') {
      // Annulée : le crédit n'est conservé que si le pack compte encore la collecte.
      if (!listee) continue;
      signaler('annulée mais encore comptée par le pack : crédit conservé');
    } else if (!listee)
      signaler('citée par la collecte, absente de la liste du pack : comptée');
    packParCollecte.set(c.bubbleId, pack.id);
    compte.set(lie, (compte.get(lie) ?? 0) + 1);
  }

  for (const [bubbleId, ligne] of lignesPacks) {
    const initiaux = ligne.credits_initiaux as number;
    const consommes = compte.get(bubbleId) ?? 0;
    if (consommes > initiaux)
      ajouterAuListing(plan, 'packs-a-arbitrer', {
        bubble_id: bubbleId,
        source: 'pack',
        motif: `${consommes} collectes rattachées pour ${initiaux} crédits : consommation bornée`,
      });
    ligne.credits_consommes = Math.min(consommes, initiaux);
    if (ligne.statut === 'actif' && consommes >= initiaux)
      ligne.statut = 'epuise';
    candidats.push({
      ligne,
      organisationId: ligne.organisation_id as string,
      achat: ligne.date_achat as string,
      rang: 0,
    });
  }

  // Abonnements : anciens engagements annuels, importés comme packs historiques.
  for (const l of abonnements) {
    const bubbleId = l['unique id']!.trim();
    const rejeter = (motif: string) => {
      plan.rejets.push({ sourceType: 'abonnement', bubbleId, motif });
      ajouterAuListing(plan, 'packs-a-arbitrer', {
        bubble_id: bubbleId,
        source: 'abonnement',
        motif,
      });
    };
    const organisationId = organisationParEmail(lireEmails(l['User'])[0] ?? '');
    if (!organisationId) {
      rejeter('organisation de l’abonné non retrouvée');
      continue;
    }
    const initiaux = lireEntier(l['Nombre de collectes']);
    if (initiaux === null || initiaux <= 0) {
      rejeter('nombre de collectes illisible');
      continue;
    }
    const debut = lireDateBubble(l['Date début']);
    const fin = lireDateBubble(l['Date fin']);
    const achat = debut ?? lireDateBubble(l['Creation Date']);
    const enCours = lireOuiNon(l['en_cours']) === true;
    const vivant = enCours && !!debut && !!fin && fin.jour >= ctx.jourReference;
    const id = identifiantCible('abonnement', bubbleId);
    let consommes = initiaux; // terminé : épuisé par convention (fiche 07 §2)
    if (vivant) {
      const rattachables = antiGaspi
        .filter(
          (c) =>
            c.traiteurId === organisationId &&
            c.statut !== 'annulee' &&
            !packParCollecte.has(c.bubbleId) &&
            c.date.jour >= debut.jour &&
            c.date.jour <= fin.jour,
        )
        .sort((a, b) =>
          `${a.date.jour} ${a.date.heure}`.localeCompare(
            `${b.date.jour} ${b.date.heure}`,
          ),
        )
        .slice(0, initiaux);
      for (const c of rattachables) packParCollecte.set(c.bubbleId, id);
      consommes = rattachables.length;
    } else if (enCours)
      ajouterAuListing(plan, 'packs-a-arbitrer', {
        bubble_id: bubbleId,
        source: 'abonnement',
        motif: 'abonnement « en cours » dans Bubble mais échu : importé épuisé',
      });
    const created_at = achat ? horodatageParis(achat) : ctx.instantImport;
    const ligne: LigneCible = {
      id,
      organisation_id: organisationId,
      statut: vivant && consommes < initiaux ? 'actif' : 'epuise',
      date_achat: achat?.jour ?? ctx.jourReference,
      mode_facturation: 'par_collecte',
      type_pack: 'personnalise',
      credits_initiaux: initiaux,
      credits_consommes: consommes,
      commentaires: `Migration Bubble Abonnement ${debut?.jour ?? '?'}→${fin?.jour ?? '?'}`,
      created_at,
      updated_at: created_at,
    };
    candidats.push({
      ligne,
      organisationId,
      achat: ligne.date_achat as string,
      rang: 1,
    });
    plan.correspondances.push({
      sourceType: 'abonnement',
      bubbleId,
      table: 'packs_antgaspi',
      cibleId: id,
      fusionne: false,
    });
  }

  // Un seul pack actif par organisation (invariant de la base) : le plus récent le reste.
  const actifs = new Map<string, Candidat[]>();
  for (const c of candidats)
    if (c.ligne.statut === 'actif')
      actifs.set(c.organisationId, [
        ...(actifs.get(c.organisationId) ?? []),
        c,
      ]);
  for (const groupe of actifs.values()) {
    groupe.sort((a, b) => a.rang - b.rang || b.achat.localeCompare(a.achat));
    for (const perdant of groupe.slice(1)) {
      perdant.ligne.statut = 'epuise';
      ajouterAuListing(plan, 'packs-a-arbitrer', {
        bubble_id: perdant.ligne.id,
        source: perdant.rang === 0 ? 'pack' : 'abonnement',
        motif: `plusieurs packs actifs pour la même organisation : importé épuisé avec ${
          (perdant.ligne.credits_initiaux as number) -
          (perdant.ligne.credits_consommes as number)
        } crédit(s) restant(s)`,
      });
    }
  }
  plan.tables.packs_antgaspi = candidats.map((c) => c.ligne);
  return packParCollecte;
}
