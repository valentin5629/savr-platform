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

import { sendAlert } from '@savr/shared/src/alerting/slack.js';

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
  LogistiquePermanentError,
  LogistiqueTransientError,
} from '../index.js';
import {
  prestatairesDuType,
  retenirTourneesDuProvider,
} from '../provider-tournees.js';
import type { CreateMissionPayload } from './client.js';
import { EverestClient } from './client.js';

// Mapping branche_attribution → service_id Everest (§08 §3 V1, tableau l.264-269).
// BL-P1-API-04 — service 77 (camion express > 3,5h, Marathon indisponible) mappé
// sur la branche `ag_everest_camion_express` que l'algo M2.3 produit déjà
// (DIV-3, décision Val 2026-06-15). Sans ce mapping le dispatch express échoue.
const BRANCHE_TO_SERVICE: Record<string, number> = {
  ag_velo_programme: 71,
  ag_velo_express: 74,
  ag_everest_camion_express: 77,
  ag_marathon_volume_backup_camion: 91,
};

// Durée créneau par service (minutes)
const SERVICE_SLOT_MINUTES: Record<number, number> = {
  71: 30,
  74: 30,
  77: 60,
  91: 30,
};

// `prestataire_logistique_id` : seule marque du provider exécutant portée par une
// tournée — `external_ref_commande` est partagée (MTS-1 y stocke son
// customerOrderId, Everest son mission_id). Cf. provider-tournees.ts.
interface TourneeRow {
  id: string;
  external_ref_commande: string | null;
  statut: string;
  rang: number;
  prestataire_logistique_id: string | null;
}

interface AttributionRow {
  branche_attribution: string;
}

// Statuts sous lesquels une mission court encore (ou a couru) chez Everest :
// tant que l'un d'eux est enregistré, un second `createMission` enverrait un
// SECOND vélo sur la même collecte.
//
// `created_manually` en fait partie : c'est le FILET conservé par le CDC
// (§06.06 §3 Bloc 0, arbitrage Val 2026-09-16). Depuis cet arbitrage, la route
// admin/everest/missions/manual-accept exige la référence de mission et l'écrit
// comme au dispatch normal (`fn_accepter_mission_everest_manuelle`) : le gate
// d'émission répond `true` et un renvoi émet E2, pas E1. Mais les lignes posées
// AVANT (sans `everest_mission_id` ni `tournees.external_ref_commande`) existent,
// et un E1 déjà en retry peut arriver après l'acceptation : sans ce statut dans le
// set, un second vélo partirait sur une collecte déjà servie.
const MISSION_VIVANTE = new Set([
  'created',
  'created_manually',
  'assigned',
  'in_progress',
  'completed',
  // `completed_incomplete` est le jumeau de `completed` : le vélo EST sorti et
  // la course est facturée au tarif normal (V1). Le webhook l'écrit en
  // production sur une course vide (« Pas de commande » / « Client absent »,
  // CLAUDE.md §7), et enchaîne sur `realisee_sans_collecte`. Contrairement à la
  // note du CDC (« transition jamais déclenchée V1 »), ce statut est donc bien
  // atteint — l'exclure autorisait un re-POST sur une course déjà effectuée.
  'completed_incomplete',
]);

