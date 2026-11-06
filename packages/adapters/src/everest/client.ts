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
  EtapeMissionEverest,
  EverestUpdateResponse,
  PhotoMissionEverest,
  PhotoTelechargee,
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
  /** Commentaire propre à l'adresse de départ (swagger 1.294.1, lu le 2026-11-03). */
  address_start_comment?: string;
  // Point B = adresse de livraison du don (association destinataire). Toujours
  // présent sur une mission AG : une course sans destination n'a pas de sens.
  address_end: string;
  address_end_name?: string;
  address_end_tel?: string;
  /** Commentaire propre à l'adresse d'arrivée (swagger 1.294.1, lu le 2026-11-03). */
  address_end_comment?: string;
  /** Consigne affichée au coursier sur la mission. */
  comment: string;
}

export interface CancelMissionPayload {
  ref: string;
}

// Corps de POST /missions/update (swagger 1.294.1, relevé le 2026-10-30) : la
// mission se désigne par sa `ref`, seuls les champs fournis changent. Le
// service et la référence client ne sont jamais renvoyés.
export type UpdateMissionPayload = { ref: string } & Partial<
  Omit<CreateMissionPayload, 'service_id' | 'client_ref'>
>;

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
  medias?: Array<{
    src?: string;
    id?: number | string;
    type?: string;
    date?: number;
  }>;
  is_dispatch?: boolean;
  is_pickup?: boolean;
  is_success?: boolean;
  is_fail?: boolean;
  is_cancel?: boolean;
}

