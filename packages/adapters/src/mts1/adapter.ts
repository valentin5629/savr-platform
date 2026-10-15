// Adapter MTS-1 — côté sortant (M1.5a).
// Polling entrant (sync) = M1.5b.
//
// Pipeline dispatchCollecte :
//   Étape 1 — POST /v3/customerOrders → commit external_ref_commande IMMÉDIATEMENT
//   Étape 2 — POST /v3/tours → commit tms_reference IMMÉDIATEMENT
//   Étape 3 — POST /v3/tours/{id}/dispatch
//   Étape 4 — PUT  /v3/tours/{id}/validate
//
// Chaque commit est immédiat (CLAUDE.md §2 : MTS-1 présumé NON idempotent).
// Curseur de reprise : lecture tournees (external_ref_commande, tms_reference) avant dispatch.
// Un curseur non écrit après une création = erreur AMBIGUË, jamais un simple rejeu.
// Réconciliation : si requires_reconciliation=true → recherche de la commande par
// son numéro avant tout re-POST, puis de sa tournée (currentTour) avant tout
// re-POST /v3/tours.

import { createHash } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';
import { uploadObject } from '@savr/shared/src/r2/upload.js';

import type {
  Collecte,
  ConsumerTag,
  FenetreSync,
  HealthCheckResult,
  Lieu,
  LogistiqueProvider,
  Transporteur,
} from '../index.js';
import {
  CancelWindowClosedError,
  LogistiqueAmbiguousError,
  LogistiquePermanentError,
  LogistiqueTransientError,
} from '../index.js';
import {
  CHAMPS_ADRESSE_TMS,
  applyLieuOverrides,
  lieuChampSurcharge,
} from '../lieu-overrides.js';
import {
  prestatairesDuType,
  retenirTourneesDuProvider,
} from '../provider-tournees.js';
import {
  FILTRE_STATUTS_COLLECTE_TERMINAUX,
  STATUTS_COLLECTE_EN_EXECUTION,
} from '../statuts-collecte.js';
import type {
  CreateOrderPayload,
  CreateTourPayload,
  PointLivraison,
} from './client.js';
import { estIdentifiantMts1, Mts1Client } from './client.js';
import type { Mts1CustomerOrder, Mts1Tour, Mts1TourStop } from './mock.js';
import { decalerJour, jourParis } from '@savr/shared/src/temps/index.js';

// `collectes.lieu_overrides` — jsonb libre porté par la collecte (§06.01).
interface CollecteLieuOverridesRow {
  lieu_overrides: Record<string, unknown> | null;
}

// Toute lecture de tournée porte le prestataire exécutant : `external_ref_commande`
// ne dit PAS par quel provider la tournée a été dispatchée (l'adapter Everest y
// stocke son id de mission), c'est `prestataire_logistique_id` qui le dit, via
// `transporteurs.type_tms`. Cf. provider-tournees.ts.
interface TourneeRow {
  id: string;
  // Porte la tentative de commande (`-r{n}`) posée par fn_dispatcher_collecte à
  // la réattribution d'un rang refusé — cf. orderNumber.
  reference_interne: string;
  external_ref_commande: string | null;
  tms_reference: string | null;
  statut: string;
  rang: number;
  prestataire_logistique_id: string | null;
}

/**
 * Clé de stockage d'une photo remontée par le transporteur, dans le bucket de
 * l'environnement : `photos/collectes/<collecteId>/<empreinte>.jpg` — même dossier
 * que les photos importées à la main par l'Admin.
 *
 * L'empreinte remplace les identifiants de tournée, d'arrêt et de photo du
 * logiciel du transporteur : la ligne shared.fichiers est lisible par les clients
 * de la collecte (§09 C1), sa clé ne doit pas les leur montrer (décision Val
 * 2026-10-07, prise tant qu'aucune photo n'existe). Ce n'est pas un secret, juste
 * un nom qui ne dit plus rien. Elle est DÉTERMINISTE — la dédup de processPhotos
 * cherche la clé — et ne porte que le triplet d'identifiants, pas l'adresse de la
 * photo : l'hôte du connecteur peut changer sans que la photo change.
 */
function clePhoto(
  collecteId: string,
  photo: { tourId: string; stopId: string; photoId: string },
): string {
  const empreinte = createHash('sha256')
    .update(JSON.stringify([photo.tourId, photo.stopId, photo.photoId]))
    .digest('hex');
  return `photos/collectes/${collecteId}/${empreinte}.jpg`;
}

// Suffixes flux ZD → libellés MTS-1 as-built (sortant)
const FLUX_STUFFS_ZD = [
  'Bio-déchets (en kg)',
  'Carton (en kg)',
  'D.I.B (en kg)',
  'Film plastique (en kg)',
  'Verre (en kg)',
];

// Mapping libellés MTS-1 → codes flux_dechets (entrant)
// '_ignore' = pas un flux de déchets, jamais une pesée :
//   - le stuff « camion » ;
//   - le don d'une collecte AG, que buildOrderPayload crée lui-même : son poids
//     n'est pas relevé chez le prestataire en V1, l'équipe Savr le saisit d'après
//     les photos (§06.09, décision Val 2026-06-07).
const STUFF_TO_FLUX: Record<string, string | '_ignore'> = {
  'Bio-déchets (en kg)': 'biodechet',
  'Carton (en kg)': 'carton',
  'D.I.B (en kg)': 'dechet_residuel',
  'Film plastique (en kg)': 'emballage',
  'Verre (en kg)': 'verre',
  '<volume_du_camion>': '_ignore',
  'Don alimentaire': '_ignore',
};

// Mapping customerOrderStatus MTS-1 → statut_tms (§08 §3bis.6).
// A7 : les libellés sont les ENUMS OFFICIELS de l'as-built §7 (QUOTE, DRAFT,
// PLANNED, VALIDATED, IN_PROGRESSION, OK, PARTIAL, ARCHIVED, KO, CANCELED).
// L'ancien jeu (PENDING/ACCEPTED/IN_PROGRESS/DELIVERED) n'est JAMAIS renvoyé par
// MTS-1 : un succès réel arrive en 'OK' (et non 'DELIVERED'), donc l'agrégation
// terminale — gardée sur un set sans 'OK' — ne se déclenchait jamais en prod
// (collecte jamais realisee → ni batch J+1, ni bordereau/attestation).
const MTS1_STATUS_TO_TMS: Record<string, string | null> = {
  QUOTE: 'attribuee_en_attente_acceptation',
  DRAFT: 'attribuee_en_attente_acceptation',
  PLANNED: 'attribuee_en_attente_acceptation',
  VALIDATED: 'acceptee',
  IN_PROGRESSION: null, // pas de changement statut_tms ; → collectes.statut='en_cours' direct
  OK: null, // terminal géré par agrégation M1.5c
  PARTIAL: null, // terminal géré par agrégation M1.5c
  ARCHIVED: null,
  CANCELED: 'rejetee_par_prestataire',
  KO: 'rejetee_par_prestataire',
};

// Commande que la réconciliation n'adopte jamais : l'adopter ferait croire
// commandé un camion qui ne viendra pas. `CANCELED` et `KO` sont les deux
// statuts que le mapping ci-dessus lit comme un refus du prestataire. Écartées,
// elles laissent la création repartir s'il ne reste aucune commande à reprendre.
// La commande de test supprimée le 2026-10-13, sans tour, est passée `CANCELED`
// et n'est plus rendue par la recherche.
const STATUTS_COMMANDE_MORTE = new Set(['CANCELED', 'KO']);

// Statuts qui arrêtent la reprise d'une création : une commande du même numéro
// dans l'un d'eux met l'ordre en échec définitif, donc en alerte — ni reprise,
// ni nouvelle création, même si une commande encore en cours porte aussi ce
// numéro (décisions de Val, 2026-10-13). L'arrêt joue aux deux lectures d'une
// reprise « à réconcilier » : la recherche par numéro (aucune commande enregistrée pour le rang)
// et la relecture de la commande enregistrée quand la référence de sa tournée
// manque. Les deux curseurs écrits, la reprise ne lit rien chez MTS-1 : le
// rattachement, l'envoi et la validation sont rejoués sans contrôle de statut. `OK` et `PARTIAL` : la mission est
// terminée. `ARCHIVED` : rangé avec eux par la même décision, son sens n'étant
// pas mesuré (1 commande `ARCHIVED` parmi les 72 que rendait la recherche du
// compte de démonstration ce jour-là).
const STATUTS_COMMANDE_TERMINEE = new Set(['OK', 'PARTIAL', 'ARCHIVED']);

// ─── Lecture du détail d'un tour (forme mesurée le 2026-10-13) ───────────────

function sertLaCommande(stop: Mts1TourStop, customerOrderId: string): boolean {
  return (stop.customerOrders ?? []).some(
    (c) => c?.customerOrderId === customerOrderId,
  );
}

// Arrêt d'ENLÈVEMENT de la commande : `stopType = CUSTOMER_ORDER`, la commande
// nommée dans `customerOrders`. Les pesées ne se lisent que là (décision Val
// 2026-10-13) : les stuffs sont répétés sur l'arrêt de dépôt, les lire aux deux
// endroits doublerait les poids. Et pour CETTE commande seulement : un tour peut
// porter plusieurs enlèvements (jusqu'à 3 mesurés, trois commandes du même
// numéro).
function arretEnlevement(
  tour: Mts1Tour,
  customerOrderId: string,
): Mts1TourStop | undefined {
  return (tour.stops ?? []).find(
    (s) =>
      s?.stopType === 'CUSTOMER_ORDER' && sertLaCommande(s, customerOrderId),
  );
}

// Identifiant d'une photo : le dernier segment de son adresse, seul endroit où il
// se lit (décision Val 2026-10-13). L'adresse doit finir par la forme mesurée,
// `tours/photo/{tourId}/{stopId}/{photoId}`, pour CE tour et CET arrêt ; sinon
// `null` : lire le dernier segment d'une autre forme pourrait donner le même
// identifiant à des photos différentes, et la dédup n'en garderait qu'une.
function identifiantPhoto(
  downloadUrl: string,
  tourId: string,
  stopId: string,
): string | null {
  let segments: string[];
  try {
    segments = new URL(downloadUrl).pathname.split('/').filter(Boolean);
  } catch {
    return null;
  }
  const [tours, photo, tour, stop, photoId] = segments.slice(-5);
  return tours === 'tours' &&
    photo === 'photo' &&
    tour === tourId &&
    stop === stopId &&
    photoId
    ? photoId
    : null;
}

export class AdapterMts1 implements LogistiqueProvider {
  private readonly client: Mts1Client;

  constructor(
    private readonly transporteur: Transporteur,
    private readonly supabase: SupabaseClient,
  ) {
    this.client = new Mts1Client(supabase);
  }

  // ─── Health check (ops) ──────────────────────────────────────────────────────

  async healthCheck(): Promise<HealthCheckResult> {
    const r = await this.client.ping();
    return {
      ok: r.ok,
      etat: r.ok ? 'ok' : 'ko',
      statutHttp: r.statutHttp,
      dureeMs: r.dureeMs,
      message: r.erreur,
    };
  }

  // ─── E1 collecte.creee ───────────────────────────────────────────────────────

