// Client HTTP Everest — sortant (M2.5).
//
// Auth Bearer : token sans TTL, invalidé uniquement par nouvelle /auth.
// Cache mémoire process par client_id (évite race condition d'invalidation
// mutuelle si deux process s'authentifient concurremment).
// Logs : integrations_logs (via callback pour éviter dépendance circulaire).

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  LogistiqueAmbiguousError,
  LogistiquePermanentError,
  LogistiqueTransientError,
} from '../index.js';
import type {
  EverestAuthResponse,
  EverestCancelResponse,
  EverestCreatedMission,
} from './mock.js';
import { _getEverestHandlers } from './mock.js';

// Cache token : keyed par client_id (en V1 un seul transporteur Everest)
const TOKEN_CACHE = new Map<string, string>();

// Mutex très léger : évite deux /auth concurrents sur le même client_id
const AUTH_IN_PROGRESS = new Map<string, Promise<string>>();

export interface CreateMissionPayload {
  service_id: number;
  client_ref: string;
  pickup: {
    address: string;
    contact: { name: string; phone: string };
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
  private readonly clientId: string;
  private readonly clientSecret: string;

  constructor(
    clientId: string,
    clientSecret: string,
    private readonly supabase: SupabaseClient,
  ) {
    this.baseUrl =
      process.env['EVEREST_BASE_URL'] ?? 'https://a-toute.everst.io/api';
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  // ─── Auth ──────────────────────────────────────────────────────────────────

  private async getToken(): Promise<string> {
    const cached = TOKEN_CACHE.get(this.clientId);
    if (cached) return cached;

    // Sérialiser les auth en cours pour éviter la race condition
    const existing = AUTH_IN_PROGRESS.get(this.clientId);
    if (existing) return existing;

    const authPromise = this.fetchNewToken();
    AUTH_IN_PROGRESS.set(this.clientId, authPromise);
    try {
      const token = await authPromise;
      return token;
    } finally {
      AUTH_IN_PROGRESS.delete(this.clientId);
    }
  }

  private async fetchNewToken(): Promise<string> {
    const handlers = _getEverestHandlers();
    const t0 = Date.now();
    const payload = {
      client_id: this.clientId,
      client_secret: this.clientSecret,
    };

    if (handlers) {
      const result = await handlers.auth(
        payload as unknown as Record<string, unknown>,
      );
      if (!result.ok) {
        throw new LogistiquePermanentError(
          `Everest auth échouée (${result.status}) : ${result.error}`,
        );
      }
      TOKEN_CACHE.set(this.clientId, result.data.access_token);
      return result.data.access_token;
    }

    const resp = await fetch(`${this.baseUrl}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    }).catch((err: unknown) => {
      throw new LogistiqueAmbiguousError(
        `Everest auth timeout : ${String(err)}`,
      );
    });

    await this.log({
      methode: 'POST',
      endpoint: '/auth',
      statut_http: resp.status,
      duree_ms: Date.now() - t0,
      correlation_id: this.clientId,
    });

    if (resp.status === 401 || resp.status === 403) {
      throw new LogistiquePermanentError(
        `Everest auth ${resp.status} : credentials invalides`,
      );
    }
    if (resp.status >= 500) {
      throw new LogistiqueTransientError(`Everest auth ${resp.status}`);
    }
    if (!resp.ok) {
      throw new LogistiquePermanentError(`Everest auth ${resp.status}`);
    }

    const data = (await resp.json()) as EverestAuthResponse;
    TOKEN_CACHE.set(this.clientId, data.access_token);
    return data.access_token;
  }

  // Invalider le cache sur 401 et re-tenter l'auth une fois
  private invalidateToken(): void {
    TOKEN_CACHE.delete(this.clientId);
  }

  // ─── Appels API avec retry auth ────────────────────────────────────────────

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

    const token = await this.getToken();
    let resp = await this.postJson('/missions/create', payload, token).catch(
      (err: unknown) => {
        throw new LogistiqueAmbiguousError(
          `Everest createMission timeout : ${String(err)}`,
        );
      },
    );

    // Lazy refresh sur 401
    if (resp.status === 401) {
      this.invalidateToken();
      const newToken = await this.getToken();
      resp = await this.postJson('/missions/create', payload, newToken).catch(
        (err: unknown) => {
          throw new LogistiqueAmbiguousError(
            `Everest createMission timeout (retry) : ${String(err)}`,
          );
        },
      );
      if (resp.status === 401) {
        await this.log({
          methode: 'POST',
          endpoint: '/missions/create',
          statut_http: 401,
          duree_ms: Date.now() - t0,
          correlation_id: correlationId,
          erreur: 'auth_failed_after_refresh',
        });
        throw new LogistiquePermanentError(
          'Everest auth toujours 401 après refresh — vérifier credentials Vault',
        );
      }
    }

    await this.log({
      methode: 'POST',
      endpoint: '/missions/create',
      statut_http: resp.status,
      duree_ms: Date.now() - t0,
      correlation_id: correlationId,
    });

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

    const token = await this.getToken();
    let resp = await this.postJson('/missions/cancel', payload, token).catch(
      (err: unknown) => {
        throw new LogistiqueAmbiguousError(
          `Everest cancelMission timeout : ${String(err)}`,
        );
      },
    );

    if (resp.status === 401) {
      this.invalidateToken();
      const newToken = await this.getToken();
      resp = await this.postJson('/missions/cancel', payload, newToken).catch(
        (err: unknown) => {
          throw new LogistiqueAmbiguousError(
            `Everest cancelMission timeout (retry) : ${String(err)}`,
          );
        },
      );
    }

    await this.log({
      methode: 'POST',
      endpoint: '/missions/cancel',
      statut_http: resp.status,
      duree_ms: Date.now() - t0,
      correlation_id: correlationId,
    });

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

  // ─── Primitives HTTP ───────────────────────────────────────────────────────

  private async postJson(
    path: string,
    body: unknown,
    token: string,
  ): Promise<Response> {
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

// Exposé pour les tests uniquement — invalide le cache d'un client_id donné.
export function _invalidateEverestTokenCache(clientId: string): void {
  TOKEN_CACHE.delete(clientId);
}
