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

// Contrat : swagger Everest (https://a-toute.everst.io/api/swagger.json, version
// 1.291.1, relevé le 2026-10-19). Toutes les routes sont des POST JSON ; une
// mission se désigne par sa `ref` (chaîne), et les réponses de création,
// annulation et relecture portent `{ mission: Mission }`.

// Corps de POST /missions/create. Seuls service_id, address_start et
// address_end sont obligatoires ; sans start_date, Everest prendrait le prochain
// créneau libre : le client en envoie toujours un.
export interface CreateMissionPayload {
  service_id: number;
  client_ref: string;
  /** Début de la mission, horodatage Unix en SECONDES. */
  start_date: number;
  address_start: string;
  address_start_name?: string;
  address_start_tel?: string;
  // Point B = adresse de livraison du don (association destinataire). Toujours
  // présent sur une mission AG : une course sans destination n'a pas de sens.
  address_end: string;
  address_end_name?: string;
  address_end_tel?: string;
  /** Consigne affichée au coursier sur la mission. */
  comment: string;
}

export interface CancelMissionPayload {
  ref: string;
}

// Champs de l'objet `Mission` du swagger que la Plateforme lit.
interface MissionEverest {
  ref?: string;
  client_ref?: string;
  service_id?: number;
  status?: string;
  status_text?: string;
  price_excl?: number;
  agent_name?: string;
  agent_tel?: string;
  agent_vehicle?: { name?: string } | null;
  medias?: Array<{ src?: string }>;
}

// La référence est ce qui rend une mission annulable et rapprochable : une
// réponse 200 qui ne la porte pas ne prouve pas qu'aucune mission n'existe, d'où
// une erreur ambiguë (comme un appel resté sans réponse), jamais un succès.
async function lireMission(
  resp: Response,
  operation: string,
): Promise<MissionEverest & { ref: string }> {
  const corps = (await resp.json().catch(() => null)) as {
    mission?: MissionEverest;
  } | null;
  const mission = corps?.mission;
  if (!mission || typeof mission.ref !== 'string' || mission.ref === '') {
    throw new LogistiqueAmbiguousError(
      `Everest ${operation} : réponse sans référence de mission`,
    );
  }
  return { ...mission, ref: mission.ref };
}

function texteOuNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
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

    const mission = await lireMission(resp, 'createMission');
    return {
      mission_id: mission.ref,
      client_ref: mission.client_ref ?? payload.client_ref,
      service_id: mission.service_id ?? payload.service_id,
      status: mission.status ?? '',
    };
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

    const mission = await lireMission(resp, 'cancelMission');
    return { mission_id: mission.ref, status: mission.status ?? '' };
  }

  // ─── Relecture d'une mission (re-fetch — BL-P0-07) ─────────────────────────
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

    const jeton = await this.jetonOuAlerte('getMission');
    const resp = await this.postJson(
      '/missions/get',
      { ref: missionId },
      jeton,
    ).catch((err: unknown) => {
      throw new LogistiqueAmbiguousError(
        `Everest getMission timeout : ${libelleErreurReseau(err)}`,
      );
    });

    await this.log({
      methode: 'POST',
      endpoint: '/missions/get',
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

    // `status` est le slug du statut, `status_text` son libellé : la route lit
    // le LIBELLÉ (« Pas de commande », CLAUDE.md §7), le slug ne sert qu'à défaut.
    const mission = await lireMission(resp, 'getMission');
    return {
      mission_id: mission.ref,
      // Réponse tierce : un champ d'un autre type que celui du swagger est lu
      // comme absent (un statut non textuel ferait échouer la route).
      status:
        texteOuNull(mission.status_text) ?? texteOuNull(mission.status) ?? '',
      cout_ht: toNumberOrNull(mission.price_excl),
      // Le swagger ne dit pas quelle image (photos et signatures) prouve le
      // passage : la première qui a une adresse.
      preuve_url: Array.isArray(mission.medias)
        ? texteOuNull(mission.medias.find((m) => texteOuNull(m?.src))?.src)
        : null,
      coursier_nom: texteOuNull(mission.agent_name),
      coursier_telephone: texteOuNull(mission.agent_tel),
      vehicule_type: texteOuNull(mission.agent_vehicle?.name),
    };
  }

  // ─── Primitives HTTP ───────────────────────────────────────────────────────

  // postJson n'est PAS `async`, à dessein : un refus à l'échéance
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