  async dispatchCollecte(
    collecte: Collecte,
    rang: number,
    opts?: { requiresReconciliation?: boolean },
  ): Promise<ConsumerTag> {
    // Curseur : lire la tournee existante pour ce rang
    let tournee = await this.findTournee(collecte.id, rang);

    // Pipeline déjà mené à terme → idempotent no-op.
    // statut n'est posé à 'en_cours' qu'APRÈS validate (étape 4) : tant que la
    // tournée est 'planifiee', dispatch/validate DOIVENT être (re)joués — sinon un
    // échec transient en étape 3/4 laisserait le camion non commandé (bug C2).
    // Un statut terminal ('terminee'/'annulee', posé par le polling) sort aussi en
    // no-op : on ne re-dispatch jamais un tour déjà clos.
    if (tournee?.tms_reference && tournee.statut !== 'planifiee') {
      return 'adapter_mts1';
    }

    // Clé de la commande de CE rang, tentative comprise. Lue sur la tournée
    // trouvée (jamais réécrite par l'adapter) : stable sur toute la reprise.
    const orderNumber = this.orderNumber(collecte, rang, tournee);

    // ── Étape 1 : POST /v3/customerOrders ──────────────────────────────────────
    let customerOrderId = tournee?.external_ref_commande ?? null;
    // Commande retrouvée chez MTS-1 par la réconciliation : elle dit aussi sa
    // tournée (étape 2).
    let commandeRetrouvee: Mts1CustomerOrder | null = null;
    let commandeNeuve = false;
    if (!customerOrderId) {
      // Réconciliation avant re-POST si claim expiré lors d'une tentative précédente
      if (opts?.requiresReconciliation) {
        commandeRetrouvee = await this.reconcileOrder(collecte, orderNumber);
        customerOrderId = commandeRetrouvee?.customerOrderId ?? null;
      }
      if (!customerOrderId) {
        const created = await this.client.postOrder(
          this.buildOrderPayload(collecte, orderNumber),
        );
        customerOrderId = created.id;
        commandeNeuve = true;
        // Commit immédiat — MTS-1 présumé NON idempotent (CLAUDE.md §2)
        tournee = await this.upsertTournee(
          collecte,
          rang,
          customerOrderId,
          tournee,
        );
      } else {
        // Ordre trouvé via réconciliation, écrire le curseur sans re-POSTer
        tournee = await this.upsertTournee(
          collecte,
          rang,
          customerOrderId,
          tournee,
        );
      }
    }

    // ── Étape 2 : POST /v3/tours ────────────────────────────────────────────────
    let tourId = tournee?.tms_reference ?? null;
    // Tournée reprise sur la commande à ce passage : la commande y est déjà
    // rattachée, le rattachement n'est pas rejoué.
    let dejaRattachee = false;
    if (!tourId) {
      // Réconciliation avant re-POST : une tournée créée lors d'une tentative
      // précédente, sans que son identifiant ait été enregistré, se retrouve par
      // sa commande. Sans objet pour une commande créée à l'instant.
      if (opts?.requiresReconciliation && !commandeNeuve) {
        tourId = await this.reconcileTour(
          collecte,
          rang,
          customerOrderId,
          commandeRetrouvee,
        );
        dejaRattachee = tourId !== null;
      }
      if (!tourId) {
        const tourPayload = this.buildTourPayload(collecte, orderNumber);
        const created = await this.client.createTour(tourPayload);
        tourId = created.tourId;
      }
      // Commit immédiat
      await this.updateTourneeRef(
        tournee!.id,
        tourId,
        customerOrderId,
        orderNumber,
        dejaRattachee,
      );
    }

    // ── Étape 2bis : rattacher la commande à la tournée ─────────────────────────
    // Rejoué à chaque passage tant que la tournée est 'planifiee' (comme
    // dispatch/validate ci-dessous), sauf quand la tournée vient d'être reprise
    // sur la commande elle-même (dejaRattachee). Le `customerOrderId` du POST /v3/tours
    // étant ignoré par MTS-1, ce PUT garantit la commande rattachée AVANT le dispatch
    // — y compris sur reprise après échec transitoire de createTour/addCustomerOrder
    // (sinon le dispatch porterait sur une tournée VIDE, réintroduisant en silence le
    // bug d'origine). Rejeu présumé sûr : même hypothèse que dispatch/validate (déjà
    // rejoués inconditionnellement) — si le PUT n'était PAS idempotent, un 2e appel
    // échouerait BRUYAMMENT (retry/DLQ + alerte), jamais en silence.
    if (!dejaRattachee) {
      await this.client.addCustomerOrderToTour(
        tourId,
        customerOrderId,
        orderNumber,
      );
    }

    // ── Étape 3 : dispatch ──────────────────────────────────────────────────────
    const carrierCode = this.transporteur.code_transporteur_mts1;
    if (!carrierCode) {
      throw new LogistiquePermanentError(
        `transporteur ${this.transporteur.id} sans code_transporteur_mts1`,
      );
    }
    await this.client.dispatchTour(tourId, carrierCode, orderNumber);

    // ── Étape 4 : validate ──────────────────────────────────────────────────────
    await this.client.validateTour(tourId, orderNumber);

    // Curseur de complétion : dispatch + validate confirmés → 'en_cours'.
    // Posé ICI (et non à l'étape 2) pour que la garde de reprise ne court-circuite
    // dispatch/validate qu'une fois ceux-ci réellement réussis (bug C2). Le
    // .eq('statut','planifiee') évite d'écraser un statut terminal qu'un poll
    // concurrent aurait déjà posé.
    await this.supabase
      .from('tournees')
      .update({ statut: 'en_cours' })
      .eq('id', tournee!.id)
      .eq('statut', 'planifiee');

    // Référence d'AFFICHAGE de la collecte (§04 Data Model l.1509, §06.06 bouton
    // « Renvoyer au TMS », §11 carte « Collectes non transmises »). Posée au rang 1
    // seulement : une collecte multi-camions a N tours, le CDC ne prévoit qu'un
    // identifiant de rapprochement. JAMAIS un prédicat : l'émission de E2 se décide
    // sur l'existence d'une commande (fn_collecte_commandee_chez_provider).
    // Posée ICI, après validate (et non dès que tourId est connu) : sinon un échec
    // en étape 2bis/3/4 laisserait la fiche afficher « Renvoyer au TMS » sur une
    // collecte dont le camion n'est pas commandé (revue sécurité 2026-09-15).
    if (rang === 1) {
      await this.updateCollecteRef(collecte.id, tourId);
    }

    // Mise à jour statut_tms (trigger dérive collectes.statut)
    await this.updateStatutTms(collecte.id, 'attribuee_en_attente_acceptation');
    return 'adapter_mts1';
  }

  // ─── E2 collecte.modifiee ────────────────────────────────────────────────────

  async updateCollecte(
    collecte: Collecte,
    opts?: { requiresReconciliation?: boolean },
  ): Promise<ConsumerTag> {
    const tournees = await this.findTournees(collecte.id);
    const avecRef = tournees.filter((t) => t.external_ref_commande);

    // Pas encore envoyé à MTS-1 → no-op succès (consumer noop_no_remote).
    // E1 (collecte.creee) dispatchera lui-même les N rangs ; une E2 antérieure au
    // dispatch n'a rien à mettre à jour ni à créer/supprimer.
    if (avecRef.length === 0) {
      return 'noop_no_remote';
    }

    const n = collecte.nb_camions_demande;

    // BL-P1-RM-04 — réduction N→N−k : supprimer sélectivement les rangs au-delà de N
    // (customerOrder MTS-1 + tournée + lien collecte_tournees). Le gate <1h de la
    // réduction est appliqué en amont par fn_modifier_collecte (RM-05) : si l'E2
    // arrive ici, la réduction est autorisée. Jamais de sur-dispatch fantôme.
    for (const t of tournees.filter((t) => t.rang > n)) {
      await this.deleteTourneeRang(collecte, t);
    }

    // Rangs conservés (≤ N) déjà envoyés à MTS-1 → PUT pour propager la modification.
    const updatePayload = this.buildUpdatePayload(collecte);
    const aModifier = avecRef.filter((t) => t.rang <= n);
    // A4 : sur reprise (requiresReconciliation), confirmer que chaque commande
    // existe encore chez MTS-1 avant le PUT. Par son IDENTIFIANT, pas par une
    // fenêtre de dates autour de la collecte : E2 vient peut-être d'en changer
    // la date, et la commande est encore à l'ancienne chez MTS-1 — une fenêtre
    // la manquerait, et la modification serait close sans avoir été envoyée.
    const connues = opts?.requiresReconciliation
      ? await this.commandesConnues(aModifier)
      : null;
    const disparues: TourneeRow[] = [];
    for (const t of aModifier) {
      if (connues && !connues.has(t.external_ref_commande!)) {
        disparues.push(t);
        continue;
      }
      await this.client.updateOrder(
        t.external_ref_commande!,
        updatePayload,
        this.orderNumber(collecte, t.rang, t),
      );
    }
    // Une commande disparue n'est PAS un succès : la modification n'a atteint
    // personne pour ce rang, et plus aucun camion n'y est commandé. Échec
    // définitif (donc alerte), une fois les commandes encore là mises à jour.
    // Les rangs manquants (augmentation, ci-dessous) ne sont alors pas créés.
    if (disparues.length > 0) {
      throw new LogistiquePermanentError(
        `collecte ${collecte.id} : commande introuvable chez MTS-1 pour ${disparues
          .map((t) => `le rang ${t.rang} (${t.external_ref_commande})`)
          .join(', ')} — la modification n'a pas été transmise`,
      );
    }

    // BL-P1-RM-03 — augmentation N→N+k : mener à terme, via dispatchCollecte
    // (idempotent, repart des curseurs du rang, clé d'idempotence
    // reference-{rang}), tout rang de 1..N qui n'est pas servi. Une grosse
    // collecte dont Ops augmente N est ainsi entièrement servie. La boucle joue
    // à CHAQUE modification, pas seulement quand N augmente.
    // Servi = une commande ET une tournée sortie de 'planifiee' (statut posé
    // après la validation). « Sans commande » et non « sans tournée » : un rang
    // refusé puis réattribué garde sa tournée, réinitialisée par
    // fn_dispatcher_collecte (arbitrage Val 2026-09-17) — il doit repartir.
    // « Encore planifiee » : un rang dont l'envoi a été interrompu après la
    // création de sa commande. Tenu pour servi, il n'était jamais repris par la
    // reprise de la modification, et son camion n'était pas envoyé.
    const rangsServis = new Set(
      avecRef.filter((t) => t.statut !== 'planifiee').map((t) => t.rang),
    );
    for (let rang = 1; rang <= n; rang++) {
      if (!rangsServis.has(rang)) {
        await this.dispatchCollecte(collecte, rang, {
          requiresReconciliation: opts?.requiresReconciliation,
        });
      }
    }

    return 'adapter_mts1';
  }

  // Suppression d'un rang retiré (RM-04) : annule la commande MTS-1 (idempotent sur
  // 404) puis purge les lignes DB (pesées éventuelles, lien, tournée).
  private async deleteTourneeRang(
    collecte: Collecte,
    t: TourneeRow,
  ): Promise<void> {
    if (t.external_ref_commande) {
      try {
        await this.client.deleteOrder(
          t.external_ref_commande,
          this.orderNumber(collecte, t.rang, t),
        );
      } catch (err) {
        // 404 = commande déjà supprimée côté MTS-1 → DELETE idempotent, on continue
        // le nettoyage DB. Toute autre erreur remonte (le rang reste à re-traiter).
        if (
          !(
            err instanceof LogistiquePermanentError &&
            err.message.includes('MTS-1 404')
          )
        ) {
          throw err;
        }
      }
    }
    // Purge DB (enfants avant parent pour respecter les FK). Une réduction survient
    // avant la mission (gate <1h RM-05) → pas de pesées en pratique, delete défensif.
    await this.supabase.from('pesees_tournees').delete().eq('tournee_id', t.id);
    await this.supabase
      .from('collecte_tournees')
      .delete()
      .eq('collecte_id', collecte.id)
      .eq('tournee_id', t.id);
    await this.supabase.from('tournees').delete().eq('id', t.id);
  }

  // ─── E3 collecte.annulee ─────────────────────────────────────────────────────

