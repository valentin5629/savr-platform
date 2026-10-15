// Adapter MTS-1 — côté sortant (M1.5a).
// Polling entrant (sync) = M1.5b.
//
// Envoi d'une collecte (dispatchCollecte), par camion (décisions Val 2026-10-15) :
//   1. POST /v3/customerOrders → commit external_ref_commande IMMÉDIATEMENT
//      (CLAUDE.md §2 : MTS-1 présumé NON idempotent) ; la commande porte les
//      points A (lieu de la collecte) et B (association ou entrepôt Savr) ;
//   2. tournée unitaire : POST /v3/tours → commit tms_reference IMMÉDIATEMENT,
//      puis PUT /v3/tours/addCustomerOrder.
// Jamais d'envoi au transporteur ni de validation : la tournée attend dans
// « Commander → Tournées » de la console MTS-1, où l'Admin Savr regroupe des
// tournées (plusieurs collectes) et les envoie. La relève (sync) lit ensuite,
// sur la tournée que désigne la commande (`currentTour`), son attribution et son
// transporteur.
//
// Curseurs de reprise : external_ref_commande puis tms_reference du rang.
// Un curseur non écrit après une création = erreur AMBIGUË, jamais un simple rejeu.
// Réconciliation : si requires_reconciliation=true → recherche de la commande par
// son numéro avant tout re-POST ; une commande qui existait déjà est relue avant
// de lui créer ou rattacher une tournée (l'Admin a pu la placer ailleurs).

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
import { uneLigne } from '../infos-acces.js';

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
// Le statut de la COMMANDE ne dit pas l'acceptation : une commande `VALIDATED`
// peut être sur une tournée seulement proposée au transporteur (mesuré le
// 2026-10-13). L'attribution et l'acceptation se lisent sur la tournée
// (NIVEAU_ATTRIBUTION). Ne reste ici que le refus.
const MTS1_STATUS_TO_TMS: Record<string, string | null> = {
  QUOTE: null,
  DRAFT: null,
  PLANNED: null,
  VALIDATED: null,
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

// Attribution d'un camion, lue sur la tournée de sa commande (`status.dispatch`,
// valeurs mesurées le 2026-10-13) : 0 = à attribuer (commande hors de toute
// tournée, ou tournée pas encore envoyée), 1 = proposée au transporteur,
// 2 = acceptée par lui (décision Val 2026-10-13 : « acceptée » = le
// transporteur a accepté la tournée). Toute autre valeur n'est pas mesurée :
// rien n'en est conclu (cf. suivreAttribution).
const NIVEAU_ATTRIBUTION: Readonly<Record<string, number>> = {
  TO_BE_DISPATCHED: 0,
  PROPOSED: 1,
  ACCEPTED: 2,
  COMPLETED: 2,
};
const STATUT_TMS_PAR_NIVEAU = [
  'a_attribuer',
  'attribuee_en_attente_acceptation',
  'acceptee',
] as const;
// Collectes dont l'attribution se suit encore : à valider ou validées (une fois
// la mission commencée, l'attribution est acquise).
const STATUTS_ATTRIBUTION_COLLECTE: string[] = ['programmee', 'validee'];

// Statuts qui arrêtent la reprise d'une création : une commande du même numéro
// dans l'un d'eux met l'ordre en échec définitif, donc en alerte — ni reprise,
// ni nouvelle création, même si une commande encore en cours porte aussi ce
// numéro (décisions de Val, 2026-10-13). L'arrêt joue à la lecture d'une
// reprise « à réconcilier » : la recherche par numéro, quand aucune commande
// n'est enregistrée pour le rang. `OK` et `PARTIAL` : la mission est
// terminée. `ARCHIVED` : rangé avec eux par la même décision, son sens n'étant
// pas mesuré (1 commande `ARCHIVED` parmi les 72 que rendait la recherche du
// compte de démonstration ce jour-là).
const STATUTS_COMMANDE_TERMINEE = new Set(['OK', 'PARTIAL', 'ARCHIVED']);

// ─── Contact d'une commande ──────────────────────────────────────────────────

// CustomerOrderContactInput : Savr n'a qu'un nom complet → 1er mot = firstname,
// reste = lastname (relevé as-built §« Contact »). `undefined` si rien à dire.
function contactMts1(
  nom: string | null | undefined,
  telephone: string | null | undefined,
  telephoneSecours?: string | null,
): CreateOrderPayload['contact'] | undefined {
  const [firstname, ...rest] = (nom?.trim() ?? '').split(/\s+/).filter(Boolean);
  const lastname = rest.join(' ');
  if (!firstname && !telephone && !telephoneSecours) return undefined;
  return {
    ...(firstname ? { firstname } : {}),
    ...(lastname ? { lastname } : {}),
    ...(telephone ? { phone: telephone } : {}),
    ...(telephoneSecours ? { phoneAlternatives: [telephoneSecours] } : {}),
  };
}

// ─── Numéro de commande (décision Val 2026-10-15, C59) ──────────────────────

// MTS-1 n'a aucun champ « nom » de commande ni de lieu (documentation V3, lue le
// 2026-10-15) : la console affiche le NUMÉRO de commande comme nom du point. Il
// porte donc « Traiteur - Lieu - N pax », puis la clé de la commande, qui reste
// la seule chose que la reprise recherche : le libellé suit les données de la
// collecte et peut changer d'un passage à l'autre (modification du nombre de
// pax, du lieu…), la clé jamais.
const SEPARATEUR_CLE = ' · ';

// Chaque partie du libellé est bornée : le libellé passe en tête et reste
// lisible dans la frise de la console. MTS-1 a accepté et rendu à l'identique un
// numéro de 164 caractères (mesuré sur le compte de démonstration le
// 2026-10-15) ; ici, au plus ~95 caractères plus la clé (≤ 45).
const LIMITE_PARTIE_LIBELLE = 40;

function libelleCommande(collecte: Collecte): string {
  const pax =
    typeof collecte.pax === 'number' &&
    Number.isInteger(collecte.pax) &&
    collecte.pax > 0
      ? `${collecte.pax} pax`
      : '';
  return [
    uneLigne(collecte.traiteur_nom, LIMITE_PARTIE_LIBELLE),
    uneLigne(collecte.lieu.nom, LIMITE_PARTIE_LIBELLE),
    pax,
  ]
    .filter(Boolean)
    .join(' - ');
}

/**
 * Le numéro d'une commande MTS-1 porte-t-il cette clé ? Égal à la clé (commandes
 * créées avant le 2026-10-15, ou sans libellé) ou terminé par « · clé ». La clé
 * d'un rang ne peut pas terminer celle d'un autre : « …-1 » ne termine ni
 * « …-11 » ni « …-1-r2 », et le séparateur exige le début de la clé.
 */
export function numeroPorteLaCle(numero: unknown, cle: string): boolean {
  return (
    typeof numero === 'string' &&
    (numero === cle || numero.endsWith(`${SEPARATEUR_CLE}${cle}`))
  );
}

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

    // Clé de la commande de CE rang, tentative comprise. Lue sur la tournée
    // trouvée (jamais réécrite par l'adapter) : stable sur toute la reprise. Le
    // numéro envoyé y ajoute le libellé, qui peut changer d'un passage à l'autre.
    const cle = this.cleCommande(collecte, rang, tournee);
    const orderNumber = this.orderNumber(collecte, rang, tournee);

    // ── Étape 1 : POST /v3/customerOrders, sauf commande déjà enregistrée ──────
    let customerOrderId = tournee?.external_ref_commande ?? null;
    const dejaEnregistree = customerOrderId !== null;
    // Commande créée à ce passage, ou retrouvée par la réconciliation (elle dit
    // alors sa tournée).
    let commandeNeuve = false;
    let commandeRetrouvee: Mts1CustomerOrder | null = null;
    if (!customerOrderId) {
      // Réconciliation avant re-POST si claim expiré lors d'une tentative précédente
      if (opts?.requiresReconciliation) {
        commandeRetrouvee = await this.reconcileOrder(collecte, cle);
        customerOrderId = commandeRetrouvee?.customerOrderId ?? null;
      }
      if (!customerOrderId) {
        const created = await this.client.postOrder(
          this.buildOrderPayload(collecte, orderNumber),
        );
        customerOrderId = created.id;
        commandeNeuve = true;
      }
      // Commit immédiat — MTS-1 présumé NON idempotent (CLAUDE.md §2). Une
      // commande retrouvée par la réconciliation est enregistrée sans re-POST.
      tournee = await this.upsertTournee(
        collecte,
        rang,
        customerOrderId,
        tournee,
      );
    }

    // ── Étape 2 : tournée unitaire du camion ───────────────────────────────────
    await this.tourneeUnitaire(
      collecte,
      tournee!,
      customerOrderId,
      orderNumber,
      commandeNeuve ? 'neuve' : commandeRetrouvee,
    );

    // Référence d'AFFICHAGE de la collecte (§04 Data Model : « identifiant de la
    // collecte côté TMS » ; §06.06 bouton « Renvoyer au TMS », §11 carte
    // « Collectes non transmises ») : l'identifiant de la commande du rang 1, posé
    // une fois la commande et sa tournée unitaire enregistrées. Le CDC ne
    // prévoit qu'un identifiant par collecte, même à plusieurs camions. JAMAIS un
    // prédicat : l'émission de E2 se décide sur l'existence d'une commande
    // (fn_collecte_commandee_chez_provider).
    if (rang === 1) {
      await this.updateCollecteRef(collecte.id, customerOrderId);
    }

    await this.passerAAttribuer(collecte.id, dejaEnregistree);
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
      // Le numéro est renvoyé à chaque modification : un nombre de pax, un lieu
      // ou un traiteur modifié renomme le point dans la console (renommage par
      // PUT mesuré sur le compte de démonstration le 2026-10-15). La clé, en fin
      // de numéro, ne change pas.
      const numero = this.orderNumber(collecte, t.rang, t);
      await this.client.updateOrder(
        t.external_ref_commande!,
        { ...updatePayload, orderNumber: numero },
        numero,
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

    // BL-P1-RM-03 — augmentation N→N+k : créer, via dispatchCollecte
    // (idempotent, repart du curseur du rang, clé d'idempotence
    // reference-{rang}), la commande de tout rang de 1..N qui n'en a pas. Une
    // grosse collecte dont Ops augmente N a ainsi une commande par camion. La
    // boucle joue à CHAQUE modification, pas seulement quand N augmente.
    // Servi = une commande et sa tournée unitaire enregistrées (décision Val
    // 2026-10-15). Un rang dont la tournée manque repasse par dispatchCollecte,
    // qui relit d'abord sa commande : l'Admin a pu la placer dans une autre
    // tournée, elle n'en est jamais sortie. « Sans commande » couvre le rang
    // refusé puis réattribué : fn_dispatcher_collecte efface sa commande et sa
    // tournée (arbitrage Val 2026-09-17), il doit repartir.
    // Un rang clos (tournée terminée ou annulée) est servi, même sans référence.
    const rangsServis = new Set(
      avecRef
        .filter((t) => t.tms_reference || t.statut !== 'planifiee')
        .map((t) => t.rang),
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

      // 4bis. Transporteur et attribution, lus sur la tournée à CHAQUE passage :
      // c'est l'Admin qui compose la tournée et l'envoie au transporteur dans la
      // console MTS-1 (décisions Val 2026-10-15). Sur une collecte en cours
      // d'exécution, et pas sur une commande refusée (étape 3 et 5).
      if (
        enExecution &&
        !STATUTS_COMMANDE_MORTE.has(order.customerOrderStatus)
      ) {
        if (lecture) {
          await this.suivreTransporteur(lecture.tour, tourneeInfo, collecteId);
        }
        await this.suivreAttribution(
          tourneeInfo,
          order.customerOrderId,
          tourId,
          lecture?.tour ?? null,
        );
      }

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
   * Transporteur réellement choisi par l'Admin dans la console MTS-1
   * (`dispatch.carrierShareableCode` de la tournée), reporté sur la tournée du
   * camion et, pour le rang 1, sur la collecte (décision Val 2026-10-15 : la
   * plateforme suit MTS-1). Rapproché de `transporteurs.code_transporteur_mts1`,
   * parmi les seuls transporteurs MTS-1 : la relève ne lit que leurs tournées.
   * Tournée pas encore envoyée : pas de code, rien à faire. Code illisible,
   * inconnu ou porté par plusieurs transporteurs : rien n'est changé, alerte
   * Admin.
   */
  private async suivreTransporteur(
    tour: Mts1Tour,
    camion: {
      tourneeId: string;
      rang: number;
      prestataireId: string | null;
      collectePrestataireId: string | null;
    },
    collecteId: string,
  ): Promise<void> {
    const code: unknown = tour.dispatch?.carrierShareableCode;
    if (code === undefined || code === null || code === '') return;

    let prestataires: string[] = [];
    if (estIdentifiantMts1(code)) {
      const { data, error } = await this.supabase
        .from('transporteurs')
        .select('prestataire_logistique_id')
        .eq('code_transporteur_mts1', code)
        .in('prestataire_logistique_id', [...(await this.prestatairesMts1())]);
      if (error) {
        throw new LogistiqueTransientError(
          `Transporteur de la tournée de la collecte ${collecteId} non lu — ${error.message}`,
        );
      }
      prestataires = [
        ...new Set(
          ((data ?? []) as Array<{ prestataire_logistique_id: string }>).map(
            (t) => t.prestataire_logistique_id,
          ),
        ),
      ];
    }
    const prestataire = prestataires.length === 1 ? prestataires[0] : undefined;
    if (!prestataire) {
      await this.supabase.rpc('f_upsert_alerte_admin', {
        p_code: 'transporteur_mts1_inconnu',
        p_titre: 'Transporteur MTS-1 inconnu du référentiel',
        p_message: `La tournée de cette collecte est confiée dans MTS-1 au transporteur ${
          estIdentifiantMts1(code) ? code : '(code illisible)'
        }, ${
          prestataires.length > 1
            ? 'que portent plusieurs transporteurs du référentiel Savr'
            : 'absent du référentiel Savr'
        } : le transporteur de la fiche n'a pas été mis à jour.`,
        p_entity_type: 'collectes',
        p_entity_id: collecteId,
      });
      return;
    }

    if (prestataire !== camion.prestataireId) {
      const { error } = await this.supabase
        .from('tournees')
        .update({ prestataire_logistique_id: prestataire })
        .eq('id', camion.tourneeId);
      if (error) {
        throw new LogistiqueTransientError(
          `Transporteur de la tournée ${camion.tourneeId} non écrit — ${error.message}`,
        );
      }
    }
    // La collecte ne suit que si elle est encore confiée à un transporteur MTS-1 :
    // confiée depuis à un autre prestataire (par mail, A Toutes!), une commande
    // MTS-1 restée vivante ne doit pas la ramener chez MTS-1 (la modification
    // suivante partirait vers MTS-1 et y commanderait un camion).
    const mts1 = [...(await this.prestatairesMts1())];
    if (
      camion.rang === 1 &&
      prestataire !== camion.collectePrestataireId &&
      camion.collectePrestataireId !== null &&
      mts1.includes(camion.collectePrestataireId)
    ) {
      const { error } = await this.supabase
        .from('collectes')
        .update({ prestataire_logistique_id: prestataire })
        .eq('id', collecteId)
        .in('statut', [...STATUTS_COLLECTE_EN_EXECUTION])
        .in('prestataire_logistique_id', mts1);
      if (error) {
        throw new LogistiqueTransientError(
          `Transporteur de la collecte ${collecteId} non écrit — ${error.message}`,
        );
      }
    }
  }

  /**
   * Statut logistique de la collecte, tiré de l'attribution de ses camions
   * (NIVEAU_ATTRIBUTION) : le moins avancé l'emporte, une collecte à plusieurs
   * camions n'est « acceptée » que quand tous le sont (décision Val 2026-10-15,
   * C47). Les autres camions sont relus chez MTS-1 (leur commande, puis sa
   * tournée) : un camion que ce passage ne lit pas n'est jamais supposé accepté.
   * Écrit seulement sur une collecte à valider ou validée, et depuis l'un des
   * trois statuts de l'attribution : jamais sur un refus, une annulation, ni une
   * collecte « non envoyée ». Une tournée dans un état non mesuré : rien n'est
   * conclu.
   *
   * Seulement quand l'état de la tournée de CETTE commande change (tournée et
   * niveau), comme les statuts de commande (reserverStatut) : une collecte
   * remise « en attente d'acceptation » par une modification de sa date ou de
   * son heure (§08 « réacceptation requise ») y reste tant que MTS-1 ne montre
   * rien de nouveau. Le dernier état vu est gardé par commande dans
   * integrations_inbox (purgée à 7 jours, comme les statuts), et n'est noté
   * qu'après l'écriture : une écriture en échec est rejouée au passage suivant.
   */
  private async suivreAttribution(
    collecte: {
      collecteId: string;
      collecteStatut: string;
      collecteStatutTms: string | null;
      collectePrestataireId: string | null;
      tourneeId: string;
    },
    customerOrderId: string,
    tourId: string | null,
    tour: Mts1Tour | null,
  ): Promise<void> {
    const { collecteId, tourneeId } = collecte;
    // Gardes lues d'abord sur la collecte rapprochée, puis rejouées dans la
    // requête d'écriture. Hors garde, rien n'est écrit ni noté : l'état sera
    // relevé quand la collecte y entrera. Collecte confiée depuis à un autre
    // prestataire que MTS-1 : jamais touchée (cf. suivreTransporteur).
    const mts1 = [...(await this.prestatairesMts1())];
    if (
      !STATUTS_ATTRIBUTION_COLLECTE.includes(collecte.collecteStatut) ||
      !(STATUT_TMS_PAR_NIVEAU as readonly (string | null)[]).includes(
        collecte.collecteStatutTms,
      ) ||
      collecte.collectePrestataireId === null ||
      !mts1.includes(collecte.collectePrestataireId)
    ) {
      return;
    }
    let niveau = await this.niveauAttribution(tour);
    if (niveau === null) return;
    const cle = `mts1:attribution:${customerOrderId}`;
    const etat = `${tourId ?? 'aucune'}:${niveau}`;
    const { data: vues, error: errVue } = await this.supabase
      .from('integrations_inbox')
      .select('id, payload')
      .eq('source', 'mts1')
      .eq('event_id_externe', cle)
      .limit(1);
    if (errVue) {
      throw new LogistiqueTransientError(
        `Attribution de la commande ${customerOrderId} non relue — ${errVue.message}`,
      );
    }
    const vue = (vues ?? [])[0] as
      | { id: string; payload: { etat?: unknown } | null }
      | undefined;
    if (vue?.payload?.etat === etat) return;
    if (niveau > 0) {
      const autres = (await this.findTournees(collecteId)).filter(
        (t) =>
          t.id !== tourneeId &&
          t.external_ref_commande !== null &&
          t.statut !== 'annulee',
      );
      const niveauAutres = await this.niveauDesCamions(autres);
      if (niveauAutres === null) return;
      niveau = Math.min(niveau, niveauAutres);
    }
    const cible = STATUT_TMS_PAR_NIVEAU[niveau];
    if (!cible) return;
    if (collecte.collecteStatutTms !== cible) {
      const { data: ecrites, error } = await this.supabase
        .from('collectes')
        .update({
          statut_tms: cible,
          statut_tms_at: new Date().toISOString(),
        })
        .eq('id', collecteId)
        .in('statut', STATUTS_ATTRIBUTION_COLLECTE)
        .in('statut_tms', [...STATUT_TMS_PAR_NIVEAU])
        .in('prestataire_logistique_id', mts1)
        .select('id');
      if (error) {
        throw new LogistiqueTransientError(
          `Statut logistique de la collecte ${collecteId} non écrit — ${error.message}`,
        );
      }
      // Écartée par une garde entre la lecture et l'écriture : rien n'est noté,
      // l'état sera relu au passage suivant.
      if (!ecrites?.length) return;
    }
    await this.noterAttribution(cle, etat, vue?.id ?? null);
  }

  // Dernier état d'attribution vu pour une commande. INSERT nu (index unique
  // PARTIEL : pas d'upsert, cf. reserverStatut) ; 23505 = un passage voisin l'a
  // noté à l'instant, son état est le même.
  private async noterAttribution(
    cle: string,
    etat: string,
    id: string | null,
  ): Promise<void> {
    const maintenant = new Date().toISOString();
    const { error } = id
      ? await this.supabase
          .from('integrations_inbox')
          .update({ payload: { etat }, traite_at: maintenant })
          .eq('id', id)
      : await this.supabase.from('integrations_inbox').insert({
          source: 'mts1',
          event_type: 'order_attribution',
          event_id_externe: cle,
          payload: { etat },
          traite: true,
          traite_at: maintenant,
        });
    if (error && error.code !== '23505') {
      throw new LogistiqueTransientError(
        `Attribution ${cle} non notée — ${error.message}`,
      );
    }
  }

  // Niveau d'attribution d'une tournée ; pas de tournée = 0 (la commande attend
  // l'Admin). `null` : état non mesuré, tracé une fois par valeur.
  private async niveauAttribution(
    tour: Mts1Tour | null,
  ): Promise<number | null> {
    if (!tour) return 0;
    const etat: unknown = tour.status?.dispatch;
    if (typeof etat === 'string' && Object.hasOwn(NIVEAU_ATTRIBUTION, etat)) {
      return NIVEAU_ATTRIBUTION[etat] ?? null;
    }
    const lisible =
      typeof etat === 'string' && /^[A-Z_]{1,40}$/.test(etat)
        ? etat
        : 'illisible';
    if (
      await this.premiereFois('tour_dispatch_inconnu', `dispatch:${lisible}`)
    ) {
      await this.logEntrantError(
        'TOUR_DISPATCH_INCONNU',
        `status.dispatch ${lisible} : état d'attribution non mesuré, rien n'en est conclu`,
      );
    }
    return null;
  }

  // Niveau le plus bas parmi ces camions, relus chez MTS-1 (la tournée que
  // désigne leur commande, à défaut celle de leur ligne). `null` si l'un d'eux
  // ne se lit pas. Un camion dont la mission est finie compte pour accepté.
  private async niveauDesCamions(
    camions: TourneeRow[],
  ): Promise<number | null> {
    const aLire = camions.filter((t) => t.statut !== 'terminee');
    if (aLire.length === 0) return 2;
    const commandes = await this.client.findOrdersByIds(
      aLire.map((t) => t.external_ref_commande!),
    );
    let niveau = 2;
    for (const t of aLire) {
      const commande = commandes.find(
        (c) => c.customerOrderId === t.external_ref_commande,
      );
      const designe: unknown = commande?.currentTour?.tourId;
      const tourId =
        designe === undefined || designe === null || designe === ''
          ? t.tms_reference
          : designe;
      if (tourId !== null && !estIdentifiantMts1(tourId)) return null;
      const n = await this.niveauAttribution(
        tourId ? await this.client.getTour(tourId) : null,
      );
      if (n === null) return null;
      niveau = Math.min(niveau, n);
    }
    return niveau;
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
    rang: number;
    prestataireId: string | null;
    collectePrestataireId: string | null;
    collecteStatutTms: string | null;
  } | null> {
    // `prestatairesDuType` garantit un Set NON VIDE (elle lève sinon) : le `.in()`
    // ci-dessous ne peut donc jamais dégénérer en requête toujours fausse, qui
    // ferait passer tous les ordres pour inconnus.
    const prestatairesMts1 = await this.prestatairesMts1();

    const { data, error } = await this.supabase
      .from('tournees')
      .select(
        'id, statut, tms_reference, prestataire_logistique_id, collecte_tournees!inner(collecte_id, rang, collectes!inner(id, statut, statut_tms, prestataire_logistique_id))',
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
      prestataire_logistique_id?: string | null;
      // `collecte_tournees` embarqué depuis `tournees` = FK entrante → TABLEAU.
      // `collectes` embarqué depuis `collecte_tournees` = FK sortante → OBJET.
      collecte_tournees: Array<{
        collecte_id: string;
        rang?: number;
        collectes: {
          id: string;
          statut: string;
          statut_tms?: string | null;
          prestataire_logistique_id?: string | null;
        };
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
      rang: ct.rang ?? 1,
      prestataireId: raw.prestataire_logistique_id ?? null,
      collectePrestataireId: collecte.prestataire_logistique_id ?? null,
      collecteStatutTms: collecte.statut_tms ?? null,
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
   * sauté, et l'identifiant de mission Everest pris pour la commande MTS-1.
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

  /**
   * Tournée unitaire du camion, dans « Commander → Tournées » de la console
   * MTS-1 (décision Val 2026-10-15) : créée, puis la commande y est rattachée.
   * Jamais envoyée au transporteur ni validée : l'Admin regroupe des tournées
   * (plusieurs collectes sur une même tournée) et les envoie. Les points A et B
   * sont portés par la commande (`place`, `stuffs[].relatedAddress`).
   *
   * Commande créée à ce passage : la tournée est créée et la commande y est
   * rattachée. Commande qui existait déjà (reprise, modification, réconciliation)
   * : elle est relue d'abord, car l'Admin a pu la placer, ou la regrouper, dans
   * une autre tournée, et on ne l'en sort jamais. Déjà dans une tournée : rien
   * n'est créé ni rattaché, et cette tournée devient celle du camion si aucune
   * ligne ne la porte. Dans aucune : la tournée enregistrée du camion est reprise,
   * à défaut une tournée est créée, puis la commande y est rattachée. Commande
   * disparue, terminée, refusée ou annulée : échec définitif (alerte), aucune
   * tournée reprise ni créée.
   */
  private async tourneeUnitaire(
    collecte: Collecte,
    tournee: TourneeRow,
    customerOrderId: string,
    orderNumber: string,
    commande: 'neuve' | Mts1CustomerOrder | null,
  ): Promise<void> {
    let tourId = tournee.tms_reference;
    if (commande !== 'neuve') {
      const lue =
        commande ??
        (await this.client.findOrdersByIds([customerOrderId])).find(
          (c) => c.customerOrderId === customerOrderId,
        );
      // Commande disparue de chez MTS-1 : y créer une tournée ne commanderait
      // rien. Échec définitif (donc alerte), comme pour une modification reprise.
      if (!lue) {
        throw new LogistiquePermanentError(
          `collecte ${collecte.id} : commande introuvable chez MTS-1 pour le rang ${tournee.rang} (${customerOrderId}) — tournée non créée`,
        );
      }
      // Commande terminée ou archivée (décision Val 2026-10-13, même règle qu'à la
      // recherche par numéro), refusée ou annulée : sa tournée n'est ni reprise ni
      // créée. Échec définitif, donc alerte.
      if (
        STATUTS_COMMANDE_TERMINEE.has(lue.customerOrderStatus) ||
        STATUTS_COMMANDE_MORTE.has(lue.customerOrderStatus)
      ) {
        throw new LogistiquePermanentError(
          `collecte ${collecte.id} : la commande du rang ${tournee.rang} (${customerOrderId}) est ${
            STATUTS_COMMANDE_TERMINEE.has(lue.customerOrderStatus)
              ? 'déjà terminée'
              : 'refusée ou annulée'
          } chez MTS-1 (${lue.customerOrderStatus}) — tournée ni reprise ni créée`,
        );
      }
      // Formes mesurées de `tourId` : une chaîne quand la commande est dans une
      // tournée, clé absente sinon (`null` est lu de même, non mesuré). Sous une
      // autre forme (nombre, chaîne vide, caractère hors de l'alphabet), refusé :
      // lu comme « aucune tournée », il ferait créer une tournée et sortir la
      // commande de celle de l'Admin.
      const designe: unknown = lue.currentTour?.tourId;
      if (designe !== undefined && designe !== null) {
        if (!estIdentifiantMts1(designe)) {
          throw new LogistiqueTransientError(
            `MTS-1 GET /v3/customerOrders : réponse inattendue, currentTour.tourId illisible pour la commande ${customerOrderId}`,
          );
        }
        if (!tourId) await this.adopterTournee(tournee.id, designe);
        return;
      }
    }
    if (!tourId) {
      const created = await this.client.createTour(
        this.buildTourPayload(collecte, orderNumber),
      );
      tourId = created.tourId;
      // Commit immédiat
      await this.updateTourneeRef(
        tournee.id,
        tourId,
        customerOrderId,
        orderNumber,
      );
    }
    await this.client.addCustomerOrderToTour(
      tourId,
      customerOrderId,
      orderNumber,
    );
  }

  // Tournée où la commande se trouve déjà (posée par l'Admin, ou créée par une
  // tentative précédente dont la référence n'a pas été écrite) : elle devient
  // celle du camion, sauf si une autre ligne la porte déjà — tournée regroupée
  // par l'Admin avec celle d'un autre camion, ou prise par un passage voisin.
  // C'est l'index unique `uniq_tournee_par_tms_reference` qui le dit (23505 :
  // rien à faire). La relève lit de toute façon la tournée sur la commande.
  private async adopterTournee(
    tourneeId: string,
    tourId: string,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('tournees')
      .update({ tms_reference: tourId })
      .eq('id', tourneeId);
    if (error && error.code !== '23505') {
      throw new LogistiqueTransientError(
        `Référence de la tournée ${tourId} non écrite — ${error.message}`,
      );
    }
  }

  // Commit du curseur de la tournée unitaire, juste après sa création.
  //
  // Écriture en échec : la tournée existe chez MTS-1 et son identifiant n'est
  // dans aucun curseur. La reprise ne la retrouvera que par sa commande
  // (tourneeUnitaire relit la commande) : on rattache donc la commande AVANT de
  // lever. Si ce rattachement échoue, ou ne part pas (échéance du passage
  // atteinte), la tournée reste vide chez MTS-1 et la reprise en créera une
  // autre : l'erreur le dit.
  //
  // Refus 23505 de l'index unique `uniq_tournee_par_tms_reference` : MTS-1 aurait
  // rendu à la création l'identifiant d'une tournée qu'une autre ligne porte déjà
  // (non mesuré). La commande y est rattachée avant l'erreur ; la reprise la lit
  // sur la commande et, la tournée étant portée ailleurs, ne la reprend pas.
  private async updateTourneeRef(
    tourneeId: string,
    tourId: string,
    customerOrderId: string,
    orderNumber: string,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('tournees')
      .update({ tms_reference: tourId })
      .eq('id', tourneeId);
    if (!error) return;

    const rattachee = await this.client
      .addCustomerOrderToTour(tourId, customerOrderId, orderNumber)
      .then(
        () => true,
        () => false,
      );
    throw this.curseurNonEcrit(
      `tournée ${tourId} (commande ${customerOrderId} ${
        rattachee ? 'rattachée' : 'NON rattachée'
      })`,
      error,
    );
  }

  // Référence lisible de la collecte pour l'affichage Admin / le rapprochement :
  // l'identifiant de la commande du rang 1. Réécriture inconditionnelle : la
  // valeur est stable par construction (lue sur la tournée déjà committée en
  // reprise ; le rang 1 n'est jamais supprimé par une réduction de N) → un rejeu
  // réécrit la même chaîne.
  private async updateCollecteRef(
    collecteId: string,
    reference: string,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('collectes')
      .update({ tms_reference: reference })
      .eq('id', collecteId);
    if (error) {
      throw new LogistiqueTransientError(
        `Référence de la collecte ${collecteId} non écrite — ${error.message}`,
      );
    }
  }

  // Statut logistique de la collecte dont une commande vient d'être enregistrée :
  // « à attribuer », l'Admin compose la tournée dans la console MTS-1 (décision
  // Val 2026-10-15). Commande nouvelle : depuis tout statut de l'attribution — un
  // camion ajouté à une collecte acceptée la ramène à « à attribuer » (C47 : le
  // camion le moins avancé l'emporte). Commande déjà enregistrée (reprise) :
  // depuis « non envoyé » seulement — la relève a pu avancer le statut
  // entre-temps, une reprise ne le recule pas. Seulement sur une collecte à
  // valider ou validée (une réattribution la remet « programmée ») : jamais
  // une fois sa mission commencée, ni sur un refus ou une annulation. Une
  // écriture que cette garde écarte n'est pas une erreur.
  private async passerAAttribuer(
    collecteId: string,
    reprise: boolean,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('collectes')
      .update({
        statut_tms: 'a_attribuer',
        statut_tms_at: new Date().toISOString(),
      })
      .eq('id', collecteId)
      .in('statut', STATUTS_ATTRIBUTION_COLLECTE)
      .in(
        'statut_tms',
        reprise ? ['non_envoye'] : ['non_envoye', ...STATUT_TMS_PAR_NIVEAU],
      );
    if (error) {
      throw new LogistiqueTransientError(
        `Statut logistique de la collecte ${collecteId} non écrit — ${error.message}`,
      );
    }
  }

  // ─── Réconciliation plan B ────────────────────────────────────────────────────

  /**
   * Commande déjà créée chez MTS-1 pour cette clé, ou `null` — avant tout
   * re-POST d'une création reprise (§08 §3bis.9).
   */
  private async reconcileOrder(
    collecte: Collecte,
    cle: string,
  ): Promise<Mts1CustomerOrder | null> {
    // Fenêtre en JOURS : l'API ne lit que des « yyyy-MM-dd », bornes incluses,
    // jour compté à Paris (mesuré le 2026-10-13) — c'est-à-dire exactement
    // `date_collecte`, envoyée comme `orderDate` à la création. Un jour de marge
    // de chaque côté : un ordre manqué ferait re-POSTer un doublon sur une API
    // présumée non idempotente (§2).
    // Sans filtre `orderNumber` : il compare à l'égalité stricte (mesuré le
    // 2026-10-13), or le numéro envoyé porte un libellé qui a pu changer depuis
    // la création. La liste du jour est rendue en entier, sans pagination
    // (mesuré le 2026-10-13, 72 commandes) ; la clé est reconnue ici.
    // Limite connue : une collecte dont la date a changé de plus d'un jour entre
    // le POST perdu et la reprise sort de la fenêtre. La commande laissée
    // derrière n'a ni tournée ni transporteur ; elle reste à supprimer chez MTS-1.
    const jour = collecte.date_collecte;
    const orders = await this.client.scanOrdersByDateRange(
      decalerJour(jour, -1),
      decalerJour(jour, 1),
    );

    const duNumero = orders.filter((o) => numeroPorteLaCle(o.orderNumber, cle));

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
        `collecte ${collecte.id} : une commande de clé ${cle} est déjà terminée chez MTS-1 (${lesquelles.join(
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
        `MTS-1 GET /v3/customerOrders : réponse inattendue, customerOrderId illisible pour la clé ${cle}`,
      );
    }

    if (candidates.length > 1) {
      // Les autres restent chez MTS-1 : trace pour les y retrouver.
      await this.supabase.from('integrations_logs').insert({
        integration: 'mts1',
        direction: 'sortant',
        methode: 'GET',
        endpoint: '/v3/customerOrders',
        correlation_id: cle,
        erreur: `COMMANDES_EN_DOUBLE: ${candidates.length} commandes portent cette clé (${candidates.join(
          ', ',
        )}), reprise sur ${retenue}`,
      });
    }
    return vivantes.find((o) => o.customerOrderId === retenue) ?? null;
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
  private cleCommande(
    collecte: Collecte,
    rang: number,
    tournee?: Pick<TourneeRow, 'reference_interne'> | null,
  ): string {
    const tentative = tournee?.reference_interne?.match(/-r\d+$/)?.[0] ?? '';
    return `${collecte.id}-${rang}${tentative}`;
  }

  // Numéro envoyé à MTS-1 : « Traiteur - Lieu - N pax · clé », ou la clé seule
  // faute de libellé (cf. SEPARATEUR_CLE).
  private orderNumber(
    collecte: Collecte,
    rang: number,
    tournee?: Pick<TourneeRow, 'reference_interne'> | null,
  ): string {
    const cle = this.cleCommande(collecte, rang, tournee);
    const libelle = libelleCommande(collecte);
    return libelle ? `${libelle}${SEPARATEUR_CLE}${cle}` : cle;
  }

  // Contacts propagés au TMS : principal (toujours) + téléphone du secours (dès
  // qu'il existe, indépendamment du nom).
  // Partagé par buildOrderPayload (E1) ET buildUpdatePayload (E2) — R22c/BL-P2-10 :
  // les deux DOIVENT rester alignés, sinon une édition de contact post-dispatch ne
  // remonte jamais au prestataire (buildUpdatePayload ne poussait que place+orderDate).
  // Contact terrain → CustomerOrderContactInput (objet UNIQUE). MTS-1 n'expose
  // qu'UN `contact` sur la commande : on y met le contact PRINCIPAL, et le
  // téléphone du contact de SECOURS va en `phoneAlternatives`. Le NOM du secours
  // n'a pas de champ dédié → il figure dans le `comment` de la commande
  // (arbitrage Val 2026-09-14, §08 l.393-397 : « sans quoi le chauffeur a un
  // numéro de secours sans savoir qui appeler »), composé en AMONT par
  // `composerCommentaireTransporteur` (fetchCollecte), donc pour les DEUX
  // adapters — garde-fou 2 : ne pas le refaire ici. On ne dispose que d'un
  // `nom` complet → 1er mot = firstname, reste = lastname (cf. contactMts1).
  private buildContact(
    collecte: Collecte,
  ): CreateOrderPayload['contact'] | undefined {
    return contactMts1(
      collecte.contact_principal_nom,
      collecte.contact_principal_telephone,
      collecte.contact_secours_telephone,
    );
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
    // Contact de livraison (« Contact livr. ») : le contact de l'association,
    // quand son adresse part en clair. MTS-1 ne le prend en compte que pour une
    // adresse liée sans placeId (documentation V3) ; un lieu favori porte son
    // propre contact dans la console (décision Val 2026-10-15, C62).
    const contactLivraison =
      pointB && 'address' in pointB
        ? contactMts1(
            collecte.association_contact_nom,
            collecte.association_contact_telephone,
          )
        : undefined;
    const relatedAddress = pointB
      ? {
          relatedAddress: pointB,
          ...(contactLivraison ? { relatedContact: contactLivraison } : {}),
        }
      : {};

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
