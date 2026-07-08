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
// Réconciliation : si requires_reconciliation=true → scan minDate/maxDate avant re-POST.

import type { SupabaseClient } from '@supabase/supabase-js';
import { uploadObject } from '@savr/shared/src/r2/upload.js';

import type {
  Collecte,
  ConsumerTag,
  FenetreSync,
  Lieu,
  LogistiqueProvider,
  Transporteur,
} from '../index.js';
import { CancelWindowClosedError, LogistiquePermanentError } from '../index.js';
import type { CreateOrderPayload, CreateTourPayload } from './client.js';
import { Mts1Client } from './client.js';
import type { Mts1Tour } from './mock.js';

interface TourneeRow {
  id: string;
  external_ref_commande: string | null;
  tms_reference: string | null;
  statut: string;
  rang: number;
}

// Bucket R2 des photos de collecte (shared.fichiers.bucket). La clé porte le préfixe
// `photos/<collecteId>/…` — cf. processPhotos.
const PHOTO_BUCKET = 'collectes';

// Suffixes flux ZD → libellés MTS-1 as-built (sortant)
const FLUX_STUFFS_ZD = [
  'Bio-déchets (en kg)',
  'Carton (en kg)',
  'D.I.B (en kg)',
  'Film plastique (en kg)',
  'Verre (en kg)',
];