  async cancelCollecte(
    collecte: Collecte,
    opts?: { requiresReconciliation?: boolean },
  ): Promise<ConsumerTag> {
    const tournees = await this.findTournees(collecte.id);
    const avecRef = tournees.filter((t) => t.external_ref_commande);

    // Pas encore envoyé à MTS-1 → no-op succès (consumer noop_no_remote)
    if (avecRef.length === 0) {
      return 'noop_no_remote';
    }

    // A4 : sur reprise après timeout (requiresReconciliation), le 1er DELETE a
    // pu aboutir côté MTS-1. On lit d'abord quelles commandes existent encore,
    // par IDENTIFIANT : une commande que cette lecture ne rend pas est tenue
    // pour déjà annulée, et aucun DELETE n'est renvoyé. Mesuré le 2026-10-13 sur
    // le compte de démonstration, avec une commande de test sans tour, créée
    // puis supprimée : le DELETE répond 200 et passe la commande `CANCELED` ;
    // elle n'est alors plus rendue par cette lecture (le détail, lui, la rend
    // encore, `CANCELED`) ; un second DELETE répond 200 aussi. Un identifiant
    // inconnu est absent de même, et les 72 commandes que rend la recherche par
    // dates (2020 à 2030) sont toutes rendues par identifiant. Non mesuré : une
    // commande déjà placée sur un tour, ou à moins d'une heure de sa mission.
    // C'est le seul chemin qui se ferme en succès sans rien envoyer : il est
    // tracé.
    const connues = opts?.requiresReconciliation
      ? await this.commandesConnues(avecRef)
      : null;
    for (const t of avecRef) {
      if (connues && !connues.has(t.external_ref_commande!)) {
        await this.supabase.from('integrations_logs').insert({
          integration: 'mts1',
          direction: 'sortant',
          methode: 'GET',
          endpoint: '/v3/customerOrders',
          correlation_id: this.orderNumber(collecte, t.rang, t),
          erreur: `ANNULATION_SANS_DELETE: commande ${t.external_ref_commande} absente chez MTS-1 à la reprise, tenue pour déjà annulée`,
        });
        continue;
      }
      try {
        await this.client.deleteOrder(
          t.external_ref_commande!,
          this.orderNumber(collecte, t.rang, t),
        );
      } catch (err) {
        if (
          err instanceof LogistiquePermanentError &&
          err.message.includes('MTS-1 404')
        ) {
          // A4 : 404 = ordre déjà supprimé (DELETE idempotent) → annulation
          // RÉUSSIE. Surtout PAS « fenêtre fermée » : on continue sans erreur.
          // (À tester avant le test 4xx générique : 'MTS-1 404'.includes('MTS-1 4').)
          continue;
        }
        if (
          err instanceof LogistiquePermanentError &&
          err.message.includes('MTS-1 4')
        ) {
          // Autre 4xx (409/422…) sur annulation = fenêtre fermée (< 1h) → bascule Ops.
          throw new CancelWindowClosedError(
            `Annulation bloquée MTS-1 pour tournée ${t.id} : ${err.message}`,
          );
        }
        throw err;
      }
    }
    return 'adapter_mts1';
  }

  // ─── E5 lieu.champ_critique_modifie ──────────────────────────────────────────

  async updateLieu(lieu: Lieu): Promise<void> {
    // Collectes futures non terminales pour ce lieu
    // Le lieu est porté par l'événement parent (collectes n'a pas de lieu_id) →
    // filtre via la jointure evenements.lieu_id (fix M1.5a 2026-06-26). Les contacts
    // ne servent pas ici (le payload updateOrder ne pousse que l'adresse).
    const { data: collectes, error: errCollectes } = await this.supabase
      .from('collectes')
      .select(
        `
        id, nb_camions_demande, date_collecte, heure_collecte, type,
        controle_acces_requis, informations_supplementaires, lieu_overrides,
        evenements!inner(lieu_id),
        collecte_tournees!inner(tournee_id, rang, tournees!inner(id, external_ref_commande, tms_reference, statut, prestataire_logistique_id))
      `,
      )
      .eq('evenements.lieu_id', lieu.id)
      .gte('date_collecte', jourParis())
      .not('statut', 'in', FILTRE_STATUTS_COLLECTE_TERMINAUX);

    // Une erreur de lecture n'est PAS « rien à propager » : sans ce throw, l'event
    // E5 serait marqué `done` avec le consumer `adapter_mts1` (outbox-worker
    // `markDone`) alors qu'aucun transporteur n'a reçu la nouvelle adresse — un
    // no-op indistinguable d'un dispatch réussi, sans retry ni alerte, et le
    // camion se présente à l'ancienne adresse. Transient (et non Permanent) : le
    // worker rejoue alors ses 3 paliers plutôt qu'un dead immédiat sur un blip.
    if (errCollectes) {
      throw new LogistiqueTransientError(
        `E5 : lecture des collectes du lieu ${lieu.id} échouée — ${errCollectes.message}`,
      );
    }

    if (!collectes?.length) return;

    // Un lieu est partagé par toutes les collectes qui s'y tiennent, quel que soit
    // leur transporteur : ce lot peut donc mélanger des tournées MTS-1 et des
    // tournées Everest (collecte AG en vélo cargo). On ne pousse qu'aux premières.
    const prestatairesMts1 = await this.prestatairesMts1();

    for (const c of collectes) {
      // §05 R_lieu_modif_pending point 4 — le snapshot d'une collecte qui porte
      // un override est FIGÉ sur les champs surchargés : une édition Admin
      // ultérieure du lieu officiel ne doit pas écraser la correction saisie par
      // le traiteur, sinon le camion repart à l'adresse de référence.
      //
      // Le figeage est PAR CHAMP, pas par collecte : une correction de l'entrée
      // logistique (`adresse_acces`) ne doit pas bloquer la propagation d'un
      // code postal corrigé au référentiel. On recompose donc l'adresse en
      // fusionnant le lieu officiel à jour avec les seuls champs surchargés.
      const overrides = (c as unknown as CollecteLieuOverridesRow)
        .lieu_overrides;
      // Adresse intégralement surchargée → la valeur recomposée est identique à
      // celle déjà transmise en E1 : rien à propager, pas de PUT inutile.
      if (
        CHAMPS_ADRESSE_TMS.every((champ) =>
          lieuChampSurcharge(overrides, champ),
        )
      ) {
        continue;
      }
      const lieuEffectif = applyLieuOverrides(lieu, overrides);

      // Cardinalité PostgREST : la FK est portée par la table SOURCE
      // (`collecte_tournees.tournee_id` → `tournees.id`) → l'embed `tournees`
      // est un OBJET, jamais un tableau. Seul le sens inverse (`collectes` →
      // `collecte_tournees`, FK entrante) donne un tableau. Ancrage statique :
      // `embed-cardinalite.test.ts`.
      type CtRow = { rang: number; tournees: TourneeRow };
      const tourneesCollecte = (
        (c.collecte_tournees ?? []) as unknown as CtRow[]
      ).map((ct) => ({ ...ct.tournees, rang: ct.rang }));
      // Même cloisonnement que findTournees (E1/E2/E3) : une seule
      // implémentation du filtre provider pour les quatre chemins.
      const tourneesMts1 = await retenirTourneesDuProvider({
        supabase: this.supabase,
        typeTms: 'mts1',
        prestataires: prestatairesMts1,
        collecteId: c.id as string,
        tournees: tourneesCollecte,
      });
      for (const t of tourneesMts1.filter(
        (t: TourneeRow): t is TourneeRow & { external_ref_commande: string } =>
          // `typeof === 'string'` et pas `!== null` : une colonne absente du
          // `select` remonte `undefined`, qui passerait un test de nullité et
          // ferait partir un `updateOrder` sur `undefined`/`''`. (Le volet
          // provider du filtre est dans retenirTourneesDuProvider.)
          typeof t.external_ref_commande === 'string' &&
          t.external_ref_commande !== '',
      )) {
        const orderNumber = `${c.id}-${t.rang}`;
        await this.client.updateOrder(
          t.external_ref_commande,
          {
            place: {
              address: {
                addressSingleLine: `${lieuEffectif.adresse_acces}, ${lieuEffectif.code_postal} ${lieuEffectif.ville}`,
              },
            },
          },
          orderNumber,
        );
      }
    }
  }

  /**
   * Prestataires logistiques joignables par MTS-1 (`transporteurs.type_tms='mts1'`)
   * — cf. provider-tournees.ts.
   *
   * Chargé une fois par instance d'adapter : le référentiel est stable sur la
   * durée d'un event, que celui-ci lise les tournées une fois (E3) ou plusieurs
   * (E2 → findTournees puis dispatchCollecte des rangs manquants ; E5 → une
   * lecture par collecte du lieu). Seul un Set NON VIDE est mémorisé : une
   * lecture en échec comme un référentiel vide lèvent (Transient) et seront
   * rejoués par le worker — mémoïser un Set vide ferait taire le filtre.
   */
  private async prestatairesMts1(): Promise<Set<string>> {
    this.prestatairesMts1Cache ??= await prestatairesDuType(
      this.supabase,
      'mts1',
    );
    return this.prestatairesMts1Cache;
  }

  private prestatairesMts1Cache?: Set<string>;

  // ─── sync — polling entrant MTS-1 (M1.5b) ───────────────────────────────────

  async sync(fenetre: FenetreSync): Promise<void> {
    // Charge le référentiel une fois par run (stable)
    const fluxById = await this.loadFluxCodes();
    const seuils = await this.loadSeuils();

    // GET /v3/customerOrders ne filtre que par JOUR entier (« yyyy-MM-dd », bornes
    // incluses, jour compté à Paris — mesuré le 2026-10-13) : la fenêtre
    // d'instants du cron est élargie aux jours qu'elle touche. Envoyer les
    // instants eux-mêmes faisait répondre 500 à MTS-1 à chaque passage.
    const orders = await this.client.scanOrdersByDateRange(
      jourParis(fenetre.depuis),
      jourParis(fenetre.jusqu_a),
    );

    for (const order of orders) {
      try {
        await this.processOrder(order, fluxById, seuils);
      } catch (err) {
        await this.logEntrantError(
          'SYNC_ORDER_FAILED',
          `order ${order.customerOrderId}: ${String(err)}`,
        );
      }
    }
  }

