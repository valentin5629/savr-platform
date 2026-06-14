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

import type {
  Collecte,
  FenetreSync,
  Lieu,
  LogistiqueProvider,
  Transporteur,
} from '../index.js';
import { CancelWindowClosedError, LogistiquePermanentError } from '../index.js';
import type { CreateOrderPayload, CreateTourPayload } from './client.js';
import { Mts1Client } from './client.js';

interface TourneeRow {
  id: string;
  external_ref_commande: string | null;
  tms_reference: string | null;
  statut: string;
  rang: number;
}

// Suffixes flux ZD → libellés MTS-1 as-built
const FLUX_STUFFS_ZD = [
  'Bio-déchets (en kg)',
  'Carton (en kg)',
  'D.I.B (en kg)',
  'Film plastique (en kg)',
  'Verre (en kg)',
];

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
  ): Promise<void> {
    // Curseur : lire la tournee existante pour ce rang
    let tournee = await this.findTournee(collecte.id, rang);

    // Déjà entièrement dispatchée → idempotent no-op
    if (tournee?.tms_reference && tournee.statut === 'en_cours') {
      return;
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

    // Mise à jour statut_tms (trigger dérive collectes.statut)
    await this.updateStatutTms(collecte.id, 'attribuee_en_attente_acceptation');
  }

  // ─── E2 collecte.modifiee ────────────────────────────────────────────────────

  async updateCollecte(collecte: Collecte): Promise<void> {
    const tournees = await this.findTournees(collecte.id);
    const avecRef = tournees.filter((t) => t.external_ref_commande);

    // Pas encore envoyé à MTS-1 → no-op succès
    if (avecRef.length === 0) {
      return;
    }

    const updatePayload = this.buildUpdatePayload(collecte);
    for (const t of avecRef) {
      await this.client.updateOrder(
        t.external_ref_commande!,
        updatePayload,
        this.orderNumber(collecte, t.rang),
      );
    }
  }

  // ─── E3 collecte.annulee ─────────────────────────────────────────────────────

  async cancelCollecte(collecte: Collecte): Promise<void> {
    const tournees = await this.findTournees(collecte.id);
    const avecRef = tournees.filter((t) => t.external_ref_commande);

    // Pas encore envoyé à MTS-1 → no-op succès
    if (avecRef.length === 0) {
      return;
    }

    for (const t of avecRef) {
      try {
        await this.client.deleteOrder(
          t.external_ref_commande!,
          this.orderNumber(collecte, t.rang),
        );
      } catch (err) {
        if (
          err instanceof LogistiquePermanentError &&
          err.message.includes('MTS-1 4')
        ) {
          // 4xx MTS-1 sur annulation = fenêtre fermée (< 1h)
          throw new CancelWindowClosedError(
            `Annulation bloquée MTS-1 pour tournée ${t.id} : ${err.message}`,
          );
        }
        throw err;
      }
    }
  }

  // ─── E5 lieu.champ_critique_modifie ──────────────────────────────────────────

  async updateLieu(lieu: Lieu): Promise<void> {
    // Collectes futures non terminales pour ce lieu
    const { data: collectes } = await this.supabase
      .from('collectes')
      .select(
        `
        id, nb_camions_demande, date_collecte, heure_collecte, type,
        controle_acces_requis, informations_supplementaires,
        contact_principal_nom, contact_principal_telephone,
        contact_secours_nom, contact_secours_telephone,
        collecte_tournees!inner(tournee_id, rang, tournees!inner(id, external_ref_commande, tms_reference, statut))
      `,
      )
      .eq('lieu_id', lieu.id)
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

  // ─── sync — stub M1.5b ───────────────────────────────────────────────────────

  async sync(_fenetre: FenetreSync): Promise<void> {
    // M1.5b
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

  private async updateTourneeRef(
    tourneeId: string,
    tourId: string,
  ): Promise<void> {
    await this.supabase
      .from('tournees')
      .update({ tms_reference: tourId, statut: 'en_cours' })
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

  private buildOrderPayload(
    collecte: Collecte,
    rang: number,
  ): CreateOrderPayload {
    const isZd = collecte.type === 'zero_dechet';
    const adresse = `${collecte.lieu.adresse_acces}, ${collecte.lieu.code_postal} ${collecte.lieu.ville}`;
    const dateHeure = `${collecte.date_collecte}T${collecte.heure_collecte}`;

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

    return {
      customerOrderId,
      orderNumber: this.orderNumber(collecte, rang),
      stuffs,
    };
  }

  private buildUpdatePayload(collecte: Collecte): Record<string, unknown> {
    const adresse = `${collecte.lieu.adresse_acces}, ${collecte.lieu.code_postal} ${collecte.lieu.ville}`;
    return {
      place: { address: { addressSingleLine: adresse } },
      orderDate: collecte.date_collecte,
    };
  }
}
