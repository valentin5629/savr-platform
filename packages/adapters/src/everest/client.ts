// Client HTTP Everest — sortant (M2.5).
//
// Auth : un jeton fixe par compte A Toutes!, lu dans EVEREST_API_TOKEN (compte
// « SAVR » en production, « SAVR TEST » ailleurs) et envoyé en Bearer. Le client
// n'appelle JAMAIS POST /auth : chaque appel y crée un jeton et révoque le
// précédent (réponse d'Everest relayée par A Toutes!, 2026-10-19). Sur Vercel,
// chaque serveur qui démarrait s'authentifiait et coupait le jeton des autres.
// Jeton absent ou refusé (401) : un réglage à corriger, pas un refus du
// transporteur → erreur passagère (le worker retente à ses paliers) + alerte
// Slack critique. La collecte n'est jamais rejetée pour ce motif.
// Logs : integrations_logs (via callback pour éviter dépendance circulaire).
// Appel sans réponse : jamais le texte de l'erreur dans le message levé — `fetch`
// y recopie la valeur d'en-tête qu'il refuse, donc le jeton (cf.
// libelleErreurReseau). Ce message va dans outbox_events.last_error, l'alerte
// et la fiche collecte.

import type { SupabaseClient } from '@supabase/supabase-js';

import { sendAlert } from '@savr/shared/src/alerting/slack.js';
import { libelleErreurReseau } from '@savr/shared/src/api/erreur-reseau.js';
import { logger } from '@savr/shared/src/logger/index.js';

import {
  LogistiqueAmbiguousError,
  LogistiquePermanentError,
  LogistiqueTransientError,
} from '../index.js';
import type {
  EverestCancelResponse,
  EverestCreatedMission,
  EverestMissionDetail,
} from './mock.js';
import { verifierEcheance } from '../echeance-passage.js';
import { _getEverestHandlers } from './mock.js';

/** Le jeton du compte A Toutes! de cet environnement, ou null s'il n'est pas posé. */
export function lireJetonEverest(): string | null {
  const jeton = process.env['EVEREST_API_TOKEN']?.trim();
  return jeton ? jeton : null;
}

export interface CreateMissionPayload {
  service_id: number;
  client_ref: string;
  pickup: {
    address: string;
    contact: { name: string; phone: string };
  };
  // Point B = adresse de livraison du don (association destinataire). Toujours
  // présent sur une mission AG : une course sans destination n'a pas de sens.
  dropoff: {
    address: string;
    contact?: { name: string; phone: string };
  };
  timeslot: { date: string; start: string; end: string };
  notes?: string;
  metadata?: Record<string, string | null>;
}

export interface CancelMissionPayload {
  mission_id: string;
  reason?: string;
}

export class EverestClient {
  private readonly baseUrl: string;
  private readonly jeton: string | null;

  constructor(private readonly supabase: SupabaseClient) {
    this.baseUrl =
      process.env['EVEREST_BASE_URL'] ?? 'https://a-toute.everst.io/api';
    this.jeton = lireJetonEverest();
  }

  // ─── Jeton ─────────────────────────────────────────────────────────────────

  private async jetonOuAlerte(operation: string): Promise<string> {
    if (this.jeton) return this.jeton;
    return this.jetonInutilisable(operation, null);
  }

  // Jeton absent (statut null) ou refusé par Everest. Ni l'alerte ni l'erreur ne
  // citent le jeton.
  private async jetonInutilisable(
    operation: string,
    statut: number | null,
  ): Promise<never> {
    const constat =
      statut === null
        ? 'absent (EVEREST_API_TOKEN non posé)'
        : `refusé par Everest (${statut})`;
    // Une alerte qui ne part pas ne doit pas remplacer l'erreur passagère.
    await sendAlert({
      canal: 'critique',
      titre: statut === null ? 'Jeton Everest absent' : 'Jeton Everest refusé',
      message:
        `Everest ${operation} non abouti : jeton ${constat}. Poser dans ` +
        "EVEREST_API_TOKEN le jeton du compte A Toutes! de l'environnement " +
        '(SAVR en production, SAVR TEST ailleurs). Ne jamais appeler ' +
        '/api/auth : chaque appel révoque le jeton en cours.',
      metadata: {
        event: 'everest.jeton_inutilisable',
        operation,
        statut_http: statut ?? 'aucun',
      },
    }).catch((err: unknown) => {
      logger.warn('adapters.everest.alerte_jeton_non_envoyee', {
        operation,
        // Envoi par `fetch` : jamais le texte de l'erreur (cf. en-tête).
        error: libelleErreurReseau(err),
      });
    });
    throw new LogistiqueTransientError(
      `Everest ${operation} : jeton ${constat}`,
    );
  }