  private async processOrder(
    order: Mts1CustomerOrder,
    fluxById: Map<string, string>,
    seuils: { min: number; max: number },
  ): Promise<void> {
    // 1. Réservation du STATUT — dédup intra-run et inter-polls sur le même
    // statut. `null` : ce statut est déjà entièrement traité. Le tour, lui, est
    // relu à chaque passage (étape 4).
    const inboxId = await this.reserverStatut(order);

    try {
      // 2. Trouver la tournée liée à cet ordre
      const tourneeInfo = await this.findTourneeByOrderId(
        order.customerOrderId,
      );
      if (!tourneeInfo) {
        // Commande MTS-1 sans tournée Savr associée → on l'ignore (pas dans notre système)
        if (inboxId) await this.markInboxDone(inboxId);
        return;
      }
      const {
        collecteId,
        tourneeId,
        tourneeStatut,
        tmsReference,
        collecteStatut,
      } = tourneeInfo;
      const enExecution = (
        STATUTS_COLLECTE_EN_EXECUTION as readonly string[]
      ).includes(collecteStatut);

      if (inboxId) {
        // 3. Mise à jour statut_tms — seulement sur une collecte en cours
        // d'exécution. Garde dans le WHERE (le statut lu plus haut peut avoir
        // changé) : un ordre CANCELED/KO remonté après une annulation Savr ne
        // réécrit pas le statut_tms d'une collecte annulée ou en demande
        // d'annulation (arbitrage Val 2026-09-17).
        const nouveauStatutTms =
          MTS1_STATUS_TO_TMS[order.customerOrderStatus] ?? null;
        if (nouveauStatutTms) {
          await this.supabase
            .from('collectes')
            .update({
              statut_tms: nouveauStatutTms,
              statut_tms_at: new Date().toISOString(),
            })
            .eq('id', collecteId)
            .in('statut', [...STATUTS_COLLECTE_EN_EXECUTION]);
        }

        // IN_PROGRESSION → passage direct collectes.statut → 'en_cours'
        if (
          order.customerOrderStatus === 'IN_PROGRESSION' &&
          ['programmee', 'validee'].includes(collecteStatut)
        ) {
          await this.supabase
            .from('collectes')
            .update({ statut: 'en_cours' })
            .eq('id', collecteId)
            .in('statut', ['programmee', 'validee']);
        }
      }

      // 4. Détail du tour, relu à CHAQUE passage (décision Val 2026-10-13, §08
      // §3bis.7), que le statut de la commande ait changé ou non : une pesée
      // corrigée ou une photo arrivée après la fin du tour doit être vue. Le tour
      // lu est celui que la commande désigne (`currentTour.tourId`, cohérent sur
      // le compte de démonstration le 2026-10-13), à défaut celui qu'a créé
      // l'envoi : sur la collecte de test à deux camions, la commande du rang 2
      // est sur le tour du rang 1, et le sien est vide.
      const tourDesigne = order.currentTour?.tourId;
      const tourId =
        typeof tourDesigne === 'string' && tourDesigne !== ''
          ? tourDesigne
          : tmsReference;
      const lecture = tourId
        ? await this.processTourDetails(
            tourId,
            order.customerOrderId,
            tourneeId,
            collecteId,
            collecteStatut,
            fluxById,
            seuils,
          )
        : null;

      // 5. Fin de mission du camion → tournée terminale, puis agrégation de la
      // collecte (M1.8/M1.5c). Deux lectures de la fin (décision Val 2026-10-13) :
      //   - le statut de la commande, traité une fois, à son arrivée : `OK` /
      //     `PARTIAL` (succès réel, as-built §7), `CANCELED` / `KO` (refus) ;
      //   - `FINISHED` sur l'arrêt d'enlèvement, quel que soit le statut : sur les
      //     3 tours terminés du compte de démonstration, la commande est `OK` une
      //     fois, `VALIDATED` une fois, `ARCHIVED` une fois. Lue à chaque passage,
      //     elle ne joue que tant que la collecte est en cours d'exécution.
      const statutCommande = order.customerOrderStatus;
      const refusee = statutCommande === 'CANCELED' || statutCommande === 'KO';
      const finParStatut =
        inboxId !== null &&
        (statutCommande === 'OK' || statutCommande === 'PARTIAL');
      const finParArret =
        !refusee && lecture?.missionTerminee === true && enExecution;

      if ((refusee && inboxId !== null) || finParStatut || finParArret) {
        const nouveauStatutTournee = refusee ? 'annulee' : 'terminee';
        if (tourneeStatut !== nouveauStatutTournee) {
          const { error: erreurTournee } = await this.supabase
            .from('tournees')
            .update({ statut: nouveauStatutTournee })
            .eq('id', tourneeId);
          if (erreurTournee) {
            throw new LogistiqueTransientError(
              `Tournée ${tourneeId} non passée « ${nouveauStatutTournee} » — ${erreurTournee.message}`,
            );
          }
        }

        const agrResultat = await this.agregerCollecte(collecteId);

        // KO partiel : ce tour était KO/CANCELED mais d'autres étaient OK → alerte in-app
        if (agrResultat === 'realisee' && refusee) {
          await this.supabase.rpc('f_upsert_alerte_admin', {
            p_code: 'collecte_partiellement_servie',
            p_titre: 'Collecte partiellement servie',
            p_message: `Un camion n'a pas pu collecter (statut MTS-1 ${statutCommande}).`,
            p_entity_type: 'collectes',
            p_entity_id: collecteId,
          });
        }
      } else if (lecture?.peseesModifiees && collecteStatut === 'realisee') {
        // Pesée arrivée ou corrigée après la fin du tour, avant la clôture :
        // `collecte_flux` est un dérivé, que seule l'agrégation recalcule.
        await this.agregerCollecte(collecteId);
      }

      // 6. Photos, en dernier, à chaque passage, après le traitement de la fin de
      // mission : une photo lente ou en échec ne retarde ni les pesées ni la fin
      // de mission (non bloquant, retentée au passage suivant).
      if (lecture && tourId) {
        await this.processPhotos(
          lecture.tour,
          tourId,
          order.customerOrderId,
          collecteId,
        );
      }

      if (inboxId) await this.markInboxDone(inboxId);
    } catch (err) {
      if (inboxId) {
        await this.supabase
          .from('integrations_inbox')
          .update({ erreur: String(err) })
          .eq('id', inboxId);
      }
      throw err;
    }
  }

  /**
   * Réserve le traitement d'un STATUT de commande — clé `(source, commande,
   * statut)` dans integrations_inbox (§08 §3bis.7). Rend l'identifiant de la
   * ligne à traiter, ou `null` si ce statut est déjà entièrement traité.
   *
   * INSERT nu : l'index unique `uniq_inbox_event_externe` arbitre, de deux
   * passages qui découvrent le même statut un seul insère et l'autre reçoit
   * 23505 (OUTBOX-04, pas de lecture-puis-écriture). Ce n'est pas une exclusion :
   * le second rejoue le statut tant qu'il n'est pas marqué traité (effets
   * idempotents), et la relève n'a pas de verrou de passage. ⚠ Pas
   * d'`upsert … onConflict` : cet index est
   * PARTIEL (`WHERE event_id_externe IS NOT NULL`) et PostgreSQL ne l'infère pas
   * sans son prédicat. Mesuré le 2026-10-13 sur la base locale, en SQL comme par
   * l'API : 42P10, « no unique or exclusion constraint matching the ON CONFLICT
   * specification ». Écrite en upsert, la réservation échouait pour chaque
   * commande sur une base réelle, et rien n'était relevé.
   *
   * Toute autre erreur que 23505 remonte (réseau, contrainte tierce) : la lire
   * comme « déjà traité » perdrait le statut sans trace (§08 §3bis.7, R10).
   */
  private async reserverStatut(
    order: Mts1CustomerOrder,
  ): Promise<string | null> {
    const eventKey = `mts1:${order.customerOrderId}:${order.customerOrderStatus}`;
    const { data: reservee, error } = await this.supabase
      .from('integrations_inbox')
      .insert({
        source: 'mts1',
        event_type: 'order_status',
        event_id_externe: eventKey,
        payload: {
          orderId: order.customerOrderId,
          status: order.customerOrderStatus,
        },
      })
      .select('id')
      .limit(1);

    if (!error) {
      const id = reservee?.[0]?.id as string | undefined;
      if (!id) {
        throw new Error(
          `integrations_inbox : réservation de ${eventKey} sans ligne rendue`,
        );
      }
      return id;
    }
    if (error.code !== '23505') {
      throw new Error(
        `integrations_inbox claim échoué (${error.code ?? '?'}): ${error.message}`,
      );
    }

    // A4-A2 : la clé existe déjà. On NE saute le statut QUE s'il a été
    // ENTIÈREMENT traité (traite=true). Sinon — crash d'un run précédent entre
    // l'upsert des pesées et markInboxDone — la simple présence de la clé
    // faisait sauter le statut à jamais : la collecte ne passait jamais realisee
    // (ni batch J+1, ni bordereau). On REJOUE tant que traite=false : tous les
    // effets sont idempotents (update statut par id, upsert pesées par clé,
    // agrégation FOR UPDATE), donc le rejeu est sûr et finit par confirmer le
    // traitement.
    const { data: existing } = await this.supabase
      .from('integrations_inbox')
      .select('id, traite')
      .eq('source', 'mts1')
      .eq('event_id_externe', eventKey)
      .maybeSingle();

    if (!existing || existing.traite === true) return null;
    return existing.id as string;
  }

  // Agrégation concurrente-sûre de la collecte : RPC avec FOR UPDATE (R5/R6
  // CLAUDE.md §4). Idempotente : rappelée sur une collecte déjà « réalisée », elle
  // ne fait que recalculer `collecte_flux` depuis les pesées, et rien du tout
  // après clôture.
  private async agregerCollecte(collecteId: string): Promise<unknown> {
    const { data, error } = await this.supabase
      .rpc('fn_agreger_terminal_collecte', { p_collecte_id: collecteId })
      .single();
    if (error) {
      throw new LogistiqueTransientError(
        `Agrégation de la collecte ${collecteId} échouée — ${error.message}`,
      );
    }
    return data;
  }

  /**
   * Détail d'un tour, pour UNE commande : plaque et chauffeur, pesées de son
   * arrêt d'enlèvement. Rend le tour (ses photos sont relevées en dernier, après
   * le traitement de la fin de mission), et dit si la mission de la commande est terminée (`FINISHED` sur
   * l'arrêt d'enlèvement) et si une pesée a été écrite ou modifiée.
   */
  private async processTourDetails(
    tourId: string,
    customerOrderId: string,
    tourneeId: string,
    collecteId: string,
    collecteStatut: string,
    fluxById: Map<string, string>,
    seuils: { min: number; max: number },
  ): Promise<{
    tour: Mts1Tour;
    missionTerminee: boolean;
    peseesModifiees: boolean;
  }> {
    const tour = await this.client.getTour(tourId);

    // BL-P1-API-03 — résoudre plaque + chauffeur depuis le référentiel carrier.
    await this.resolveCarrierForTournee(tour, tourneeId);

    // `stops` est absent quand MTS-1 ne connaît pas le tour (200 avec un objet
    // creux) et vide pour un tour sans commande : dans les deux cas aucun arrêt
    // ne sert la commande, rien n'est lu et le traitement du statut continue.
    const enlevement = arretEnlevement(tour, customerOrderId);
    const peseesModifiees = enlevement
      ? await this.relevePesees(
          enlevement,
          tourneeId,
          collecteId,
          collecteStatut,
          fluxById,
          seuils,
        )
      : false;

    return {
      tour,
      missionTerminee: (enlevement?.customerOrders ?? []).some(
        (c) =>
          c?.customerOrderId === customerOrderId &&
          c.customerOrderProgressionStatus === 'FINISHED',
      ),
      peseesModifiees,
    };
  }