// Catégorie de l'étape courante. Une étape porte au plus un drapeau sur le
// compte A Toutes! (POST /statuses, 2026-11-03) ; l'ordre ne sert que si une
// réponse en portait plusieurs : la fin de course prime sur la progression.
function etapeMission(m: MissionEverest): EtapeMissionEverest | null {
  if (m.is_cancel === true) return 'annulee';
  if (m.is_fail === true) return 'echouee';
  if (m.is_success === true) return 'reussie';
  if (m.is_pickup === true) return 'enlevee';
  if (m.is_dispatch === true) return 'affectee';
  return null;
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

// Photos du coursier : les médias de type `photo` qui ont une adresse https et
// un identifiant. Un média d'une autre forme est ignoré, jamais une erreur.
function photosMission(m: MissionEverest): PhotoMissionEverest[] {
  if (!Array.isArray(m.medias)) return [];
  const photos: PhotoMissionEverest[] = [];
  for (const media of m.medias) {
    const src = texteOuNull(media?.src);
    const id =
      typeof media?.id === 'number' || typeof media?.id === 'string'
        ? String(media.id).trim()
        : '';
    if (media?.type !== 'photo' || !src || !src.startsWith('https://') || !id)
      continue;
    const date =
      typeof media.date === 'number' && Number.isFinite(media.date)
        ? new Date(media.date * 1000).toISOString()
        : null;
    photos.push({ id, src, prise_le: date });
  }
  return photos;
}

// Photo du coursier : JPG, PNG ou WEBP, 10 Mo au plus.
const TAILLE_MAX_PHOTO = 10 * 1024 * 1024;

/** Type d'une image lu sur sa signature, ou null si ce n'en est pas une. */
function formatImage(b: Buffer): string | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
    return 'image/jpeg';
  if (
    b.length >= 8 &&
    b
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return 'image/png';
  if (
    b.length >= 12 &&
    b.subarray(0, 4).toString('latin1') === 'RIFF' &&
    b.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    return 'image/webp';
  return null;
}

function texteOuNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

// Longueur gardée de la réponse d'un refus : assez pour la raison donnée par
// Everest, borné parce que le texte va dans last_error, le journal et la fiche.
export const LONGUEUR_MAX_MOTIF_REFUS = 300;

// Raison d'un refus (4xx, 5xx) lue dans la réponse d'Everest, sur une ligne et
// bornée. Sans elle la fiche n'affichait que « createMission 400 » (2026-10-30).
// Jamais lue sur un 401 : le refus du jeton a son propre message.
async function lireMotifRefus(resp: Response): Promise<string | null> {
  const texte = await resp.text().catch(() => '');
  const ligne = texte.replace(/\s+/g, ' ').trim();
  if (ligne === '') return null;
  return ligne.length > LONGUEUR_MAX_MOTIF_REFUS
    ? `${ligne.slice(0, LONGUEUR_MAX_MOTIF_REFUS)}…`
    : ligne;
}

function avecMotif(message: string, motif: string | null): string {
  return motif ? `${message} : ${motif}` : message;
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

    const motif =
      resp.ok || resp.status === 401 ? null : await lireMotifRefus(resp);

    await this.log({
      methode: 'POST',
      endpoint: '/missions/create',
      statut_http: resp.status,
      duree_ms: Date.now() - t0,
      correlation_id: correlationId,
      ...(motif ? { erreur: motif } : {}),
    });

    if (resp.status === 401) {
      return this.jetonInutilisable('createMission', 401);
    }
    if (resp.status >= 500) {
      throw new LogistiqueTransientError(
        avecMotif(`Everest createMission ${resp.status}`, motif),
      );
    }
    if (!resp.ok) {
      throw new LogistiquePermanentError(
        avecMotif(`Everest createMission ${resp.status}`, motif),
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

  // Modification d'une mission existante. Renvoyer les mêmes valeurs ne change
  // rien : un appel resté sans réponse est retenté (erreur passagère), pas
  // rapproché comme une création.
  async updateMission(
    payload: UpdateMissionPayload,
    correlationId: string,
  ): Promise<EverestUpdateResponse> {
    const handlers = _getEverestHandlers();
    const t0 = Date.now();

    if (handlers) {
      const result = await handlers.updateMission(
        payload as unknown as Record<string, unknown>,
      );
      if (!result.ok) {
        if (result.status === 401) {
          return this.jetonInutilisable('updateMission', 401);
        }
        if (result.status >= 500) {
          throw new LogistiqueTransientError(
            `Everest updateMission ${result.status} : ${result.error}`,
          );
        }
        throw new LogistiquePermanentError(
          `Everest updateMission ${result.status} : ${result.error}`,
        );
      }
      return result.data;
    }

    const jeton = await this.jetonOuAlerte('updateMission');
    const resp = await this.postJson('/missions/update', payload, jeton).catch(
      (err: unknown) => {
        throw new LogistiqueTransientError(
          `Everest updateMission sans réponse : ${libelleErreurReseau(err)}`,
        );
      },
    );

    const motif =
      resp.ok || resp.status === 401 ? null : await lireMotifRefus(resp);

    await this.log({
      methode: 'POST',
      endpoint: '/missions/update',
      statut_http: resp.status,
      duree_ms: Date.now() - t0,
      correlation_id: correlationId,
      ...(motif ? { erreur: motif } : {}),
    });

    if (resp.status === 401) {
      return this.jetonInutilisable('updateMission', 401);
    }
    if (resp.status >= 500) {
      throw new LogistiqueTransientError(
        avecMotif(`Everest updateMission ${resp.status}`, motif),
      );
    }
    if (!resp.ok) {
      throw new LogistiquePermanentError(
        avecMotif(`Everest updateMission ${resp.status}`, motif),
      );
    }

    const mission = await lireMission(resp, 'updateMission');
    return { mission_id: mission.ref, status: mission.status ?? '' };
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

    const motif =
      resp.ok || resp.status === 401 ? null : await lireMotifRefus(resp);

    await this.log({
      methode: 'POST',
      endpoint: '/missions/cancel',
      statut_http: resp.status,
      duree_ms: Date.now() - t0,
      correlation_id: correlationId,
      ...(motif ? { erreur: motif } : {}),
    });

    if (resp.status === 401) {
      return this.jetonInutilisable('cancelMission', 401);
    }
    if (resp.status >= 500) {
      throw new LogistiqueTransientError(
        avecMotif(`Everest cancelMission ${resp.status}`, motif),
      );
    }
    if (!resp.ok) {
      throw new LogistiquePermanentError(
        avecMotif(`Everest cancelMission ${resp.status}`, motif),
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

    const motif =
      resp.ok || resp.status === 401 ? null : await lireMotifRefus(resp);

    await this.log({
      methode: 'POST',
      endpoint: '/missions/get',
      statut_http: resp.status,
      duree_ms: Date.now() - t0,
      correlation_id: correlationId,
      ...(motif ? { erreur: motif } : {}),
    });

    if (resp.status === 401) {
      return this.jetonInutilisable('getMission', 401);
    }
    if (resp.status >= 500) {
      throw new LogistiqueTransientError(
        avecMotif(`Everest getMission ${resp.status}`, motif),
      );
    }
    if (!resp.ok) {
      throw new LogistiquePermanentError(
        avecMotif(`Everest getMission ${resp.status}`, motif),
      );
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
      statut_code: texteOuNull(mission.status),
      etape: etapeMission(mission),
      photos: photosMission(mission),
    };
  }

  // ─── Téléchargement d'une photo de mission ─────────────────────────────────
  // L'adresse est publique (stockage du transporteur) : le jeton n'y est JAMAIS
  // envoyé. Https seul, sans redirection, 30 s pour la réponse et son corps.

  async downloadPhoto(src: string): Promise<PhotoTelechargee> {
    const handlers = _getEverestHandlers();
    if (handlers) {
      return handlers.downloadPhoto
        ? handlers.downloadPhoto(src)
        : {
            contenu: Buffer.from([0xff, 0xd8, 0xff]),
            content_type: 'image/jpeg',
          };
    }
    if (!src.startsWith('https://')) {
      throw new LogistiquePermanentError(
        'Everest : adresse de photo non https',
      );
    }
    verifierEcheance('Everest GET photo');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      let resp: Response;
      try {
        resp = await fetch(src, {
          method: 'GET',
          redirect: 'error',
          signal: controller.signal,
        });
      } catch (err) {
        throw new LogistiqueTransientError(
          `Everest réseau (photo) : ${libelleErreurReseau(err)}`,
        );
      }
      if (!resp.ok) {
        throw resp.status >= 500
          ? new LogistiqueTransientError(`Everest photo ${resp.status}`)
          : new LogistiquePermanentError(`Everest photo ${resp.status}`);
      }
      // Taille annoncée trop grande : refusée avant d'être lue.
      const annoncee = Number(resp.headers.get('content-length') ?? '0');
      if (annoncee > TAILLE_MAX_PHOTO) {
        throw new LogistiquePermanentError(
          `Everest photo : taille ${annoncee} refusée`,
        );
      }
      const contenu = Buffer.from(await resp.arrayBuffer());
      if (contenu.length === 0 || contenu.length > TAILLE_MAX_PHOTO) {
        throw new LogistiquePermanentError(
          `Everest photo : taille ${contenu.length} refusée`,
        );
      }
      // Le stockage d'A Toutes! sert ses photos en `application/octet-stream`
      // (mesuré le 2026-11-03) : le format se lit sur les premiers octets.
      const contentType = formatImage(contenu);
      if (!contentType) {
        throw new LogistiquePermanentError(
          'Everest photo : contenu qui n’est pas une image JPG, PNG ou WEBP',
        );
      }
      return { contenu, content_type: contentType };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new LogistiqueTransientError('Everest timeout : photo');
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
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