  // ─── Appels API ────────────────────────────────────────────────────────────

  async createMission(
    payload: CreateMissionPayload,
    correlationId: string,
  ): Promise<EverestCreatedMission> {
    const handlers = _getEverestHandlers();
    const t0 = Date.now();

    if (handlers) {
      const result = await handlers.createMission(
        payload as unknown as Record<string, unknown>,
      );
      if (!result.ok) {
        if (result.status === 401) {
          return this.jetonInutilisable('createMission', 401);
        }
        if (result.status >= 500) {
          throw new LogistiqueTransientError(
            `Everest createMission ${result.status} : ${result.error}`,
          );
        }
        throw new LogistiquePermanentError(
          `Everest createMission ${result.status} : ${result.error}`,
        );
      }
      return result.data;
    }

    const jeton = await this.jetonOuAlerte('createMission');
    const resp = await this.postJson('/missions/create', payload, jeton).catch(
      (err: unknown) => {
        throw new LogistiqueAmbiguousError(
          `Everest createMission timeout : ${libelleErreurReseau(err)}`,
        );
      },
    );

    await this.log({
      methode: 'POST',
      endpoint: '/missions/create',
      statut_http: resp.status,
      duree_ms: Date.now() - t0,
      correlation_id: correlationId,
    });

    if (resp.status === 401) {
      return this.jetonInutilisable('createMission', 401);
    }
    if (resp.status >= 500) {
      throw new LogistiqueTransientError(
        `Everest createMission ${resp.status}`,
      );
    }
    if (!resp.ok) {
      throw new LogistiquePermanentError(
        `Everest createMission ${resp.status}`,
      );
    }

    return (await resp.json()) as EverestCreatedMission;
  }

  async cancelMission(
    payload: CancelMissionPayload,
    correlationId: string,
  ): Promise<EverestCancelResponse> {
    const handlers = _getEverestHandlers();
    const t0 = Date.now();

    if (handlers) {
      const result = await handlers.cancelMission(
        payload as unknown as Record<string, unknown>,
      );
      if (!result.ok) {
        if (result.status === 401) {
          return this.jetonInutilisable('cancelMission', 401);
        }
        if (result.status >= 500) {
          throw new LogistiqueTransientError(
            `Everest cancelMission ${result.status} : ${result.error}`,
          );
        }
        throw new LogistiquePermanentError(
          `Everest cancelMission ${result.status} : ${result.error}`,
        );
      }
      return result.data;
    }

    const jeton = await this.jetonOuAlerte('cancelMission');
    const resp = await this.postJson('/missions/cancel', payload, jeton).catch(
      (err: unknown) => {
        throw new LogistiqueAmbiguousError(
          `Everest cancelMission timeout : ${libelleErreurReseau(err)}`,
        );
      },
    );

    await this.log({
      methode: 'POST',
      endpoint: '/missions/cancel',
      statut_http: resp.status,
      duree_ms: Date.now() - t0,
      correlation_id: correlationId,
    });

    if (resp.status === 401) {
      return this.jetonInutilisable('cancelMission', 401);
    }
    if (resp.status >= 500) {
      throw new LogistiqueTransientError(
        `Everest cancelMission ${resp.status}`,
      );
    }
    if (!resp.ok) {
      throw new LogistiquePermanentError(
        `Everest cancelMission ${resp.status}`,
      );
    }

    return (await resp.json()) as EverestCancelResponse;
  }

  // ─── GET mission (re-fetch — BL-P0-07) ─────────────────────────────────────
  // Webhook Everest = simple signal ; la vérité (coût, preuve, statut) est lue
  // ici par re-fetch API, jamais depuis le payload non signé (CDC 08 - APIs §3
  // l.241/279 « ne jamais faire confiance au payload »).