  /**
   * Pesées de l'arrêt d'enlèvement → `pesees_tournees`, clé `(tournée, arrêt,
   * flux)`. Rend `true` si une pesée a été écrite ou modifiée.
   *
   * Le poids d'un flux est `quantityAfterPickup` (décision Val 2026-10-13 ;
   * mesuré sur UN tour de déchets terminé : 17, 2, 35, 9 et 19 kg, `quantity` et
   * `measurement.weight` à 0 ; non recoupé avec ce que lit Bubble). `null` : le
   * chauffeur n'a rien saisi. 0 : flux non pesé, aucune ligne (décision Val
   * 2026-10-13) — un tour validé sans saisie ne doit pas produire un bordereau à
   * 0 kg ; ce que MTS-1 renvoie dans ce cas n'est pas mesuré.
   *
   * Relue à chaque passage : une pesée inchangée n'écrit rien et ne lève aucune
   * alerte ; une pesée nouvelle ou modifiée écrase la précédente tant que la
   * collecte n'est pas clôturée.
   */
  private async relevePesees(
    enlevement: Mts1TourStop,
    tourneeId: string,
    collecteId: string,
    collecteStatut: string,
    fluxById: Map<string, string>,
    seuils: { min: number; max: number },
  ): Promise<boolean> {
    const stopId = enlevement.stopId;
    // Par flux : un même flux répété sur l'arrêt (jamais mesuré, Savr n'envoie
    // chaque flux qu'une fois) garde sa dernière valeur, plutôt que d'en écrire
    // deux à tour de rôle à chaque passage.
    const lues = new Map<
      string,
      { fluxId: string; fluxCode: string; poids: number }
    >();
    for (const stuff of enlevement.stuffs ?? []) {
      if (!stuff) continue;
      const fluxCode = STUFF_TO_FLUX[stuff.name];

      // Camion, don alimentaire → ignorer silencieusement
      if (fluxCode === '_ignore') continue;

      // Stuff inconnu → trace
      if (fluxCode === undefined) {
        await this.logEntrantError(
          'STUFF_INCONNU',
          `tournee=${tourneeId} stop=${stopId} stuff="${stuff.name}"`,
        );
        continue;
      }

      const fluxId = fluxById.get(fluxCode);
      const poids = stuff.quantityAfterPickup;
      if (!fluxId || typeof poids !== 'number' || !(poids > 0)) continue;
      lues.set(fluxId, { fluxId, fluxCode, poids });
    }
    if (lues.size === 0) return false;

    const { data: existantes, error: erreurLecture } = await this.supabase
      .from('pesees_tournees')
      .select('flux_id, poids_kg')
      .eq('tournee_id', tourneeId)
      .eq('stop_id', stopId);
    if (erreurLecture) {
      throw new LogistiqueTransientError(
        `Lecture des pesées de la tournée ${tourneeId} échouée — ${erreurLecture.message}`,
      );
    }
    const locales = new Map(
      (existantes ?? []).map((p) => [p.flux_id as string, Number(p.poids_kg)]),
    );

    let modifiees = false;
    for (const { fluxId, fluxCode, poids } of lues.values()) {
      const local = locales.get(fluxId);
      if (local !== undefined && Math.abs(local - poids) <= 0.001) continue;

      // Collecte clôturée → aucune écriture (R7). Le poids distant qui diffère du
      // poids local (ou qui n'a pas de poids local) est signalé UNE fois par
      // valeur : relue toutes les 15 minutes, la même divergence rouvrirait
      // l'alerte à chaque passage après que l'Admin l'a traitée.
      if (collecteStatut === 'cloturee') {
        const cle = `mts1:divergence:${tourneeId}:${stopId}:${fluxId}:${poids}`;
        if (await this.premiereFois('pesee_divergence_post_cloture', cle)) {
          const poidsLocal = local === undefined ? 'aucun' : `${local} kg`;
          // BL-P2-37 : 2 sorties attendues (§08 §3bis.7) — trace technique
          // integrations_logs ET alerte Ops in-app (sans ce signal, la vérité
          // MTS-1 diverge silencieusement du bordereau réglementaire).
          await this.logEntrantError(
            'PESEE_DIVERGENCE_POST_CLOTURE',
            `tournee=${tourneeId} stop=${stopId} flux=${fluxCode} local=${poidsLocal} distant=${poids}`,
          );
          await this.supabase.rpc('f_upsert_alerte_admin', {
            p_code: 'pesee_divergence_post_cloture',
            p_titre: 'Divergence pesée post-clôture',
            p_message: `Poids MTS-1 (${poids} kg) ≠ poids local (${poidsLocal}) sur une collecte clôturée — tournée ${tourneeId} stop ${stopId} flux ${fluxCode}. Correction = édition + recalcul + avoir (§05).`,
            p_entity_type: 'collectes',
            p_entity_id: collecteId,
          });
        }
        continue;
      }

      // Upsert pesée (idempotent — écrasement si poids modifié). L'erreur est
      // lue : une pesée non écrite passée sous silence, c'est un bordereau faux.
      const { error: erreurEcriture } = await this.supabase
        .from('pesees_tournees')
        .upsert(
          {
            tournee_id: tourneeId,
            stop_id: stopId,
            flux_id: fluxId,
            poids_kg: poids,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'tournee_id,stop_id,flux_id' },
        );
      if (erreurEcriture) {
        throw new LogistiqueTransientError(
          `Pesée non écrite (tournée ${tourneeId}, flux ${fluxCode}) — ${erreurEcriture.message}`,
        );
      }
      modifiees = true;

      // Alerte in-app si pesée hors seuil (pas d'email, pas de Slack — §13 CLAUDE.md)
      if (poids < seuils.min || poids > seuils.max) {
        await this.supabase.rpc('f_upsert_alerte_admin', {
          p_code: 'pesee_hors_seuil',
          p_titre: 'Pesée hors seuil',
          p_message: `Poids ${poids} kg hors seuil [${seuils.min}–${seuils.max}] — tournée ${tourneeId} stop ${stopId}.`,
          p_entity_type: 'collectes',
          p_entity_id: collecteId,
        });
      }
    }
    return modifiees;
  }

  // `true` la première fois qu'un signal de cette clé est posé, `false` ensuite.
  // La mémoire est integrations_inbox, la table de dédup des événements entrants
  // (même INSERT nu que reserverStatut, 23505 = déjà signalé). Dans le doute
  // (autre erreur), on signale. Cette mémoire, comme les réservations de statut,
  // est purgée à 7 jours : elle tient tant que la fenêtre de relève (cron
  // polling-mts1) reste plus courte.
  private async premiereFois(eventType: string, cle: string): Promise<boolean> {
    const maintenant = new Date().toISOString();
    const { error } = await this.supabase.from('integrations_inbox').insert({
      source: 'mts1',
      event_type: eventType,
      event_id_externe: cle,
      payload: {},
      traite: true,
      traite_at: maintenant,
    });
    return error?.code !== '23505';
  }

  // BL-P1-API-03 — peuple tournees.plaque_immatriculation + chauffeur_nom (+ le
  // téléphone chauffeur SI l'API l'expose) à partir du référentiel carrier (la
  // plaque n'est PAS sur le tour, as-built §6). Algo :
  //   plaque    : dispatch.vehicleShareableCode        → vehicles[].numberPlate
  //   chauffeur : dispatch.transporterUserShareableCode → transporters[].firstname+lastname
  //   téléphone : transporters[].phone (OPTIONNEL — as-built §6 : MTS-1 ne
  //               l'expose pas aujourd'hui → reste NULL, saisi manuellement par
  //               l'Admin fiche collecte, qui déclenche l'email « infos accès »).
  // Accompagnant (accompagnant_nom/_telephone) : NON exposé par MTS-1 (1 seul
  //   transporteur par dispatch) → saisie Admin uniquement en V1. Le point
  //   d'extension est ici : un futur provider renseignerait ces colonnes via le
  //   même bloc `updates` idempotent (décision Val #2 « structurer sans câbler »).
  // Idempotent : n'écrit que sur changement ; plaque_saisie_at posé à la 1re
  // résolution seulement (pas de churn à chaque poll). Non bloquant (audit DREAL,
  // jamais une pesée) : un échec carrier est tracé, ne casse pas le poll.
  private async resolveCarrierForTournee(
    tour: Mts1Tour,
    tourneeId: string,
  ): Promise<void> {
    const dispatch = tour.dispatch;
    const vehCode = dispatch?.vehicleShareableCode ?? null;
    const transCode = dispatch?.transporterUserShareableCode ?? null;
    if (!vehCode && !transCode) return;

    let carriers: import('./mock.js').Mts1Carrier[];
    try {
      carriers = await this.client.getCarrier();
    } catch {
      await this.logEntrantError(
        'CARRIER_FETCH_FAILED',
        `tournee=${tourneeId}`,
      );
      return;
    }

    const plaque = vehCode
      ? (carriers
          .flatMap((c) => c.vehicles ?? [])
          .find((v) => v.vehicleShareableCode === vehCode)?.numberPlate ?? null)
      : null;
    const transporter = transCode
      ? carriers
          .flatMap((c) => c.transporters ?? [])
          .find((t) => t.transporterShareableCode === transCode)
      : undefined;
    const chauffeurNom = transporter
      ? `${transporter.firstname} ${transporter.lastname}`.trim()
      : null;
    // Optionnel : capté uniquement si l'API le fournit (undefined aujourd'hui).
    const chauffeurTel = transporter?.phone?.trim() || null;

    if (!plaque && !chauffeurNom && !chauffeurTel) return;

    // Relecture du courant : idempotence + plaque_saisie_at au 1er enregistrement.
    // On ne touche JAMAIS les colonnes saisies par l'Admin qu'on ne résout pas ici
    // (téléphone si absent de l'API, accompagnant) → pas d'écrasement de la saisie.
    const { data: cur } = await this.supabase
      .from('tournees')
      .select('plaque_immatriculation, chauffeur_nom, chauffeur_telephone')
      .eq('id', tourneeId)
      .maybeSingle();
    const curPlaque = (cur?.plaque_immatriculation as string | null) ?? null;
    const curChauffeur = (cur?.chauffeur_nom as string | null) ?? null;
    const curTel = (cur?.chauffeur_telephone as string | null) ?? null;

    const updates: Record<string, unknown> = {};
    if (plaque && plaque !== curPlaque) {
      updates['plaque_immatriculation'] = plaque;
      if (!curPlaque) updates['plaque_saisie_at'] = new Date().toISOString();
    }
    if (chauffeurNom && chauffeurNom !== curChauffeur) {
      updates['chauffeur_nom'] = chauffeurNom;
    }
    if (chauffeurTel && chauffeurTel !== curTel) {
      updates['chauffeur_telephone'] = chauffeurTel;
    }
    if (Object.keys(updates).length === 0) return;

    await this.supabase.from('tournees').update(updates).eq('id', tourneeId);
  }

  /**
   * Photos de la commande : celles des arrêts du tour qui ne servent qu'elle,
   * enlèvement et dépôt (`stops[].photos[].downloadUrl` ; il n'existe pas de
   * route `GET /v3/tours/{id}/photos`, 404 `BAD_ROUTE` mesuré le 2026-10-13). Un
   * arrêt qui nomme plusieurs commandes (dépôt commun) est écarté : sa photo
   * pourrait montrer la marchandise d'une autre collecte.
   * Non bloquant : une photo en échec est tracée et retentée au passage suivant.
   */
  private async processPhotos(
    tour: Mts1Tour,
    tourId: string,
    customerOrderId: string,
    collecteId: string,
  ): Promise<void> {
    for (const stop of tour.stops ?? []) {
      if (!stop || !sertLaCommande(stop, customerOrderId)) continue;
      const commandesNommees = (stop.customerOrders ?? []).filter(
        (c) => c?.customerOrderId,
      );
      if (commandesNommees.length > 1) continue;

      for (const photo of stop.photos ?? []) {
        const stopId = stop.stopId;
        const downloadUrl = photo?.downloadUrl;
        const photoId =
          typeof downloadUrl === 'string'
            ? identifiantPhoto(downloadUrl, tourId, stopId)
            : null;
        if (!photoId) {
          await this.logEntrantError(
            'PHOTO_ADRESSE_INATTENDUE',
            `tourId=${tourId} stopId=${stopId}`,
          );
          continue;
        }
        const storageKey = clePhoto(collecteId, { tourId, stopId, photoId });

        // Dédup : photo déjà uploadée ? Une recherche en échec ne vaut pas
        // « absente » : elle re-téléverserait la photo et doublerait sa ligne.
        const { data: existante, error: erreurDedup } = await this.supabase
          .schema('shared')
          .from('fichiers')
          .select('id')
          .eq('key', storageKey)
          .maybeSingle();

        if (erreurDedup) {
          await this.logEntrantError(
            'PHOTO_DEDUP_FAILED',
            `tourId=${tourId} stopId=${stopId} photoId=${photoId}`,
          );
          continue;
        }
        if (existante) continue;

        // Téléchargement binaire
        let buffer: Buffer | null;
        try {
          buffer = await this.client.downloadPhoto(downloadUrl);
        } catch {
          await this.logEntrantError(
            'PHOTO_DOWNLOAD_FAILED',
            `tourId=${tourId} stopId=${stopId} photoId=${photoId}`,
          );
          continue;
        }

        if (buffer === null) {
          // Photo absente (corps vide) → log non bloquant, retentée au passage suivant
          await this.logEntrantError(
            'PHOTO_DOWNLOAD_FAILED',
            `absente tourId=${tourId} stopId=${stopId} photoId=${photoId}`,
          );
          continue;
        }

        // Upload R2 D'ABORD, pointeur shared.fichiers ENSUITE : si l'upload échoue
        // (credentials absents, rejet R2), on log + on saute sans INSERT → JAMAIS de
        // ligne shared.fichiers orpheline pointant un objet inexistant (BL-P0-02).
        // Non bloquant pour le poll : la photo est retentée au prochain passage.
        // Le bucket persisté est celui que l'upload a réellement écrit (bucket de
        // l'environnement) ; la clé est celle de `clePhoto`
        // (`photos/collectes/<collecteId>/<empreinte>.jpg`).
        let bucket: string;
        try {
          bucket = await this.uploadPhotoToR2(storageKey, buffer);
        } catch {
          await this.logEntrantError(
            'PHOTO_UPLOAD_FAILED',
            `tourId=${tourId} stopId=${stopId} photoId=${photoId}`,
          );
          continue;
        }

        // Enregistrement dans shared.fichiers (objet désormais réellement présent
        // sur R2). En échec, la photo sera retéléchargée au passage suivant.
        const { error: erreurEnregistrement } = await this.supabase
          .schema('shared')
          .from('fichiers')
          .insert({
            storage_provider: 'r2',
            bucket,
            key: storageKey,
            content_type: 'image/jpeg',
            size_bytes: buffer.length,
            // entity_type = table propriétaire (§04 shared.fichiers), ici la collecte :
            // même valeur que l'import manuel Admin, lue par la galerie de la fiche
            // collecte et par shared.f_fichier_visible (§09 C1). Toute autre valeur est
            // refusée par la policy et la photo n'apparaît nulle part.
            entity_type: 'plateforme.collectes',
            entity_id: collecteId,
          });
        if (erreurEnregistrement) {
          await this.logEntrantError(
            'PHOTO_ENREGISTREMENT_FAILED',
            `tourId=${tourId} stopId=${stopId} photoId=${photoId}`,
          );
        }
      }
    }
  }