export class AdapterEverest implements LogistiqueProvider {
  private readonly client: EverestClient;
  private readonly clientId: string;

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
    this.clientId = clientId;
    this.client = new EverestClient(clientId, clientSecret, supabase);
  }

  // ─── E1 collecte.creee ───────────────────────────────────────────────────────

  async dispatchCollecte(
    collecte: Collecte,
    rang: number,
  ): Promise<ConsumerTag> {
    // V1 : 1 collecte AG = 1 mission Everest (rang toujours 1)
    const tourneeExistante = await this.findTournee(collecte.id, rang);

    // Idempotence : la vérité sur « une mission existe-t-elle chez Everest ? »
    // est `everest_missions`, JAMAIS `tournees.external_ref_commande`. Gater la
    // garde sur la référence rendait le no-op inatteignable dès que son commit
    // avait échoué au passage précédent : le rejeu du worker re-POSTait
    // `createMission` et un SECOND vélo partait, facturé, invisible en base.
    if (tourneeExistante) {
      const mission = await this.findMission(tourneeExistante.id);
      if (
        mission?.statut_everest &&
        MISSION_VIVANTE.has(mission.statut_everest as string)
      ) {
        // Réparation : la mission existe, seul son commit en base avait échoué.
        // On repose la référence ici plutôt que de la laisser manquante à vie
        // (sans elle, `cancelCollecte` ne sait plus quoi annuler). La garde sur
        // `everest_mission_id` n'est pas décorative : une mission acceptée au
        // téléphone n'en a pas — il n'y a alors rien à reposer, mais il ne faut
        // surtout pas en créer une seconde pour autant.
        if (
          !tourneeExistante.external_ref_commande &&
          mission.everest_mission_id
        ) {
          await this.commitReferenceMission(
            tourneeExistante.id,
            collecte.id,
            rang,
            mission.everest_mission_id,
          );
        }
        return 'adapter_everest';
      }
    }

    // Lire branche_attribution depuis attributions_antgaspi
    const serviceId = await this.resolveServiceId(collecte.id);

    // Créer ou récupérer la tournée (upsert par reference_interne)
    const tournee = await this.upsertTournee(collecte, rang, serviceId);

    // POST /missions/create
    let missionId: string | null = null;
    try {
      // client_ref = tournee.id (M14 W1 R_M14.2 / idempotence multi-camion V2)
      const payload = this.buildMissionPayload(collecte, tournee.id, serviceId);
      const pushAt = new Date().toISOString();
      const created = await this.client.createMission(payload, collecte.id);
      missionId = created.mission_id;

      // La mission EXISTE désormais chez Everest : on l'enregistre AVANT de
      // committer sa référence. Dans l'ordre inverse, un échec du commit sortait
      // par le catch avec `everest_missions` vide, donc sans trace de la mission.
      await this.upsertEverestMission(tournee.id, collecte.id, {
        everest_mission_id: missionId,
        everest_service_id: serviceId,
        statut_everest: 'created',
        everest_client_id: this.clientId,
        payload_create: payload,
        push_create_at: pushAt,
      });

      await this.commitReferenceMission(
        tournee.id,
        collecte.id,
        rang,
        missionId,
      );
    } catch (err) {
      // `creation_failed` veut dire « aucune mission chez Everest » — le CDC M14
      // §W1 prescrit un re-POST sur ce statut. Ne JAMAIS l'écrire quand le POST a
      // abouti : l'échec porte alors sur une écriture locale, pas sur Everest, et
      // le rejeu doit retrouver la mission au lieu d'en créer une seconde.
      if (missionId === null) {
        // Trace best-effort : rien n'existe chez Everest, donc la perdre ne
        // risque aucun doublon (le re-POST est légitime). Surtout, elle ne doit
        // pas masquer `err`, qui porte la vraie cause du rejet.
        await this.upsertEverestMission(tournee.id, collecte.id, {
          everest_mission_id: null,
          everest_service_id: serviceId,
          statut_everest: 'creation_failed',
        }).catch(() => undefined);
      }
      // BL-P1-ALGO-07 : rejet SYNCHRONE PERMANENT (4xx = refus prestataire) →
      // statut_tms = rejetee_par_prestataire (CDC 09 - Flux algo attribution AG
      // §3 « HTTP error sync »). Le trigger fn_sync ne dérive rien sur ce statut
      // → la collecte reste programmee (retour file d'attente + monitoring Ops).
      // Un TRANSIENT (5xx/timeout) ne rejette PAS : le worker retente (paliers).
      if (err instanceof LogistiquePermanentError) {
        // Un échec de cette écriture est déjà alerté par updateStatutTms ; il ne
        // doit pas remplacer `err`, qui porte le refus du transporteur.
        await this.updateStatutTms(
          collecte.id,
          'rejetee_par_prestataire',
        ).catch(() => undefined);
      }
      throw err;
    }

    // Mise à jour statut_tms (trigger fn_sync_statut_collecte_from_tms dérive collectes.statut)
    await this.updateStatutTms(collecte.id, 'attribuee_en_attente_acceptation');
    return 'adapter_everest';
  }

  // ─── E2 collecte.modifiee ────────────────────────────────────────────────────

  async updateCollecte(collecte: Collecte): Promise<ConsumerTag> {
    // Endpoint de modification non spécifié côté Everest V1.
    // Divergence enregistrée dans _Divergences/M2.5_20260615.md (type: ambigu).
    // BL-P2-34 : alerte Ops in-app (canal info), pas un console.warn perdu — une
    // modification d'une collecte AG déjà dispatchée Everest doit être traitée
    // manuellement (re-création mission), donc visible.
    await sendAlert({
      canal: 'info',
      titre: 'Modification collecte Everest non propagée',
      message: `updateCollecte Everest non implémenté V1 (endpoint non spécifié) — collecte ${collecte.id} : reporter la modification manuellement auprès d'A Toutes!.`,
      metadata: {
        collecte_id: collecte.id,
        event: 'everest.update_collecte.noop',
      },
    });
    return 'noop_no_remote';
  }

  // ─── E3 collecte.annulee ─────────────────────────────────────────────────────

  async cancelCollecte(collecte: Collecte): Promise<ConsumerTag> {
    const tournees = await this.findTournees(collecte.id);
    const avecRef = tournees.filter((t) => t.external_ref_commande);

    if (avecRef.length === 0) {
      // Jamais envoyé à Everest → no-op succès (consumer noop_no_remote)
      return 'noop_no_remote';
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

      // À partir d'ici la course EST annulée chez A Toutes! : une écriture locale
      // refusée ne se voit plus nulle part si on l'avale. Vécu : sous l'ancien
      // CHECK en équivalence, l'UPDATE d'une mission `created_manually` échouait
      // en 23514 et la collecte restait « mission vivante » en base.
      if (mission) {
        const { error } = await this.supabase
          .from('everest_missions')
          .update({
            statut_everest: 'cancelled',
            derniere_sync_at: new Date().toISOString(),
          })
          .eq('tournee_id', t.id);
        if (error) {
          await this.echecEcritureLocale(collecte.id, error, {
            code: 'everest_annulation_non_enregistree',
            titre: 'Annulation A Toutes! non enregistrée',
            message:
              `La course ${t.external_ref_commande} a été annulée chez A Toutes!, mais son statut n'a pas pu être enregistré ` +
              `(${error.message}). La mission apparaît encore active côté Savr.`,
          });
        }
      }

      // Tracer dans audit_log pour que W2 distingue annulation TMS vs externe.
      // Sans cette trace, le webhook `mission_cancelled` prend l'annulation pour
      // une annulation EXTERNE (cancelled_externally + rejet de la collecte).
      const { error: errAudit } = await this.supabase.from('audit_log').insert({
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
      if (errAudit) {
        await this.echecEcritureLocale(collecte.id, errAudit, {
          code: 'everest_trace_annulation_non_enregistree',
          titre: 'Trace d’annulation A Toutes! non enregistrée',
          message:
            `La course ${t.external_ref_commande} a été annulée chez A Toutes!, mais la trace de l'annulation Savr n'a pas pu être écrite ` +
            `(${errAudit.message}). Le webhook d'annulation la lira comme une annulation externe.`,
        });
      }
    }
    return 'adapter_everest';
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

  // ─── Health check (ops) ──────────────────────────────────────────────────────

  async healthCheck(): Promise<HealthCheckResult> {
    // Push-only (webhooks entrants) : aucun endpoint read-only de sonde en V1.
    // On rapporte seulement la présence des credentials, sans appel réseau.
    const configured =
      !!process.env['EVEREST_CLIENT_ID'] &&
      !!process.env['EVEREST_CLIENT_SECRET'];
    return {
      ok: true,
      etat: 'non_applicable',
      message: configured
        ? 'Everest push-only (webhooks entrants) — pas de sonde read-only V1.'
        : 'Everest push-only — credentials EVEREST_CLIENT_ID / EVEREST_CLIENT_SECRET absents.',
    };
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
    tourneeId: string,
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
      client_ref: tourneeId,
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

  /**
   * Tournée d'un rang donné — restreinte au provider courant (cf. findTournees).
   *
   * Passe par findTournees plutôt que par sa propre requête : le cloisonnement
   * par provider et la lecture de `error` n'ont ainsi qu'une implémentation.
   */
  private async findTournee(
    collecteId: string,
    rang: number,
  ): Promise<TourneeRow | null> {
    const tournees = await this.findTournees(collecteId);
    return tournees.find((t) => t.rang === rang) ?? null;
  }

  /**
   * Tournées d'une collecte **exécutées par A Toutes! (Everest)**.
   *
   * Symétrique de l'adapter MTS-1 : sans ce filtre, une tournée MTS-1
   * résiduelle faisait partir un `POST /missions/cancel` vers Everest avec un
   * customerOrderId MTS-1 — `cancelCollecte` ne regardait que la présence
   * d'une référence.
   *
   * Dans ce sens, la tournée résiduelle n'est pas transitoire : `upsertTournee`
   * lie la tournée Everest par un INSERT dont l'`error` n'est pas lue, et le
   * rang est déjà pris (`uniq_collecte_tournee_rang`). Le lien reste donc sur
   * la tournée MTS-1, et c'est elle que toute lecture ultérieure renvoie.
   */
  private async findTournees(collecteId: string): Promise<TourneeRow[]> {
    const { data, error } = await this.supabase
      .from('collecte_tournees')
      .select(
        'rang, tournees!inner(id, external_ref_commande, statut, prestataire_logistique_id)',
      )
      .eq('collecte_id', collecteId);

    // Une lecture DB en échec n'est pas « aucune tournée » : elle ferait
    // re-créer une mission déjà passée chez Everest (E1) ou conclure à un no-op
    // d'annulation (E3) sur une collecte pourtant dispatchée, event marqué
    // `done` sans retry ni alerte.
    if (error) {
      throw new LogistiqueTransientError(
        `Lecture des tournées de la collecte ${collecteId} échouée — ${error.message}`,
      );
    }

    // FK sortante `collecte_tournees.tournee_id` → embed OBJET, pas tableau.
    const rows = (data ?? []) as unknown as Array<{
      rang: number;
      tournees: TourneeRow;
    }>;

    return retenirTourneesDuProvider({
      supabase: this.supabase,
      typeTms: 'a_toutes',
      prestataires: await this.prestatairesEverest(),
      collecteId,
      tournees: rows.map((d) => ({ ...d.tournees, rang: d.rang })),
    });
  }

  /**
   * Prestataires joignables par Everest (`transporteurs.type_tms='a_toutes'`) —
   * cf. provider-tournees.ts. Chargé une fois par instance (référentiel stable
   * sur la durée d'un event) ; seul un Set NON VIDE est mémorisé (un Set vide
   * ferait taire le filtre au lieu de le fermer).
   */
  private async prestatairesEverest(): Promise<Set<string>> {
    this.prestatairesEverestCache ??= await prestatairesDuType(
      this.supabase,
      'a_toutes',
    );
    return this.prestatairesEverestCache;
  }

  private prestatairesEverestCache?: Set<string>;

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

    // Lier collecte ↔ tournée. L'`error` est lue : `uniq_collecte_tournee_rang`
    // rend cet INSERT faillible dès qu'un autre provider a déjà pris le rang
    // (re-dispatch MTS-1 → Everest). Avalé, le 23505 laissait le lien pointer
    // sur la tournée MTS-1 — et c'est elle que toute lecture ultérieure rendait,
    // durablement. Permanent : un rang déjà pris ne se résout pas en rejouant,
    // il demande un arbitrage Ops (l'event part en DLQ, avec alerte).
    const { error: errLien } = await this.supabase
      .from('collecte_tournees')
      .insert({
        collecte_id: collecte.id,
        tournee_id: t.id,
        rang,
      });
    if (errLien) {
      throw new LogistiquePermanentError(
        `Rattachement de la tournée ${t.id} au rang ${rang} de la collecte ${collecte.id} refusé — ${errLien.message}`,
      );
    }

    return { ...t, rang };
  }

  /**
   * Commit de la référence de mission (pattern garde-fou 5) + référence
   * d'affichage de la collecte (§04 Data Model l.1509, §06.06 bouton « Renvoyer
   * au TMS », §11 carte « Collectes non transmises »). Ce provider n'a pas de
   * notion de tour : la référence de rapprochement EST le missionId. Posée au
   * rang 1 seulement (V1 : 1 collecte AG = 1 mission). JAMAIS un prédicat
   * d'émission — cf. fn_collecte_commandee_chez_provider.
   *
   * L'`error` est lue : `uniq_tournee_par_external_ref` rend ce commit faillible,
   * et un échec avalé laisserait une mission vivante sans référence en base —
   * ni annulable, ni rapprochable.
   *
   * Taxonomie : une violation d'unicité (23505) ne se résout JAMAIS en rejouant
   * — Permanent, donc DLQ immédiate et alerte, plutôt que trois paliers aveugles.
   * Tout le reste (blip réseau/DB) est Transient.
   */
  private async commitReferenceMission(
    tourneeId: string,
    collecteId: string,
    rang: number,
    missionId: string,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('tournees')
      .update({ external_ref_commande: missionId })
      .eq('id', tourneeId);

    if (error) {
      const message = `Commit de la référence de mission ${missionId} échoué (tournée ${tourneeId}) — ${error.message}`;
      throw error.code === '23505'
        ? new LogistiquePermanentError(message)
        : new LogistiqueTransientError(message);
    }

    if (rang === 1) {
      await this.updateCollecteRef(collecteId, missionId);
    }
  }

  private async findMission(tourneeId: string): Promise<{
    id: string;
    statut_everest: string;
    everest_mission_id: string | null;
  } | null> {
    const { data, error } = await this.supabase
      .from('everest_missions')
      .select('id, statut_everest, everest_mission_id')
      .eq('tournee_id', tourneeId)
      .maybeSingle();

    // Cette lecture EST l'oracle d'idempotence du dispatch. Son `error` avalée
    // rendait `data = null`, donc « aucune mission » : la garde n'était pas
    // prise et `createMission` repartait — un second vélo pour un simple blip
    // PostgREST, sur une lecture jouée à CHAQUE dispatch. On lève : rejouer
    // coûte un palier, dépêcher deux vélos coûte une course.
    if (error) {
      throw new LogistiqueTransientError(
        `Lecture de la mission de la tournée ${tourneeId} échouée — ${error.message}`,
      );
    }

    return data as {
      id: string;
      statut_everest: string;
      everest_mission_id: string | null;
    } | null;
  }

  /**
   * Enregistre la mission — l'AUTRE face de l'oracle d'idempotence.
   *
   * Son `error` n'était pas lue : un échec silencieux sur le chemin de succès
   * laissait `everest_missions` vide alors que la mission tourne chez Everest,
   * et le rejeu, ne trouvant rien, en créait une seconde. On lève donc
   * (Transient). Le seul appel qui tolère l'échec est celui du `catch`, où
   * `missionId === null` : il n'y a alors rien chez Everest, et perdre cette
   * trace ne fait que laisser le re-POST légitime se rejouer.
   */
  private async upsertEverestMission(
    tourneeId: string,
    collecteId: string,
    fields: {
      everest_mission_id: string | null;
      everest_service_id: number;
      statut_everest: string;
      everest_client_id?: string;
      payload_create?: unknown;
      push_create_at?: string;
    },
  ): Promise<void> {
    const row: Record<string, unknown> = {
      tournee_id: tourneeId,
      collecte_id: collecteId,
      everest_mission_id: fields.everest_mission_id,
      everest_service_id: fields.everest_service_id,
      statut_everest: fields.statut_everest,
      derniere_sync_at: new Date().toISOString(),
    };
    if (fields.everest_client_id !== undefined)
      row['everest_client_id'] = fields.everest_client_id;
    if (fields.payload_create !== undefined)
      row['payload_create'] = fields.payload_create;
    if (fields.push_create_at !== undefined)
      row['push_create_at'] = fields.push_create_at;

    const { error } = await this.supabase
      .from('everest_missions')
      .upsert(row, { onConflict: 'tournee_id' });

    if (error) {
      throw new LogistiqueTransientError(
        `Enregistrement de la mission de la tournée ${tourneeId} échoué — ${error.message}`,
      );
    }
  }

  // Miroir de l'homologue camion. Réécriture inconditionnelle : la valeur est
  // stable (le missionId de la mission du rang 1, relu sur reprise).
  private async updateCollecteRef(
    collecteId: string,
    reference: string,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('collectes')
      .update({ tms_reference: reference })
      .eq('id', collecteId);
    if (error) {
      await this.echecEcritureLocale(collecteId, error, {
        code: 'everest_dispatch_non_enregistre',
        titre: 'Mission A Toutes! non enregistrée sur la collecte',
        message:
          `La mission ${reference} existe chez A Toutes!, mais sa référence n'a pas pu être écrite sur la collecte ` +
          `(${error.message}). La collecte apparaît encore « non transmise ».`,
      });
    }
  }

  private async updateStatutTms(
    collecteId: string,
    statutTms: string,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('collectes')
      .update({ statut_tms: statutTms })
      .eq('id', collecteId);
    if (error) {
      await this.echecEcritureLocale(collecteId, error, {
        code: 'everest_dispatch_non_enregistre',
        titre: 'Statut A Toutes! non enregistré sur la collecte',
        message:
          `Le statut « ${statutTms} » renvoyé par A Toutes! n'a pas pu être écrit sur la collecte ` +
          `(${error.message}). Le statut affiché ne reflète pas la réponse du transporteur.`,
      });
    }
  }

  /**
   * Écriture locale refusée après un échange avec A Toutes! : alerte Ops in-app
   * (anomalie fonctionnelle, jamais Slack — CLAUDE.md §13), puis levée.
   *
   * L'alerte est posée AVANT de lever : le worker qui rejoue ne répare pas
   * toujours (une annulation déjà enregistrée sort en idempotence, une mission
   * déjà vivante aussi) — l'alerte reste alors le seul signal. Dédupliquée par
   * `f_upsert_alerte_admin` sur (code, collecte, ouverte) ; best-effort, comme
   * dans provider-tournees.ts : une alerte perdue ne doit pas masquer l'erreur.
   *
   * Taxonomie : une violation de contrainte (classe 23) ne se résout pas en
   * rejouant → Permanent ; le reste (réseau, PostgREST) → Transient.
   */
  private async echecEcritureLocale(
    collecteId: string,
    error: { code?: string; message: string },
    alerte: { code: string; titre: string; message: string },
  ): Promise<never> {
    await this.supabase
      .rpc('f_upsert_alerte_admin', {
        p_code: alerte.code,
        p_titre: alerte.titre,
        p_message: alerte.message,
        p_entity_type: 'collectes',
        p_entity_id: collecteId,
      })
      .then(
        () => undefined,
        () => undefined,
      );
    const message = `${alerte.titre} (collecte ${collecteId}) — ${error.message}`;
    throw error.code?.startsWith('23')
      ? new LogistiquePermanentError(message)
      : new LogistiqueTransientError(message);
  }
}
