// Adapter Everest (A Toutes!) — M2.5 (gate levée 2026-06-15).
//
// Pipeline dispatchCollecte :
//   1. Vérifier idempotence via everest_missions
//   2. Lire branche_attribution → service_id
//   3. Créer/upsert tournée + collecte_tournees
//   4. POST /missions/create → commit everest_mission_id
//   5. UPDATE collectes.statut_tms (trigger dérive collectes.statut)
//
// sync() = no-op (Everest est push-only via webhooks entrants).
// updateLieu() = no-op (adresse inline dans le payload mission).
// updateCollecte() = no-op + warning (endpoint non spécifié Everest V1).

import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  Collecte,
  FenetreSync,
  Lieu,
  LogistiqueProvider,
  Transporteur,
} from '../index.js';
import { LogistiquePermanentError } from '../index.js';
import type { CreateMissionPayload } from './client.js';
import { EverestClient } from './client.js';

// Mapping branche_attribution → service_id Everest
// service 77 (camion express >3.5h) n'a pas de branche_attribution mappée en V1
// — divergence signalée dans _Divergences/M2.5_20260615.md.
const BRANCHE_TO_SERVICE: Record<string, number> = {
  ag_velo_programme: 71,
  ag_velo_express: 74,
  ag_marathon_volume_backup_camion: 91,
};

// Durée créneau par service (minutes)
const SERVICE_SLOT_MINUTES: Record<number, number> = {
  71: 30,
  74: 30,
  77: 60,
  91: 30,
};

interface TourneeRow {
  id: string;
  external_ref_commande: string | null;
  statut: string;
  rang: number;
}

interface AttributionRow {
  branche_attribution: string;
}

export class AdapterEverest implements LogistiqueProvider {
  private readonly client: EverestClient;

  constructor(
    private readonly transporteur: Transporteur,
    private readonly supabase: SupabaseClient,
  ) {
    // Lit client_id depuis shared.prestataires via transporteur (injecté par la factory)
    // et client_secret depuis env var (alimentée depuis Vault en production).
    const clientId =
      process.env['EVEREST_CLIENT_ID'] ?? 'everest-client-id-missing';
    const clientSecret =
      process.env['EVEREST_CLIENT_SECRET'] ?? 'everest-client-secret-missing';
    this.client = new EverestClient(clientId, clientSecret, supabase);
  }

  // ─── E1 collecte.creee ───────────────────────────────────────────────────────

  async dispatchCollecte(collecte: Collecte, rang: number): Promise<void> {
    // V1 : 1 collecte AG = 1 mission Everest (rang toujours 1)
    const tourneeExistante = await this.findTournee(collecte.id, rang);

    // Idempotence : mission déjà créée et en état actif → no-op
    if (tourneeExistante?.external_ref_commande) {
      const mission = await this.findMission(tourneeExistante.id);
      if (
        mission?.statut_everest &&
        ['created', 'assigned', 'in_progress', 'completed'].includes(
          mission.statut_everest as string,
        )
      ) {
        return;
      }
    }

    // Lire branche_attribution depuis attributions_antgaspi
    const serviceId = await this.resolveServiceId(collecte.id);

    // Créer ou récupérer la tournée (upsert par reference_interne)
    const tournee = await this.upsertTournee(collecte, rang, serviceId);

    // POST /missions/create
    let missionId: string | null = null;
    try {
      const payload = this.buildMissionPayload(collecte, serviceId);
      const created = await this.client.createMission(payload, collecte.id);
      missionId = created.mission_id;

      // Commit external_ref_commande immédiatement (pattern garde-fou 5)
      await this.supabase
        .from('tournees')
        .update({ external_ref_commande: missionId })
        .eq('id', tournee.id);

      // INSERT everest_missions (statut 'created')
      await this.upsertEverestMission(tournee.id, collecte.id, {
        everest_mission_id: missionId,
        everest_service_id: serviceId,
        statut_everest: 'created',
      });
    } catch (err) {
      // Enregistrer l'échec même si la mission n'a pas été créée côté Everest
      await this.upsertEverestMission(tournee.id, collecte.id, {
        everest_mission_id: missionId,
        everest_service_id: serviceId,
        statut_everest: 'creation_failed',
      });
      throw err;
    }

    // Mise à jour statut_tms (trigger fn_sync_statut_collecte_from_tms dérive collectes.statut)
    await this.updateStatutTms(collecte.id, 'attribuee_en_attente_acceptation');
  }