  // Upload binaire vers R2 (S3-compatible) via la signature AWS Sig V4 partagée
  // (@savr/shared/src/r2/upload). La logique R2/AWS-SDK vit hors packages/adapters/
  // (garde-fou 3). `uploadObject` LÈVE en cas d'échec → l'appelant ne persiste pas
  // de pointeur orphelin. Rend le bucket écrit (celui de l'environnement).
  private async uploadPhotoToR2(key: string, buffer: Buffer): Promise<string> {
    const { bucket } = await uploadObject(key, buffer, 'image/jpeg');
    return bucket;
  }

  // ─── Helpers polling entrant (M1.5b) ─────────────────────────────────────────

  private async loadFluxCodes(): Promise<Map<string, string>> {
    const { data } = await this.supabase
      .from('flux_dechets')
      .select('id, code')
      .eq('actif', true);
    const map = new Map<string, string>();
    for (const row of data ?? []) {
      map.set(row.code as string, row.id as string);
    }
    return map;
  }

  private async loadSeuils(): Promise<{ min: number; max: number }> {
    // parametres_algo est clé-valeur JSONB (§04 Data Model).
    // Clés seedées : pesee_seuil_min_kg=5, pesee_seuil_max_kg=5000 (migration bloc8).
    const { data } = await this.supabase
      .from('parametres_algo')
      .select('cle, valeur')
      .in('cle', ['pesee_seuil_min_kg', 'pesee_seuil_max_kg']);
    const byKey = Object.fromEntries(
      (data ?? []).map((r) => [r.cle as string, r.valeur as number]),
    );
    return {
      min: byKey['pesee_seuil_min_kg'] ?? 5,
      max: byKey['pesee_seuil_max_kg'] ?? 5000,
    };
  }

  /**
   * Tournée portant ce customerOrderId — volet ENTRANT du cloisonnement.
   *
   * Symétrique du filtre sortant (`findTournees`) : `external_ref_commande` est
   * une colonne PARTAGÉE entre providers (Everest y stocke son mission_id), donc
   * la seule clé d'identification d'une tournée MTS-1 est le couple
   * (référence, prestataire de type `mts1`). Sans le volet provider, un poll
   * MTS-1 dont l'ordre porte la même référence qu'une mission Everest écrirait
   * `statut_tms`, `collectes.statut` et l'agrégation terminale sur la collecte
   * de l'AUTRE transporteur.
   *
   * Les deux gardes sont posées dans la REQUÊTE (jointure `transporteurs` +
   * `.eq('type_tms','mts1')`) et non après coup : une tournée d'un autre
   * provider n'est alors pas « trouvée puis écartée », elle n'entre jamais dans
   * le résultat — et le `.maybeSingle()` ne peut plus voir deux lignes du seul
   * fait qu'un homonyme existe chez l'autre provider.
   */
  private async findTourneeByOrderId(customerOrderId: string): Promise<{
    collecteId: string;
    tourneeId: string;
    tourneeStatut: string | null;
    tmsReference: string | null;
    collecteStatut: string;
  } | null> {
    // `prestatairesDuType` garantit un Set NON VIDE (elle lève sinon) : le `.in()`
    // ci-dessous ne peut donc jamais dégénérer en requête toujours fausse, qui
    // ferait passer tous les ordres pour inconnus.
    const prestatairesMts1 = await this.prestatairesMts1();

    const { data, error } = await this.supabase
      .from('tournees')
      .select(
        'id, statut, tms_reference, collecte_tournees!inner(collecte_id, collectes!inner(id, statut))',
      )
      .eq('external_ref_commande', customerOrderId)
      .in('prestataire_logistique_id', [...prestatairesMts1])
      .maybeSingle();

    // L'`error` n'était pas lue : `data` valait alors `null`, l'ordre passait
    // pour « sans tournée Savr » et `markInboxDone(traite=true)` consommait la
    // clé d'idempotence DÉFINITIVEMENT — pesées, statuts et agrégation terminale
    // perdus sans trace. Une collision sur `external_ref_commande` (plusieurs
    // lignes → PGRST116 sur `.maybeSingle()`) tombait dans le même trou. On lève
    // : le catch de processOrder écrit l'erreur sur la ligne d'inbox, laisse
    // `traite=false`, et le poll suivant (15 min) rejoue.
    if (error) {
      throw new LogistiqueTransientError(
        `Rapprochement de l'ordre ${customerOrderId} échoué — ${error.message}`,
      );
    }

    if (!data) return null;

    type Raw = {
      id: string;
      statut?: string | null;
      tms_reference: string | null;
      // `collecte_tournees` embarqué depuis `tournees` = FK entrante → TABLEAU.
      // `collectes` embarqué depuis `collecte_tournees` = FK sortante → OBJET.
      collecte_tournees: Array<{
        collecte_id: string;
        collectes: { id: string; statut: string };
      }>;
    };
    const raw = data as unknown as Raw;
    const ct = raw.collecte_tournees[0];
    if (!ct) return null;
    const collecte = ct.collectes;
    if (!collecte) return null;

    return {
      collecteId: collecte.id,
      tourneeId: raw.id,
      tourneeStatut: raw.statut ?? null,
      tmsReference: raw.tms_reference,
      collecteStatut: collecte.statut,
    };
  }

  private async markInboxDone(inboxId: string): Promise<void> {
    await this.supabase
      .from('integrations_inbox')
      .update({ traite: true, traite_at: new Date().toISOString() })
      .eq('id', inboxId);
  }

  private async logEntrantError(
    erreurCode: string,
    detail: string,
  ): Promise<void> {
    await this.supabase.from('integrations_logs').insert({
      integration: 'mts1',
      direction: 'entrant',
      methode: 'POLL',
      endpoint: '/v3/customerOrders',
      erreur: `${erreurCode}: ${detail}`,
    });
  }

  // ─── Helpers DB ──────────────────────────────────────────────────────────────

  /**
   * Tournée d'un rang donné — restreinte au provider courant (cf. findTournees).
   *
   * Passe par findTournees plutôt que par sa propre requête : le rang est un
   * simple critère de sélection, et le cloisonnement par provider comme la
   * lecture de `error` n'ont ainsi qu'une seule implémentation pour les deux
   * accès (E1 lit par rang, E2/E3 lisent la liste).
   */
  private async findTournee(
    collecteId: string,
    rang: number,
  ): Promise<TourneeRow | null> {
    const tournees = await this.findTournees(collecteId);
    return tournees.find((t) => t.rang === rang) ?? null;
  }

  /**
   * Tournées d'une collecte **exécutées par MTS-1**.
   *
   * Le filtre provider est posé ICI, à la source, et non dans chaque handler :
   * E1 (dispatch), E2 (update) et E3 (cancel) lisent tous les tournées par là
   * — #313 ne l'avait fermé que sur E5.
   *
   * Sans lui, une collecte re-dispatchée d'Everest vers MTS-1
   * (`collectes.prestataire_logistique_id` change ; le lien
   * `collecte_tournees` du rang, lui, pointe encore sur la tournée Everest
   * tant qu'un E1 MTS-1 ne l'a pas écrasé — `upsertTournee`,
   * `onConflict: 'collecte_id,rang'`) faisait partir vers MTS-1 un
   * `PUT`/`DELETE /v3/customerOrders/{id_mission_everest}` sur E2/E3, et sur
   * E1 la tournée Everest servait de curseur : `POST /v3/customerOrders`
   * sauté, mission Everest rattachée au tour MTS-1, et `tms_reference` MTS-1
   * écrit sur la tournée Everest.
   *
   * Arbitrage « écarter en silence vs alerter Ops » : cf. provider-tournees.ts.
   */
  private async findTournees(collecteId: string): Promise<TourneeRow[]> {
    const { data, error } = await this.supabase
      .from('collecte_tournees')
      .select(
        'rang, tournees!inner(id, reference_interne, external_ref_commande, tms_reference, statut, prestataire_logistique_id)',
      )
      .eq('collecte_id', collecteId);

    // Une lecture DB en échec n'est PAS « aucune tournée » : rendue telle
    // quelle, elle ferait re-POSTer un customerOrder déjà créé (E1) ou conclure
    // à un no-op `noop_no_remote` (E2/E3) sur une collecte pourtant dispatchée,
    // event marqué `done` sans retry ni alerte. Transient → 3 paliers du worker.
    if (error) {
      throw new LogistiqueTransientError(
        `Lecture des tournées de la collecte ${collecteId} échouée — ${error.message}`,
      );
    }

    // FK sortante `collecte_tournees.tournee_id` → embed OBJET (cf. updateLieu).
    const rows = (data ?? []) as unknown as Array<{
      rang: number;
      tournees: TourneeRow;
    }>;

    return retenirTourneesDuProvider({
      supabase: this.supabase,
      typeTms: 'mts1',
      prestataires: await this.prestatairesMts1(),
      collecteId,
      tournees: rows.map((d) => ({ ...d.tournees, rang: d.rang })),
    });
  }

  private async upsertTournee(
    collecte: Collecte,
    rang: number,
    customerOrderId: string,
    existante: TourneeRow | null,
  ): Promise<TourneeRow> {
    // Rang déjà lié à une tournée de ce provider (réattribution d'un rang
    // refusé, réinitialisé en place par fn_dispatcher_collecte) : on committe
    // la commande SUR cette tournée. L'upsert par `TMS-{collecte}-{rang}` ne la
    // retrouverait pas (sa reference_interne porte la tentative) et créerait une
    // seconde tournée, détachant la première.
    if (existante) {
      const { data: maj, error: errMaj } = await this.supabase
        .from('tournees')
        .update({
          external_ref_commande: customerOrderId,
          prestataire_logistique_id:
            this.transporteur.prestataire_logistique_id,
        })
        .eq('id', existante.id)
        .select(
          'id, reference_interne, external_ref_commande, tms_reference, statut',
        )
        .single();

      if (errMaj || !maj) {
        throw this.curseurNonEcrit(
          `commande ${customerOrderId} (rang ${rang})`,
          errMaj,
        );
      }
      return { ...existante, ...maj, rang } as TourneeRow;
    }

    const referenceInterne = `TMS-${collecte.id}-${rang}`;

    const { data: tournee, error } = await this.supabase
      .from('tournees')
      .upsert(
        {
          reference_interne: referenceInterne,
          date_tournee: collecte.date_collecte,
          creneau: 'nuit',
          prestataire_logistique_id:
            this.transporteur.prestataire_logistique_id,
          statut: 'planifiee',
          external_ref_commande: customerOrderId,
        },
        { onConflict: 'reference_interne' },
      )
      .select(
        'id, reference_interne, external_ref_commande, tms_reference, statut',
      )
      .single();

    if (error || !tournee) {
      throw this.curseurNonEcrit(
        `commande ${customerOrderId} (rang ${rang})`,
        error,
      );
    }

    // Lien collecte ↔ tournee avec rang. C'est par LUI que la reprise retrouve
    // la tournée (findTournees) : non écrit, la commande passerait pour jamais
    // créée.
    const { error: errLien } = await this.supabase
      .from('collecte_tournees')
      .upsert(
        { collecte_id: collecte.id, tournee_id: tournee.id, rang },
        { onConflict: 'collecte_id,rang' },
      );
    if (errLien) {
      throw this.curseurNonEcrit(
        `commande ${customerOrderId} (lien de la tournée, rang ${rang})`,
        errLien,
      );
    }

    return { ...tournee, rang } as TourneeRow;
  }