// Mapping libellés MTS-1 → codes flux_dechets (entrant)
// '_ignore' = volumétrie camion, jamais mappé sur un flux
const STUFF_TO_FLUX: Record<string, string | '_ignore'> = {
  'Bio-déchets (en kg)': 'biodechet',
  'Carton (en kg)': 'carton',
  'D.I.B (en kg)': 'dechet_residuel',
  'Film plastique (en kg)': 'emballage',
  'Verre (en kg)': 'verre',
  '<volume_du_camion>': '_ignore',
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

export class AdapterMts1 implements LogistiqueProvider {
  private readonly client: Mts1Client;

  constructor(
    private readonly transporteur: Transporteur,
    private readonly supabase: SupabaseClient,
  ) {
    this.client = new Mts1Client(supabase);
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

    // ── Étape 1 : POST /v3/customerOrders ──────────────────────────────────────
    let customerOrderId = tournee?.external_ref_commande ?? null;
    if (!customerOrderId) {
      // Réconciliation avant re-POST si claim expiré lors d'une tentative précédente
      if (opts?.requiresReconciliation) {
        customerOrderId = await this.reconcileOrder(collecte, rang);
      }
      if (!customerOrderId) {
        const created = await this.client.postOrder(
          this.buildOrderPayload(collecte, rang),
        );
        customerOrderId = created.id;
        // Commit immédiat — MTS-1 présumé NON idempotent (CLAUDE.md §2)
        tournee = await this.upsertTournee(collecte, rang, customerOrderId);
      } else {
        // Ordre trouvé via réconciliation, écrire le curseur sans re-POSTer
        tournee = await this.upsertTournee(collecte, rang, customerOrderId);
      }
    }

    // ── Étape 2 : POST /v3/tours ────────────────────────────────────────────────
    let tourId = tournee?.tms_reference ?? null;
    if (!tourId) {
      const tourPayload = this.buildTourPayload(
        collecte,
        rang,
        customerOrderId,
      );
      const created = await this.client.createTour(tourPayload);
      tourId = created.tourId;
      // Commit immédiat
      await this.updateTourneeRef(tournee!.id, tourId);
    }

    // ── Étape 3 : dispatch ──────────────────────────────────────────────────────
    const carrierCode = this.transporteur.code_transporteur_mts1;
    if (!carrierCode) {
      throw new LogistiquePermanentError(
        `transporteur ${this.transporteur.id} sans code_transporteur_mts1`,
      );
    }
    const orderNumber = this.orderNumber(collecte, rang);
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
    for (const t of avecRef.filter((t) => t.rang <= n)) {
      // A4 : sur reprise après timeout (requiresReconciliation), confirmer que
      // l'ordre existe encore côté MTS-1 avant le PUT. Un ordre disparu (annulé
      // entre-temps) ne doit pas être ré-adressé (le PUT n'est de toute façon
      // sûr/idempotent que sur un ordre vivant).
      if (opts?.requiresReconciliation) {
        const stillExists = await this.reconcileOrder(collecte, t.rang);
        if (!stillExists) continue;
      }
      await this.client.updateOrder(
        t.external_ref_commande!,
        updatePayload,
        this.orderNumber(collecte, t.rang),
      );
    }

    // BL-P1-RM-03 — augmentation N→N+k : créer les rangs manquants (1..N sans tournée)
    // via dispatchCollecte (idempotent, clé d'idempotence reference-{rang}). Une
    // grosse collecte dont Ops augmente N est ainsi entièrement servie.
    const rangsPresents = new Set(tournees.map((t) => t.rang));
    for (let rang = 1; rang <= n; rang++) {
      if (!rangsPresents.has(rang)) {
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
          this.orderNumber(collecte, t.rang),
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

    for (const t of avecRef) {
      // A4 : sur reprise après timeout (requiresReconciliation), le 1er DELETE a
      // pu aboutir côté MTS-1. On vérifie d'abord l'existence distante : ordre
      // absent = annulation déjà effective → court-circuit (succès idempotent),
      // jamais de faux « fenêtre fermée ».
      if (opts?.requiresReconciliation) {
        const stillExists = await this.reconcileOrder(collecte, t.rang);
        if (!stillExists) continue;
      }
      try {
        await this.client.deleteOrder(
          t.external_ref_commande!,
          this.orderNumber(collecte, t.rang),
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
    const { data: collectes } = await this.supabase
      .from('collectes')
      .select(
        `
        id, nb_camions_demande, date_collecte, heure_collecte, type,
        controle_acces_requis, informations_supplementaires,
        evenements!inner(lieu_id),
        collecte_tournees!inner(tournee_id, rang, tournees!inner(id, external_ref_commande, tms_reference, statut))
      `,
      )
      .eq('evenements.lieu_id', lieu.id)
      .gte('date_collecte', new Date().toISOString().split('T')[0])
      .not(
        'statut',
        'in',
        '(realisee,cloturee,annulee,rejetee_par_prestataire)',
      );

    if (!collectes?.length) return;

    for (const c of collectes) {
      // Supabase renvoie les relations !inner comme tableau — on prend [0]
      type CtRow = { rang: number; tournees: TourneeRow[] };
      const tournees = ((c.collecte_tournees ?? []) as unknown as CtRow[]).map(
        (ct) => ({ ...ct.tournees[0]!, rang: ct.rang }),
      );
      for (const t of tournees.filter(
        (t: TourneeRow) => t.external_ref_commande,
      )) {
        const orderNumber = `${c.id}-${t.rang}`;
        await this.client.updateOrder(
          t.external_ref_commande!,
          {
            place: {
              address: {
                addressSingleLine: `${lieu.adresse_acces}, ${lieu.code_postal} ${lieu.ville}`,
              },
            },
          },
          orderNumber,
        );
      }
    }
  }

  // ─── sync — polling entrant MTS-1 (M1.5b) ───────────────────────────────────

  async sync(fenetre: FenetreSync): Promise<void> {
    // Charge le référentiel une fois par run (stable)
    const fluxById = await this.loadFluxCodes();
    const seuils = await this.loadSeuils();

    const orders = await this.client.scanOrdersByDateRange(
      fenetre.depuis.toISOString(),
      fenetre.jusqu_a.toISOString(),
    );

    for (const order of orders) {
      try {
        await this.processOrder(order, fluxById, seuils);
      } catch (err) {
        await this.logEntrantError(
          'SYNC_ORDER_FAILED',
          `order ${order.id}: ${String(err)}`,
        );
      }
    }
  }

  private async processOrder(
    order: import('./mock.js').Mts1CustomerOrder,
    fluxById: Map<string, string>,
    seuils: { min: number; max: number },
  ): Promise<void> {
    // 1. Claim — dédup intra-run et inter-polls sur le même statut.
    // OUTBOX-04 : claim ATOMIQUE via upsert ON CONFLICT DO NOTHING (UNIQUE
    // (source, event_id_externe)). Un run concurrent qui a déjà pris la clé →
    // 0 ligne retournée (PAS une 23505 avalée). Toute AUTRE erreur (réseau,
    // contrainte tierce) DOIT remonter — sinon elle serait confondue avec
    // « déjà traité » → perte silencieuse d'event (§08 §3bis.7, R10).
    const eventKey = `mts1:${order.id}:${order.status}`;
    const { data: claimed, error: claimError } = await this.supabase
      .from('integrations_inbox')
      .upsert(
        {
          source: 'mts1',
          event_type: 'order_status',
          event_id_externe: eventKey,
          payload: { orderId: order.id, status: order.status },
        },
        { onConflict: 'source,event_id_externe', ignoreDuplicates: true },
      )
      .select('id')
      .limit(1);

    if (claimError && claimError.code !== '23505') {
      throw new Error(
        `integrations_inbox claim échoué (${claimError.code ?? '?'}): ${claimError.message}`,
      );
    }

    let inboxId: string;
    if (claimed?.length) {
      inboxId = claimed[0]!.id as string;
    } else {
      // A4-A2 : la clé existe déjà (ON CONFLICT). On NE skippe QUE si l'event a
      // été ENTIÈREMENT traité (traite=true). Sinon — crash d'un run précédent
      // entre l'upsert des pesées et markInboxDone — la simple présence de la clé
      // faisait skipper à jamais : la collecte ne passait jamais realisee (ni batch
      // J+1, ni bordereau). On REJOUE tant que traite=false : tous les effets sont
      // idempotents (update statut par id, upsert pesées par clé, agrégation
      // FOR UPDATE), donc le rejeu est sûr et finit par confirmer le traitement.
      const { data: existing } = await this.supabase
        .from('integrations_inbox')
        .select('id, traite')
        .eq('source', 'mts1')
        .eq('event_id_externe', eventKey)
        .maybeSingle();

      if (!existing || existing.traite === true) {
        return; // déjà entièrement traité (ou ligne absente)
      }
      inboxId = existing.id as string;
    }

    try {
      // 2. Trouver la tournée liée à cet ordre
      const tourneeInfo = await this.findTourneeByOrderId(order.id);
      if (!tourneeInfo) {
        // Commande MTS-1 sans tournée Savr associée → on l'ignore (pas dans notre système)
        await this.markInboxDone(inboxId);
        return;
      }
      const { collecteId, tourneeId, tmsReference, collecteStatut } =
        tourneeInfo;

      // 3. Mise à jour statut_tms
      const nouveauStatutTms = MTS1_STATUS_TO_TMS[order.status] ?? null;
      if (nouveauStatutTms) {
        await this.supabase
          .from('collectes')
          .update({
            statut_tms: nouveauStatutTms,
            statut_tms_at: new Date().toISOString(),
          })
          .eq('id', collecteId);
      }

      // IN_PROGRESSION → passage direct collectes.statut → 'en_cours'
      if (
        order.status === 'IN_PROGRESSION' &&
        ['programmee', 'validee'].includes(collecteStatut)
      ) {
        await this.supabase
          .from('collectes')
          .update({ statut: 'en_cours' })
          .eq('id', collecteId)
          .in('statut', ['programmee', 'validee']);
      }

      // 4. Récupérer les détails du tour si tms_reference connu
      if (tmsReference) {
        await this.processTourDetails(
          tmsReference,
          tourneeId,
          collecteId,
          collecteStatut,
          fluxById,
          seuils,
        );
      }

      // 5. Statuts terminaux MTS-1 → mise à jour tournée + agrégation (M1.8/M1.5c)
      // A7 : 'OK' = succès terminal réel (as-built §7), pas 'DELIVERED'.
      const MTS1_TERMINAUX = new Set(['OK', 'PARTIAL', 'CANCELED', 'KO']);
      if (MTS1_TERMINAUX.has(order.status)) {
        const nouveauStatutTournee =
          order.status === 'CANCELED' || order.status === 'KO'
            ? 'annulee'
            : 'terminee';

        await this.supabase
          .from('tournees')
          .update({ statut: nouveauStatutTournee })
          .eq('id', tourneeId);

        // Agrégation concurrente-sûre : RPC avec FOR UPDATE (R5/R6 CLAUDE.md §4)
        const { data: agrResultat } = await this.supabase
          .rpc('fn_agreger_terminal_collecte', { p_collecte_id: collecteId })
          .single();

        // KO partiel : ce tour était KO/CANCELED mais d'autres étaient OK → alerte in-app
        if (
          agrResultat === 'realisee' &&
          (order.status === 'CANCELED' || order.status === 'KO')
        ) {
          await this.supabase.rpc('f_upsert_alerte_admin', {
            p_code: 'collecte_partiellement_servie',
            p_titre: 'Collecte partiellement servie',
            p_message: `Un camion n'a pas pu collecter (statut MTS-1 ${order.status}).`,
            p_entity_type: 'collectes',
            p_entity_id: collecteId,
          });
        }
      }

      await this.markInboxDone(inboxId);
    } catch (err) {
      await this.supabase
        .from('integrations_inbox')
        .update({ erreur: String(err) })
        .eq('id', inboxId);
      throw err;
    }
  }

  private async processTourDetails(
    tourId: string,
    tourneeId: string,
    collecteId: string,
    collecteStatut: string,
    fluxById: Map<string, string>,
    seuils: { min: number; max: number },
  ): Promise<void> {
    const tour = await this.client.getTour(tourId);

    // BL-P1-API-03 — résoudre plaque + chauffeur depuis le référentiel carrier.
    await this.resolveCarrierForTournee(tour, tourneeId);

    for (const stop of tour.stops) {
      if (!stop.items?.length) continue;

      for (const item of stop.items) {
        const fluxCode = STUFF_TO_FLUX[item.stuff];

        // Volume du camion → ignorer silencieusement
        if (fluxCode === '_ignore') continue;

        // Stuff inconnu → alerte Ops in-app
        if (fluxCode === undefined) {
          await this.logEntrantError(
            'STUFF_INCONNU',
            `tournee=${tourneeId} stop=${stop.stopId} stuff="${item.stuff}"`,
          );
          continue;
        }

        const fluxId = fluxById.get(fluxCode);
        if (!fluxId || item.weight === null) continue;

        // Divergence post-clôture → aucune écriture
        if (collecteStatut === 'cloturee') {
          const { data: existante } = await this.supabase
            .from('pesees_tournees')
            .select('poids_kg')
            .eq('tournee_id', tourneeId)
            .eq('stop_id', stop.stopId)
            .eq('flux_id', fluxId)
            .maybeSingle();

          if (
            existante &&
            Math.abs((existante.poids_kg as number) - item.weight) > 0.001
          ) {
            // BL-P2-37 : 2 sorties attendues (§08 §3bis.7 l.442) — trace technique
            // integrations_logs ET alerte Ops in-app (sans ce signal, la vérité
            // MTS-1 diverge silencieusement du bordereau réglementaire).
            await this.logEntrantError(
              'PESEE_DIVERGENCE_POST_CLOTURE',
              `tournee=${tourneeId} stop=${stop.stopId} flux=${fluxCode} local=${String(existante.poids_kg)} distant=${item.weight}`,
            );
            await this.supabase.rpc('f_upsert_alerte_admin', {
              p_code: 'pesee_divergence_post_cloture',
              p_titre: 'Divergence pesée post-clôture',
              p_message: `Poids MTS-1 (${item.weight} kg) ≠ poids local (${String(existante.poids_kg)} kg) sur une collecte clôturée — tournée ${tourneeId} stop ${stop.stopId} flux ${fluxCode}. Correction = édition + recalcul + avoir (§05).`,
              p_entity_type: 'collectes',
              p_entity_id: collecteId,
            });
          }
          continue; // jamais d'écriture sur collecte clôturée
        }

        // Upsert pesée (idempotent — écrasement si poids modifié)
        await this.supabase.from('pesees_tournees').upsert(
          {
            tournee_id: tourneeId,
            stop_id: stop.stopId,
            flux_id: fluxId,
            poids_kg: item.weight,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'tournee_id,stop_id,flux_id' },
        );

        // Alerte in-app si pesée hors seuil (pas d'email, pas de Slack — §13 CLAUDE.md)
        if (item.weight < seuils.min || item.weight > seuils.max) {
          await this.supabase.rpc('f_upsert_alerte_admin', {
            p_code: 'pesee_hors_seuil',
            p_titre: 'Pesée hors seuil',
            p_message: `Poids ${item.weight} kg hors seuil [${seuils.min}–${seuils.max}] — tournée ${tourneeId} stop ${stop.stopId}.`,
            p_entity_type: 'collectes',
            p_entity_id: collecteId,
          });
        }
      }
    }

    // Téléchargement photos (non bloquant)
    await this.processPhotos(tourId, collecteId);
  }

  // BL-P1-API-03 — peuple tournees.plaque_immatriculation + chauffeur_nom à partir
  // du référentiel carrier (la plaque n'est PAS sur le tour, as-built §6). Algo :
  //   plaque    : dispatch.vehicleShareableCode        → vehicles[].numberPlate
  //   chauffeur : dispatch.transporterUserShareableCode → transporters[].firstname+lastname
  // Téléphone chauffeur NON exposé par l'API (as-built §6) → reste NULL.
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

    if (!plaque && !chauffeurNom) return;

    // Relecture du courant : idempotence + plaque_saisie_at au 1er enregistrement.
    const { data: cur } = await this.supabase
      .from('tournees')
      .select('plaque_immatriculation, chauffeur_nom')
      .eq('id', tourneeId)
      .maybeSingle();
    const curPlaque = (cur?.plaque_immatriculation as string | null) ?? null;
    const curChauffeur = (cur?.chauffeur_nom as string | null) ?? null;

    const updates: Record<string, unknown> = {};
    if (plaque && plaque !== curPlaque) {
      updates['plaque_immatriculation'] = plaque;
      if (!curPlaque) updates['plaque_saisie_at'] = new Date().toISOString();
    }
    if (chauffeurNom && chauffeurNom !== curChauffeur) {
      updates['chauffeur_nom'] = chauffeurNom;
    }
    if (Object.keys(updates).length === 0) return;

    await this.supabase.from('tournees').update(updates).eq('id', tourneeId);
  }

  private async processPhotos(
    tourId: string,
    collecteId: string,
  ): Promise<void> {
    let photos: import('./mock.js').Mts1Photo[];
    try {
      photos = await this.client.getPhotos(tourId);
    } catch {
      await this.logEntrantError('PHOTO_LIST_FAILED', `tourId=${tourId}`);
      return;
    }

    for (const photo of photos) {
      const storageKey = `photos/${collecteId}/${photo.tourId}/${photo.stopId}/${photo.photoId}.jpg`;

      // Dédup : photo déjà uploadée ?
      const { data: existante } = await this.supabase
        .schema('shared')
        .from('fichiers')
        .select('id')
        .eq('key', storageKey)
        .maybeSingle();

      if (existante) continue;

      // Téléchargement binaire
      let buffer: Buffer | null;
      try {
        buffer = await this.client.downloadPhoto(photo.url);
      } catch {
        await this.logEntrantError(
          'PHOTO_DOWNLOAD_FAILED',
          `tourId=${tourId} stopId=${photo.stopId} photoId=${photo.photoId}`,
        );
        continue;
      }

      if (buffer === null) {
        // 404 → log non bloquant, retentée au prochain changement de statut
        await this.logEntrantError(
          'PHOTO_DOWNLOAD_FAILED',
          `404 tourId=${tourId} stopId=${photo.stopId} photoId=${photo.photoId}`,
        );
        continue;
      }

      // Upload R2 D'ABORD, pointeur shared.fichiers ENSUITE : si l'upload échoue
      // (credentials absents, rejet R2), on log + on saute sans INSERT → JAMAIS de
      // ligne shared.fichiers orpheline pointant un objet inexistant (BL-P0-02).
      // Non bloquant pour le poll : la photo est retentée au prochain passage.
      try {
        await this.uploadPhotoToR2(storageKey, buffer);
      } catch {
        await this.logEntrantError(
          'PHOTO_UPLOAD_FAILED',
          `tourId=${tourId} stopId=${photo.stopId} photoId=${photo.photoId}`,
        );
        continue;
      }

      // Enregistrement dans shared.fichiers (objet désormais réellement présent sur R2)
      await this.supabase.schema('shared').from('fichiers').insert({
        storage_provider: 'r2',
        bucket: PHOTO_BUCKET,
        key: storageKey,
        content_type: 'image/jpeg',
        size_bytes: buffer.length,
        entity_type: 'collecte_photo',
        entity_id: collecteId,
      });
    }
  }

  // Upload binaire vers R2 (S3-compatible) via la signature AWS Sig V4 partagée
  // (@savr/shared/src/r2/upload). La logique R2/AWS-SDK vit hors packages/adapters/
  // (garde-fou 3). `uploadObject` LÈVE en cas d'échec → l'appelant ne persiste pas
  // de pointeur orphelin.
  private async uploadPhotoToR2(key: string, buffer: Buffer): Promise<void> {
    await uploadObject(PHOTO_BUCKET, key, buffer, 'image/jpeg');
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

  private async findTourneeByOrderId(customerOrderId: string): Promise<{
    collecteId: string;
    tourneeId: string;
    tmsReference: string | null;
    collecteStatut: string;
  } | null> {
    const { data } = await this.supabase
      .from('tournees')
      .select(
        'id, tms_reference, collecte_tournees!inner(collecte_id, collectes!inner(id, statut))',
      )
      .eq('external_ref_commande', customerOrderId)
      .maybeSingle();

    if (!data) return null;

    type Raw = {
      id: string;
      tms_reference: string | null;
      collecte_tournees: Array<{
        collecte_id: string;
        collectes: Array<{ id: string; statut: string }>;
      }>;
    };
    const raw = data as unknown as Raw;
    const ct = raw.collecte_tournees[0];
    if (!ct) return null;
    const collecte = ct.collectes[0];
    if (!collecte) return null;

    return {
      collecteId: collecte.id,
      tourneeId: raw.id,
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

  private async findTournee(
    collecteId: string,
    rang: number,
  ): Promise<TourneeRow | null> {
    const { data } = await this.supabase
      .from('collecte_tournees')
      .select(
        'rang, tournees!inner(id, external_ref_commande, tms_reference, statut)',
      )
      .eq('collecte_id', collecteId)
      .eq('rang', rang)
      .maybeSingle();

    if (!data) return null;
    // Supabase renvoie les relations !inner comme tableau — on prend [0]
    const raw = data as unknown as { rang: number; tournees: TourneeRow[] };
    const t = raw.tournees[0];
    if (!t) return null;
    return { ...t, rang: raw.rang };
  }

  private async findTournees(collecteId: string): Promise<TourneeRow[]> {
    const { data } = await this.supabase
      .from('collecte_tournees')
      .select(
        'rang, tournees!inner(id, external_ref_commande, tms_reference, statut)',
      )
      .eq('collecte_id', collecteId);

    if (!data) return [];
    const rows = data as unknown as Array<{
      rang: number;
      tournees: TourneeRow[];
    }>;
    return rows.map((d) => ({ ...d.tournees[0]!, rang: d.rang }));
  }

  private async upsertTournee(
    collecte: Collecte,
    rang: number,
    customerOrderId: string,
  ): Promise<TourneeRow> {
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
      .select('id, external_ref_commande, tms_reference, statut')
      .single();

    if (error || !tournee) {
      throw new LogistiquePermanentError(
        `Impossible de créer la tournée rang ${rang} : ${String(error)}`,
      );
    }

    // Lien collecte ↔ tournee avec rang
    await this.supabase
      .from('collecte_tournees')
      .upsert(
        { collecte_id: collecte.id, tournee_id: tournee.id, rang },
        { onConflict: 'collecte_id,rang' },
      );

    return { ...tournee, rang } as TourneeRow;
  }

  // Commit du curseur étape 2 : NE pose PAS statut='en_cours' (réservé au succès de
  // validate, étape 4). Sinon la garde de reprise (dispatchCollecte) sortirait en
  // no-op avant que dispatch+validate aient été joués → camion non commandé (bug C2).
  private async updateTourneeRef(
    tourneeId: string,
    tourId: string,
  ): Promise<void> {
    await this.supabase
      .from('tournees')
      .update({ tms_reference: tourId })
      .eq('id', tourneeId);
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

  private async reconcileOrder(
    collecte: Collecte,
    rang: number,
  ): Promise<string | null> {
    const minDate = new Date(collecte.date_collecte);
    minDate.setDate(minDate.getDate() - 1);
    const maxDate = new Date(collecte.date_collecte);
    maxDate.setDate(maxDate.getDate() + 1);

    const orders = await this.client.scanOrdersByDateRange(
      minDate.toISOString(),
      maxDate.toISOString(),
    );

    const expected = this.orderNumber(collecte, rang);
    const found = orders.find((o) => o.externalReference === expected);
    return found?.id ?? null;
  }

  // ─── Builders payload MTS-1 ──────────────────────────────────────────────────

  private orderNumber(collecte: Collecte, rang: number): string {
    return `${collecte.id}-${rang}`;
  }

  // Contacts propagés au TMS : principal (toujours) + secours (si nom ET téléphone).
  // Partagé par buildOrderPayload (E1) ET buildUpdatePayload (E2) — R22c/BL-P2-10 :
  // les deux DOIVENT rester alignés, sinon une édition de contact post-dispatch ne
  // remonte jamais au prestataire (buildUpdatePayload ne poussait que place+orderDate).
  private buildContacts(
    collecte: Collecte,
  ): Array<{ name: string; phone: string; role: string }> {
    const contacts = [
      {
        name: collecte.contact_principal_nom,
        phone: collecte.contact_principal_telephone,
        role: 'principal',
      },
    ];
    if (collecte.contact_secours_nom && collecte.contact_secours_telephone) {
      contacts.push({
        name: collecte.contact_secours_nom,
        phone: collecte.contact_secours_telephone,
        role: 'secours',
      });
    }
    return contacts;
  }

  private buildOrderPayload(
    collecte: Collecte,
    rang: number,
  ): CreateOrderPayload {
    const isZd = collecte.type === 'zero_dechet';
    const adresse = `${collecte.lieu.adresse_acces}, ${collecte.lieu.code_postal} ${collecte.lieu.ville}`;
    const dateHeure = `${collecte.date_collecte}T${collecte.heure_collecte}`;

    const contacts = this.buildContacts(collecte);

    const stuffs = isZd
      ? [
          ...FLUX_STUFFS_ZD.map((name) => ({
            name,
            task: 'PICKUP',
            quantity: 0,
          })),
          { name: '<volume_du_camion>', task: 'PICKUP', quantity: 1 },
        ]
      : undefined;

    return {
      orderNumber: this.orderNumber(collecte, rang),
      orderDate: collecte.date_collecte,
      timezone: 'Europe/Paris',
      serviceTime: 60,
      transportersNeededCount: 1,
      orderCategories: isZd ? ['Déchets'] : ['Alimentaire'],
      place: { address: { addressSingleLine: adresse } },
      timeslots: [{ start: dateHeure, end: dateHeure }],
      contacts,
      stuffs,
      // BL-P1-PROG-03 : informations_supplementaires → `comment` MTS-1 (§08 l.389),
      // pour que les instructions logistiques du programmeur atteignent le prestataire
      // (M01/M03/M05). controle_acces_requis n'a pas de champ natif MTS-1 (concern V2 TMS
      // via validate_tournee_controle_acces) → hors payload sortant V1.
      ...(collecte.informations_supplementaires
        ? { comment: collecte.informations_supplementaires }
        : {}),
    };
  }

  private buildTourPayload(
    collecte: Collecte,
    rang: number,
    customerOrderId: string,
  ): CreateTourPayload {
    const isZd = collecte.type === 'zero_dechet';
    const stuffs = isZd
      ? [
          ...FLUX_STUFFS_ZD.map((name) => ({
            name,
            task: 'PICKUP',
            quantity: 0,
          })),
          { name: '<volume_du_camion>', task: 'PICKUP', quantity: 1 },
        ]
      : undefined;

    // BL-P1-API-02 — lieu de dépôt AG (MTS_1_delivery_place, §08 §3bis.5 étape 2 /
    // relevé as-built l.60-61) : `placeId` favori de l'association destinataire
    // (favoritePlaces, §3bis.4 ; stocké sur associations.id_point_collecte_mts1).
    // Le pickup (traiteur) reste en adresse inline sur la commande (buildOrderPayload).
    // Sans ce champ, MTS-1 ignore où déposer les excédents AG.
    const deliveryPlaceId = collecte.association_id_point_collecte_mts1;

    return {
      customerOrderId,
      orderNumber: this.orderNumber(collecte, rang),
      stuffs,
      ...(deliveryPlaceId
        ? { deliveryPlace: { placeId: deliveryPlaceId } }
        : {}),
    };
  }

  private buildUpdatePayload(collecte: Collecte): Record<string, unknown> {
    const adresse = `${collecte.lieu.adresse_acces}, ${collecte.lieu.code_postal} ${collecte.lieu.ville}`;
    // R22c/BL-P2-10 : PUT /v3/customerOrders = merge partiel MTS-1 (seuls les champs
    // listés sont mis à jour ; stuffs/pesées/timeslots non listés sont préservés — le
    // code n'envoyait déjà que place+orderDate en comptant dessus). On repousse les
    // contacts pour qu'une édition de contact d'un événement déjà dispatché (E2
    // immédiat, §05 l.325) atteigne réellement le prestataire. buildOrderPayload (E1)
    // et buildUpdatePayload (E2) restent alignés via buildContacts(). pax : MTS-1 n'a
    // aucun champ dédié (§08 l.173, push silencieux ignoré) → jamais dans le payload
    // sortant V1 ; le signal part dans l'outbox E2, consommé par le TMS V2.
    return {
      place: { address: { addressSingleLine: adresse } },
      orderDate: collecte.date_collecte,
      contacts: this.buildContacts(collecte),
    };
  }
}