  // ─── E2 collecte.modifiee ────────────────────────────────────────────────────

  async updateCollecte(_collecte: Collecte): Promise<void> {
    // Endpoint de modification non spécifié côté Everest V1.
    // Divergence enregistrée dans _Divergences/M2.5_20260615.md (type: ambigu).
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'adapters',
        event: 'everest.update_collecte.noop',
        message:
          'updateCollecte Everest non implémenté V1 — endpoint non spécifié',
      }),
    );
  }

  // ─── E3 collecte.annulee ─────────────────────────────────────────────────────

  async cancelCollecte(collecte: Collecte): Promise<void> {
    const tournees = await this.findTournees(collecte.id);
    const avecRef = tournees.filter((t) => t.external_ref_commande);

    if (avecRef.length === 0) {
      // Jamais envoyé à Everest → no-op succès
      return;
    }

    for (const t of avecRef) {
      const mission = await this.findMission(t.id);

      // Idempotence : déjà annulée ou terminée
      if (
        mission?.statut_everest &&
        [
          'cancelled',
          'cancelled_externally',
          'completed',
          'completed_incomplete',
          'failed',
          'creation_failed',
        ].includes(mission.statut_everest as string)
      ) {
        continue;
      }

      await this.client.cancelMission(
        {
          mission_id: t.external_ref_commande!,
          reason: 'collecte_annulee',
        },
        `cancel-${collecte.id}-${t.id}`,
      );

      // UPDATE everest_missions.statut_everest = 'cancelled'
      if (mission) {
        await this.supabase
          .from('everest_missions')
          .update({
            statut_everest: 'cancelled',
            derniere_sync_at: new Date().toISOString(),
          })
          .eq('tournee_id', t.id);
      }

      // Tracer dans audit_log pour que W2 distingue annulation TMS vs externe
      await this.supabase.from('audit_log').insert({
        action: 'CANCEL',
        table_name: 'everest_missions',
        record_id: mission?.id ?? null,
        new_values: {
          cause: 'collecte_annulee',
          collecte_id: collecte.id,
          tournee_id: t.id,
          everest_mission_id: t.external_ref_commande,
        },
      });
    }
  }

  // ─── E5 lieu.champ_critique_modifie ──────────────────────────────────────────

  async updateLieu(_lieu: Lieu): Promise<void> {
    // Everest utilise l'adresse inline dans le payload mission.
    // Pas d'endpoint de mise à jour d'adresse sur mission existante V1.
    // no-op succès.
  }

  // ─── Sync (polling) ───────────────────────────────────────────────────────────

  async sync(_fenetre: FenetreSync): Promise<void> {
    // Everest est push-only : les statuts arrivent via webhooks entrants.
    // Le cron polling-mts1 appelle sync() sur tous les transporteurs —
    // pour Everest, c'est un no-op délibéré.
  }

  // ─── Helpers métier ───────────────────────────────────────────────────────────

  private async resolveServiceId(collecteId: string): Promise<number> {
    const { data } = await this.supabase
      .from('attributions_antgaspi')
      .select('branche_attribution')
      .eq('collecte_id', collecteId)
      .maybeSingle();

    if (!data) {
      throw new LogistiquePermanentError(
        `Pas d'attribution_antgaspi pour la collecte ${collecteId} — algo M2.3 requis avant dispatch Everest`,
      );
    }

    const attr = data as unknown as AttributionRow;
    const serviceId = BRANCHE_TO_SERVICE[attr.branche_attribution];

    if (!serviceId) {
      throw new LogistiquePermanentError(
        `branche_attribution "${attr.branche_attribution}" non mappée sur un service Everest V1`,
      );
    }

    return serviceId;
  }

  private buildMissionPayload(
    collecte: Collecte,
    serviceId: number,
  ): CreateMissionPayload {
    const slotMinutes = SERVICE_SLOT_MINUTES[serviceId] ?? 30;
    const [h = '00', m = '00'] = (collecte.heure_collecte ?? '00:00:00')
      .slice(0, 5)
      .split(':');
    const startHour = parseInt(h, 10);
    const startMin = parseInt(m, 10);
    const endMin = (startMin + slotMinutes) % 60;
    const endHour = startHour + Math.floor((startMin + slotMinutes) / 60);
    const pad = (n: number) => String(n).padStart(2, '0');
    const timeStart = `${pad(startHour)}:${pad(startMin)}`;
    const timeEnd = `${pad(endHour % 24)}:${pad(endMin)}`;

    return {
      service_id: serviceId,
      client_ref: collecte.id,
      pickup: {
        address: `${collecte.lieu.adresse_acces}, ${collecte.lieu.code_postal} ${collecte.lieu.ville}`,
        contact: {
          name: collecte.contact_principal_nom,
          phone: collecte.contact_principal_telephone,
        },
      },
      timeslot: {
        date: collecte.date_collecte,
        start: timeStart,
        end: timeEnd,
      },
      notes: collecte.informations_supplementaires ?? undefined,
      metadata: {
        savr_ref_type: 'collecte',
        savr_collecte_id: collecte.id,
        savr_transporteur_id: this.transporteur.id,
      },
    };
  }

  // ─── Helpers DB ───────────────────────────────────────────────────────────────

  private async findTournee(
    collecteId: string,
    rang: number,
  ): Promise<TourneeRow | null> {
    const { data } = await this.supabase
      .from('collecte_tournees')
      .select('rang, tournees!inner(id, external_ref_commande, statut)')
      .eq('collecte_id', collecteId)
      .eq('rang', rang)
      .maybeSingle();

    if (!data) return null;
    const raw = data as unknown as { rang: number; tournees: TourneeRow[] };
    const t = raw.tournees[0];
    if (!t) return null;
    return { ...t, rang: raw.rang };
  }

  private async findTournees(collecteId: string): Promise<TourneeRow[]> {
    const { data } = await this.supabase
      .from('collecte_tournees')
      .select('rang, tournees!inner(id, external_ref_commande, statut)')
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
    serviceId: number,
  ): Promise<TourneeRow> {
    const referenceInterne = `EVR-${collecte.id}-${rang}`;
    const typeVehicule =
      serviceId === 91 || serviceId === 77 ? 'poids_lourd' : 'velo_cargo';

    const { data: existante } = await this.supabase
      .from('tournees')
      .select('id, external_ref_commande, statut')
      .eq('reference_interne', referenceInterne)
      .maybeSingle();

    if (existante) {
      const t = existante as unknown as TourneeRow;
      return { ...t, rang };
    }

    const { data: creee, error } = await this.supabase
      .from('tournees')
      .insert({
        reference_interne: referenceInterne,
        date_tournee: collecte.date_collecte,
        creneau: 'soir',
        type_vehicule: typeVehicule,
        prestataire_logistique_id: this.transporteur.prestataire_logistique_id,
        statut: 'planifiee',
      })
      .select('id, external_ref_commande, statut')
      .single();

    if (error || !creee) {
      throw new LogistiquePermanentError(
        `Impossible de créer la tournée Everest ${referenceInterne} : ${String(error?.message)}`,
      );
    }

    const t = creee as unknown as TourneeRow;

    // Lier collecte ↔ tournée
    await this.supabase.from('collecte_tournees').insert({
      collecte_id: collecte.id,
      tournee_id: t.id,
      rang,
    });

    return { ...t, rang };
  }

  private async findMission(
    tourneeId: string,
  ): Promise<{ id: string; statut_everest: string } | null> {
    const { data } = await this.supabase
      .from('everest_missions')
      .select('id, statut_everest')
      .eq('tournee_id', tourneeId)
      .maybeSingle();

    return data as { id: string; statut_everest: string } | null;
  }

  private async upsertEverestMission(
    tourneeId: string,
    collecteId: string,
    fields: {
      everest_mission_id: string | null;
      everest_service_id: number;
      statut_everest: string;
    },
  ): Promise<void> {
    await this.supabase.from('everest_missions').upsert(
      {
        tournee_id: tourneeId,
        collecte_id: collecteId,
        everest_mission_id: fields.everest_mission_id,
        everest_service_id: fields.everest_service_id,
        statut_everest: fields.statut_everest,
        derniere_sync_at: new Date().toISOString(),
      },
      { onConflict: 'tournee_id' },
    );
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
}