  // Curseur de reprise non écrit alors que l'objet existe chez MTS-1 (créé à
  // l'instant, ou retrouvé par la réconciliation). Erreur AMBIGUË, ni passagère
  // ni définitive : la reprise repasse par la réconciliation avant tout re-POST
  // (requires_reconciliation). Un simple rejeu recréerait l'objet, l'API étant
  // présumée non idempotente (CLAUDE.md §2).
  private curseurNonEcrit(
    quoi: string,
    error: { message?: string } | null,
  ): LogistiqueAmbiguousError {
    return new LogistiqueAmbiguousError(
      `MTS-1 : ${quoi} non enregistrée côté Savr — ${
        error?.message ?? 'aucune ligne écrite'
      }`,
    );
  }

  // Commit du curseur étape 2 : NE pose PAS statut='en_cours' (réservé au succès de
  // validate, étape 4). Sinon la garde de reprise (dispatchCollecte) sortirait en
  // no-op avant que dispatch+validate aient été joués → camion non commandé (bug C2).
  //
  // Écriture en échec : la tournée existe chez MTS-1 et son identifiant n'est
  // dans aucun curseur. La reprise ne la retrouvera que par sa commande
  // (reconcileTour) : on rattache donc la commande AVANT de lever, sauf si elle
  // l'est déjà. Si ce rattachement échoue, ou ne part pas (échéance du passage
  // atteinte), la tournée reste vide et sans transporteur chez MTS-1, et la
  // reprise en créera une autre : l'erreur le dit.
  //
  // Cas de l'écriture refusée par l'index unique `uniq_tournee_par_tms_reference`
  // (23505) : l'identifiant est alors dans le curseur d'une AUTRE ligne. Dans la
  // course que ferme l'index, la commande est déjà rattachée et rien ne part.
  // Limite, hors course : si MTS-1 rendait à la création un identifiant qu'une
  // autre ligne porte déjà (non mesuré), la commande serait rattachée à cette
  // tournée avant l'erreur ; la reprise crée ensuite sa propre tournée.
  private async updateTourneeRef(
    tourneeId: string,
    tourId: string,
    customerOrderId: string,
    orderNumber: string,
    dejaRattachee: boolean,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('tournees')
      .update({ tms_reference: tourId })
      .eq('id', tourneeId);
    if (!error) return;

    const rattachee =
      dejaRattachee ||
      (await this.client
        .addCustomerOrderToTour(tourId, customerOrderId, orderNumber)
        .then(
          () => true,
          () => false,
        ));
    throw this.curseurNonEcrit(
      `tournée ${tourId} (commande ${customerOrderId} ${
        rattachee ? 'rattachée' : 'NON rattachée'
      })`,
      error,
    );
  }

  // Référence lisible de la collecte pour l'affichage Admin / le rapprochement.
  // Réécriture inconditionnelle : la valeur est stable par construction (le tourId
  // du rang 1, lu depuis la tournée déjà committée sur reprise ; le rang 1 n'est
  // jamais supprimé par une réduction de N) → un rejeu réécrit la même chaîne.
  private async updateCollecteRef(
    collecteId: string,
    reference: string,
  ): Promise<void> {
    await this.supabase
      .from('collectes')
      .update({ tms_reference: reference })
      .eq('id', collecteId);
  }

  private async updateStatutTms(
    collecteId: string,
    statutTms: string,
  ): Promise<void> {
    await this.supabase
      .from('collectes')
      .update({ statut_tms: statutTms })
      .eq('id', collecteId);
  }

  // ─── Réconciliation plan B ────────────────────────────────────────────────────

  /**
   * Commande déjà créée chez MTS-1 pour ce numéro, ou `null` — avant tout
   * re-POST d'une création reprise (§08 §3bis.9).
   */
  private async reconcileOrder(
    collecte: Collecte,
    orderNumber: string,
  ): Promise<Mts1CustomerOrder | null> {
    // Fenêtre en JOURS : l'API ne lit que des « yyyy-MM-dd », bornes incluses,
    // jour compté à Paris (mesuré le 2026-10-13) — c'est-à-dire exactement
    // `date_collecte`, envoyée comme `orderDate` à la création. Un jour de marge
    // de chaque côté : un ordre manqué ferait re-POSTer un doublon sur une API
    // présumée non idempotente (§2), et le filtre `orderNumber` réduit déjà la
    // réponse aux commandes de CE rang.
    // Limite connue : une collecte dont la date a changé de plus d'un jour entre
    // le POST perdu et la reprise sort de la fenêtre. La commande laissée
    // derrière n'a ni tournée ni transporteur ; elle reste à supprimer chez MTS-1.
    const jour = collecte.date_collecte;
    const orders = await this.client.scanOrdersByDateRange(
      decalerJour(jour, -1),
      decalerJour(jour, 1),
      orderNumber,
    );

    // L'égalité stricte se rejoue ICI, quoi que rende le filtre distant.
    const duNumero = orders.filter((o) => o.orderNumber === orderNumber);

    // Commande terminée ou archivée sous ce numéro : l'ordre s'arrête (cf.
    // STATUTS_COMMANDE_TERMINEE). Regardé AVANT de chercher une commande à
    // reprendre : une commande encore en cours du même numéro ne lève pas
    // l'arrêt.
    const terminees = duNumero.filter((o) =>
      STATUTS_COMMANDE_TERMINEE.has(o.customerOrderStatus),
    );
    if (terminees.length > 0) {
      const lesquelles = [
        ...new Set(
          terminees.map(
            (o) =>
              `${
                estIdentifiantMts1(o.customerOrderId)
                  ? o.customerOrderId
                  : 'identifiant illisible'
              } ${o.customerOrderStatus}`,
          ),
        ),
      ].sort();
      throw new LogistiquePermanentError(
        `collecte ${collecte.id} : une commande du numéro ${orderNumber} est déjà terminée chez MTS-1 (${lesquelles.join(
          ', ',
        )}) — ni reprise ni nouvelle création`,
      );
    }

    // `orderNumber` n'est pas unique chez MTS-1 (jusqu'à 25 commandes mesurées
    // sous un même numéro) : on écarte les commandes refusées ou en échec, puis
    // on départage par identifiant, l'API ne garantissant aucun ordre de
    // réponse.
    // Le Set écarte une même commande rendue deux fois.
    const vivantes = duNumero.filter(
      (o) => !STATUTS_COMMANDE_MORTE.has(o.customerOrderStatus),
    );
    const candidates = [
      ...new Set(vivantes.map((o) => o.customerOrderId)),
    ].sort();
    const retenue = candidates[0];
    if (!retenue) return null;
    // L'identifiant retenu va dans `external_ref_commande`, puis dans le chemin
    // des appels de modification et d'annulation de cette commande : hors de
    // l'alphabet adopté, il est refusé. Il n'est ni écarté au profit d'une autre
    // commande (le départage par le plus petit identifiant ne tiendrait plus),
    // ni lu comme « aucune commande » (ce serait re-POSTer sur la foi d'une
    // réponse qu'on ne sait pas lire).
    if (!estIdentifiantMts1(retenue)) {
      throw new LogistiqueTransientError(
        `MTS-1 GET /v3/customerOrders : réponse inattendue, customerOrderId illisible pour le numéro ${orderNumber}`,
      );
    }

    if (candidates.length > 1) {
      // Les autres restent chez MTS-1 : trace pour les y retrouver.
      await this.supabase.from('integrations_logs').insert({
        integration: 'mts1',
        direction: 'sortant',
        methode: 'GET',
        endpoint: '/v3/customerOrders',
        correlation_id: orderNumber,
        erreur: `COMMANDES_EN_DOUBLE: ${candidates.length} commandes portent ce numéro (${candidates.join(
          ', ',
        )}), reprise sur ${retenue}`,
      });
    }
    return vivantes.find((o) => o.customerOrderId === retenue) ?? null;
  }

  /**
   * Tournée déjà rattachée à cette commande chez MTS-1, ou `null` — avant tout
   * re-POST /v3/tours d'une création reprise (§08 §3bis.5, Q3bis-6).
   *
   * Une commande rattachée porte `currentTour.tourId` (mesuré le 2026-10-13).
   * `dejaLue` = la commande telle que la réconciliation vient de la rendre ;
   * sinon elle est relue par son identifiant. Une lecture en échec LÈVE (erreur
   * du client) : elle n'est jamais lue comme « aucune tournée ».
   *
   * Limite : une tournée créée mais jamais rattachée ne porte aucun lien vers
   * sa commande (son numéro est attribué par MTS-1, elle n'a aucun arrêt). Elle
   * reste introuvable et la reprise en crée une autre ; la première est vide et
   * sans transporteur.
   *
   * Une tournée qu'une ligne `tournees` porte déjà — autre rang de la
   * collecte, ou autre collecte — n'est pas reprise : une ligne = un camion =
   * sa tournée. Cette lecture puis l'écriture de `tms_reference` ne sont pas
   * atomiques : l'index unique partiel `uniq_tournee_par_tms_reference` refuse
   * la seconde écriture de deux passages simultanés (23505), l'ordre repart « à
   * réconcilier » et la reprise voit alors la ligne de l'autre passage. Mesuré
   * le 2026-10-13 sur une collecte de test à deux camions du compte de
   * démonstration (un seul cas, mécanisme non établi) : les commandes des deux
   * rangs portaient la même tournée. Non mesuré : que MTS-1 fasse de même
   * entre deux collectes. Reprise, une telle tournée serait envoyée et validée
   * une seconde fois, et la relève lirait ses pesées sous les deux lignes.
   */
  private async reconcileTour(
    collecte: Collecte,
    rang: number,
    customerOrderId: string,
    dejaLue: Mts1CustomerOrder | null,
  ): Promise<string | null> {
    const commande =
      dejaLue ??
      (await this.client.findOrdersByIds([customerOrderId])).find(
        (c) => c.customerOrderId === customerOrderId,
      );
    // Commande disparue de chez MTS-1 : y créer une tournée ne commanderait
    // aucun camion. Échec définitif (donc alerte), comme pour une modification
    // reprise (updateCollecte).
    if (!commande) {
      throw new LogistiquePermanentError(
        `collecte ${collecte.id} : commande introuvable chez MTS-1 pour le rang ${rang} (${customerOrderId}) — tournée non créée`,
      );
    }
    // Même arrêt qu'à la recherche par numéro : cette commande est terminée ou
    // archivée, sa tournée n'est ni reprise ni recréée.
    if (STATUTS_COMMANDE_TERMINEE.has(commande.customerOrderStatus)) {
      throw new LogistiquePermanentError(
        `collecte ${collecte.id} : la commande du rang ${rang} (${customerOrderId}) est déjà terminée chez MTS-1 (${commande.customerOrderStatus}) — tournée ni reprise ni créée`,
      );
    }
    // Formes mesurées de `tourId` : une chaîne quand la commande est rattachée,
    // clé absente sinon. Absent ou nul, il vaut « aucune tournée ». Sous une
    // autre forme (nombre, chaîne vide, caractère hors de l'alphabet adopté), il
    // est refusé, comme à la création : lu comme « aucune tournée », il en ferait
    // créer une seconde ; adopté, il irait dans `tms_reference`. La forme de
    // `currentTour` lui-même n'est pas contrôlée : s'il n'est pas un objet,
    // aucune tournée n'y est lue.
    const tourId: unknown = commande.currentTour?.tourId;
    if (tourId === undefined || tourId === null) return null;
    if (!estIdentifiantMts1(tourId)) {
      throw new LogistiqueTransientError(
        `MTS-1 GET /v3/customerOrders : réponse inattendue, currentTour.tourId illisible pour la commande ${customerOrderId}`,
      );
    }

    // Le rang courant n'a pas de référence (sinon on ne serait pas ici) : toute
    // ligne qui porte cette tournée est celle d'un autre camion. Une lecture en
    // échec lève : elle n'est jamais lue comme « aucune ligne ».
    const { data: porteuses, error } = await this.supabase
      .from('tournees')
      .select('id')
      .eq('tms_reference', tourId)
      .limit(1);
    if (error) {
      throw new LogistiqueTransientError(
        `Lecture des tournées portant la référence ${tourId} échouée — ${error.message}`,
      );
    }
    return porteuses?.length ? null : tourId;
  }