  async getMission(
    missionId: string,
    correlationId: string,
  ): Promise<EverestMissionDetail> {
    const handlers = _getEverestHandlers();
    const t0 = Date.now();

    if (handlers) {
      const result = await handlers.getMission(missionId);
      if (!result.ok) {
        if (result.status === 401) {
          return this.jetonInutilisable('getMission', 401);
        }
        if (result.status >= 500) {
          throw new LogistiqueTransientError(
            `Everest getMission ${result.status} : ${result.error}`,
          );
        }
        throw new LogistiquePermanentError(
          `Everest getMission ${result.status} : ${result.error}`,
        );
      }
      return result.data;
    }

    const path = `/missions/${encodeURIComponent(missionId)}`;
    const jeton = await this.jetonOuAlerte('getMission');
    const resp = await this.getJson(path, jeton).catch((err: unknown) => {
      throw new LogistiqueAmbiguousError(
        `Everest getMission timeout : ${libelleErreurReseau(err)}`,
      );
    });

    await this.log({
      methode: 'GET',
      endpoint: path,
      statut_http: resp.status,
      duree_ms: Date.now() - t0,
      correlation_id: correlationId,
    });

    if (resp.status === 401) {
      return this.jetonInutilisable('getMission', 401);
    }
    if (resp.status >= 500) {
      throw new LogistiqueTransientError(`Everest getMission ${resp.status}`);
    }
    if (!resp.ok) {
      throw new LogistiquePermanentError(`Everest getMission ${resp.status}`);
    }

    // Mapping réponse API → EverestMissionDetail. Noms de champs provisoires
    // (endpoint gelé tant que dev Everest n'a pas répondu — CDC §3 l.241) ;
    // jamais exercé en test (mock handlers). On reste tolérant aux variantes.
    const raw = (await resp.json()) as Record<string, unknown>;
    return {
      mission_id: String(raw['mission_id'] ?? raw['id'] ?? missionId),
      status: String(raw['status'] ?? raw['mission_status'] ?? ''),
      cout_ht: toNumberOrNull(raw['cost'] ?? raw['cout_ht']),
      preuve_url:
        (raw['proof_url'] as string | undefined) ??
        (raw['preuve_url'] as string | undefined) ??
        null,
      coursier_nom:
        (raw['driver_name'] as string | undefined) ??
        (raw['coursier_nom'] as string | undefined) ??
        null,
      coursier_telephone:
        (raw['driver_phone'] as string | undefined) ??
        (raw['coursier_telephone'] as string | undefined) ??
        null,
      vehicule_type:
        (raw['vehicle_type'] as string | undefined) ??
        (raw['vehicule_type'] as string | undefined) ??
        null,
    };
  }

  // ─── Primitives HTTP ───────────────────────────────────────────────────────

  // postJson et getJson ne sont PAS `async`, à dessein : un refus à l'échéance
  // est levé avant qu'une promesse existe. Il ne passe donc pas par les `.catch`
  // des appelants, qui le rhabilleraient en « timeout » ambigu.
  private postJson(
    path: string,
    body: unknown,
    token: string,
  ): Promise<Response> {
    verifierEcheance(`Everest POST ${path}`);
    return fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  }

  private getJson(path: string, token: string): Promise<Response> {
    verifierEcheance(`Everest GET ${path}`);
    return fetch(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });
  }

  // ─── Logging ───────────────────────────────────────────────────────────────

  private async log(entry: {
    methode: string;
    endpoint: string;
    statut_http?: number;
    duree_ms: number;
    correlation_id: string;
    erreur?: string;
  }): Promise<void> {
    await this.supabase.from('integrations_logs').insert({
      integration: 'everest',
      direction: 'sortant',
      methode: entry.methode,
      endpoint: entry.endpoint,
      statut_http: entry.statut_http,
      duree_ms: entry.duree_ms,
      correlation_id: entry.correlation_id,
      erreur: entry.erreur,
    });
  }
}

function toNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// ─── Point d'entrée re-fetch pour le code métier (BL-P0-07) ────────────────────
// Le webhook (packages/plateforme) ne parle JAMAIS directement à Everest
// (garde-fou 3) : il appelle ce helper exporté par @savr/adapters, qui construit
// le client depuis l'env (alimenté par Vault en prod) et re-fetch la mission.
export async function fetchEverestMissionDetails(
  missionId: string,
  supabase: SupabaseClient,
  correlationId: string,
): Promise<EverestMissionDetail> {
  const client = new EverestClient(supabase);
  return client.getMission(missionId, correlationId);
}