  /**
   * Identifiants, parmi les commandes de ces tournées, de celles qui existent
   * encore chez MTS-1. Une lecture en échec LÈVE (erreur du client) : elle n'est
   * jamais lue comme « aucune commande ».
   */
  private async commandesConnues(tournees: TourneeRow[]): Promise<Set<string>> {
    const commandes = await this.client.findOrdersByIds(
      tournees
        .map((t) => t.external_ref_commande)
        .filter((id): id is string => !!id),
    );
    return new Set(commandes.map((c) => c.customerOrderId));
  }

  // ─── Builders payload MTS-1 ──────────────────────────────────────────────────

  // Clé fonctionnelle de la commande : `{collecte}-{rang}` (§08 §3bis), suffixée
  // de la tentative `-r{n}` quand le rang a été refusé puis réattribué
  // (fn_dispatcher_collecte suffixe alors `tournees.reference_interne` —
  // arbitrage Val 2026-09-17). Sans suffixe, la nouvelle commande porterait la
  // clé de la commande annulée, et la réconciliation retrouverait cette dernière.
  private orderNumber(
    collecte: Collecte,
    rang: number,
    tournee?: Pick<TourneeRow, 'reference_interne'> | null,
  ): string {
    const tentative = tournee?.reference_interne?.match(/-r\d+$/)?.[0] ?? '';
    return `${collecte.id}-${rang}${tentative}`;
  }

  // Contacts propagés au TMS : principal (toujours) + téléphone du secours (dès
  // qu'il existe, indépendamment du nom).
  // Partagé par buildOrderPayload (E1) ET buildUpdatePayload (E2) — R22c/BL-P2-10 :
  // les deux DOIVENT rester alignés, sinon une édition de contact post-dispatch ne
  // remonte jamais au prestataire (buildUpdatePayload ne poussait que place+orderDate).
  // Contact terrain → CustomerOrderContactInput (objet UNIQUE). MTS-1 n'expose
  // qu'UN `contact` sur la commande : on y met le contact PRINCIPAL, et le
  // téléphone du contact de SECOURS va en `phoneAlternatives`. Le NOM du secours
  // n'a pas de champ dédié → il est concaténé au `comment` de la commande
  // (arbitrage Val 2026-09-14, §08 l.393-397 : « sans quoi le chauffeur a un
  // numéro de secours sans savoir qui appeler »). Cette concaténation a lieu en
  // AMONT, dans `composerInformationsSupplementaires` (fetchCollecte), donc pour
  // les DEUX adapters — garde-fou 2 : ne pas la refaire ici. On ne dispose que
  // d'un `nom` complet → 1er mot = firstname, reste = lastname.
  private buildContact(
    collecte: Collecte,
  ): CreateOrderPayload['contact'] | undefined {
    const nom = collecte.contact_principal_nom?.trim() ?? '';
    const phone = collecte.contact_principal_telephone;
    const secoursPhone = collecte.contact_secours_telephone;
    if (!nom && !phone && !secoursPhone) return undefined;

    const [firstname, ...rest] = nom.split(/\s+/).filter(Boolean);
    const lastname = rest.join(' ');

    return {
      ...(firstname ? { firstname } : {}),
      ...(lastname ? { lastname } : {}),
      ...(phone ? { phone } : {}),
      ...(secoursPhone ? { phoneAlternatives: [secoursPhone] } : {}),
    };
  }

  // Point A (enlèvement) = adresse du lieu + créneau d'arrivée souhaité, dans le
  // MÊME objet `place` (`CustomerOrderPlaceInput`). Partagé E1/E2 : le créneau est
  // l'un des champs qui arment `dirty_tms` (cf. trigger `fn_set_collectes_dirty_tms`,
  // §04 l.1512 « date, heure, lieu, … ») et la §08 3bis.8 le nomme en tête des champs
  // re-poussés (« créneau, volume, contact ») — le construire deux fois, c'est laisser
  // les deux payloads diverger, ce qui vient d'arriver au créneau.
  private buildPlace(collecte: Collecte): CreateOrderPayload['place'] {
    const adresse = `${collecte.lieu.adresse_acces}, ${collecte.lieu.code_postal} ${collecte.lieu.ville}`;
    // MTS-1 `Timeslot.start`/`end` = format **HH:mm**. `heure_collecte` est un
    // `time` Postgres (« HH:mm:ss ») → on tronque à HH:mm. Point fixe V1 : start=end.
    const heureHHmm = (collecte.heure_collecte ?? '').slice(0, 5);
    return {
      address: { addressSingleLine: adresse },
      // Créneau d'arrivée souhaité (point fixe V1 : start=end) — porté par le lieu
      // (CustomerOrderPlaceInput.timeslots, format HH:mm), pas par la commande.
      ...(heureHHmm
        ? { timeslots: [{ start: heureHHmm, end: heureHHmm }] }
        : {}),
    };
  }

  private buildOrderPayload(
    collecte: Collecte,
    orderNumber: string,
  ): CreateOrderPayload {
    const isZd = collecte.type === 'zero_dechet';

    const contact = this.buildContact(collecte);

    // Point B (livraison) = où les stuffs sont déposés → `stuffs[].relatedAddress`
    // (CustomerOrderPlaceInput). ZD → entrepôt Savr (favoritePlace `MTS1_ENTREPOT_PLACE_ID`) ;
    // AG → association : favoritePlace `id_point_collecte_mts1` sinon adresse inline
    // (cf. Collecte.association_adresse). AG sans association = pas de point B →
    // refus permanent, avant tout POST. Le `place` de la commande reste le PICKUP.
    const pointBPlaceId = isZd
      ? process.env['MTS1_ENTREPOT_PLACE_ID'] || undefined
      : (collecte.association_id_point_collecte_mts1 ?? undefined);
    let pointB: PointLivraison | undefined;
    if (pointBPlaceId) {
      pointB = { placeId: pointBPlaceId };
    } else if (!isZd) {
      if (!collecte.association_adresse) {
        throw new LogistiquePermanentError(
          `collecte AG ${collecte.id} sans association attribuée : aucune adresse de livraison à transmettre à MTS-1`,
        );
      }
      pointB = { address: { addressSingleLine: collecte.association_adresse } };
    }
    const relatedAddress = pointB ? { relatedAddress: pointB } : {};

    // Marchandise transportée (pesée plus tard → quantity 0), chaque stuff portant le
    // point B (relatedAddress). ZD = 5 flux + volume du camion ; AG = le don
    // alimentaire (poids/photos remontés ensuite par le polling, comme les pesées ZD).
    const stuffs = isZd
      ? [
          ...FLUX_STUFFS_ZD.map((name) => ({
            name,
            task: 'PICKUP',
            quantity: 0,
            ...relatedAddress,
          })),
          {
            name: '<volume_du_camion>',
            task: 'PICKUP',
            quantity: 1,
            ...relatedAddress,
          },
        ]
      : [
          {
            name: 'Don alimentaire',
            task: 'PICKUP',
            quantity: 0,
            ...relatedAddress,
          },
        ];

    return {
      orderNumber,
      orderDate: collecte.date_collecte,
      timezone: 'Europe/Paris',
      serviceTime: 60,
      transportersNeededCount: 1,
      orderCategories: isZd ? ['Déchets'] : ['Alimentaire'],
      place: this.buildPlace(collecte),
      ...(contact ? { contact } : {}),
      stuffs,
      // BL-P1-PROG-03 : informations_supplementaires → `comment` MTS-1 (§08 l.389),
      // pour que les instructions logistiques du programmeur atteignent le prestataire
      // (M01/M03/M05). Le champ porte l'agrégat composé par fetchCollecte : saisie du
      // traiteur + nom du contact de secours + informations d'accès du lieu — §08 l.397
      // « comment (informations_supplementaires + nom du contact de secours) ».
      // controle_acces_requis n'a pas de champ natif MTS-1 (concern V2 TMS
      // via validate_tournee_controle_acces) → hors payload sortant V1.
      ...(collecte.informations_supplementaires
        ? { comment: collecte.informations_supplementaires }
        : {}),
    };
  }

  private buildTourPayload(
    collecte: Collecte,
    orderNumber: string,
  ): CreateTourPayload {
    // `TourInput` ne prend que { tourDate, tourNumber?, customerOrders?, comments? }.
    // Les `stuffs` et le `deliveryPlace` (relevé as-built Bubble) sont IGNORÉS par
    // MTS-1 → retirés. Les stuffs ET le point de dépôt (B) sont désormais portés par
    // la COMMANDE (buildOrderPayload : `stuffs[].relatedAddress`), elle-même rattachée
    // à la tournée via PUT /v3/tours/addCustomerOrder.
    return {
      orderNumber,
      // `tourDate` (yyyy-MM-dd) OBLIGATOIRE sur POST /v3/tours.
      tourDate: collecte.date_collecte,
    };
  }

  // Type de retour = `Partial<CreateOrderPayload>` et NON `Record<string, unknown>` :
  // c'est le compilateur qui interdit d'ajouter au payload sortant une clé qui n'existe
  // pas chez MTS-1 — au premier rang desquelles `collectes.notes_internes`, que le worker
  // charge et que le type `Collecte` porte jusqu'ici. E1 bénéficiait déjà de cette garde
  // en étant typé `CreateOrderPayload` ; E2 était le seul payload sortant non typé, donc
  // le seul où une fuite interne passait typecheck ET tests (relevé reviewer-rls-securite).
  private buildUpdatePayload(collecte: Collecte): Partial<CreateOrderPayload> {
    // R22c/BL-P2-10 : PUT /v3/customerOrders = merge partiel MTS-1 — seuls les champs
    // de PREMIER NIVEAU listés ici sont touchés (`stuffs`, pesées, statut : absents du
    // payload, donc préservés). ⚠ La profondeur du merge n'est PAS spécifiée : `place`
    // étant listé, rien ne garantit que MTS-1 fusionne À L'INTÉRIEUR de l'objet. Le
    // créneau est donc envoyé dans le MÊME `place` que l'adresse — correct dans les
    // deux hypothèses (merge profond : il est mis à jour ; remplacement de `place` :
    // il est reposé au lieu d'être effacé). L'omettre n'était sûr que sous la
    // seconde moitié de l'hypothèse, jamais vérifiée. (À confirmer en DEMO par
    // read-back, comme l'a été `contact: {}` / `timeslots: null` au POST — relevé
    // as-built §« Contact et créneau de la commande », 2026-09-04.)
    //
    // Le payload E2 doit couvrir TOUT champ qui arme `dirty_tms`
    // (`fn_set_collectes_dirty_tms` : date, heure, lieu, contrôle d'accès, infos
    // supplémentaires) — c'est la définition même de « champ propagé au TMS » (§04
    // l.1512) et la §08 3bis.8 le redit (« re-push des champs modifiés »). Deux des
    // cinq n'atteignaient pas le fil : le créneau (`heure_collecte`) et le canal
    // libre (`informations_supplementaires`). `controle_acces_requis` reste le seul
    // exclu assumé : MTS-1 n'a aucun champ natif (concern V2 TMS via
    // validate_tournee_controle_acces). Le « volume » que nomme la 3bis.8 n'est pas
    // repoussé non plus : il vit dans `stuffs`, dont un re-push écraserait les
    // quantités pesées (divergence tracée, type ambigu).
    //
    // buildOrderPayload (E1) et buildUpdatePayload (E2) restent alignés par
    // CONSTRUCTION via buildPlace()/buildContact(), pas par recopie. pax : MTS-1 n'a
    // aucun champ dédié (§08 l.173, push silencieux ignoré) → jamais dans le payload
    // sortant V1 ; le signal part dans l'outbox E2, consommé par le TMS V2.
    const contact = this.buildContact(collecte);
    return {
      place: this.buildPlace(collecte),
      orderDate: collecte.date_collecte,
      ...(contact ? { contact } : {}),
      // `?? ''` et non l'omission conditionnelle de E1 : sur une MODIFICATION, un
      // canal libre vidé par le traiteur doit effacer la consigne chez MTS-1. Omettre
      // la clé laisserait le chauffeur avec des instructions d'accès périmées — le
      // cas exact que ce correctif adresse, à l'envers.
      comment: collecte.informations_supplementaires ?? '',
    };
  }
}
