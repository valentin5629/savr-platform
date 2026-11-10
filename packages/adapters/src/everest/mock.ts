// Mock Everest — injection en CI (jamais l'API réelle).
// Pattern identique à mts1/mock.ts.

// ─── Types as-built Everest ───────────────────────────────────────────────────

// Formes lues par l'adapter et la route, après lecture de `{ mission }` par le
// client (client.ts). `mission_id` porte la `ref` Everest de la mission.
export interface EverestCreatedMission {
  mission_id: string;
  client_ref: string;
  service_id: number;
  status: string;
}

export interface EverestCancelResponse {
  mission_id: string;
  status: string;
}

export interface EverestUpdateResponse {
  mission_id: string;
  status: string;
}

// Détail mission relu par POST /missions/get (BL-P0-07). `status` = libellé du
// statut (`status_text`), à défaut son slug.
// Source de vérité du coût + de la preuve : webhook = signal, API = vérité
// (CDC 08 - APIs §3 l.241/279 « ne jamais faire confiance au payload »).
export interface EverestMissionDetail {
  mission_id: string;
  status: string;
  cout_ht: number | null;
  preuve_url: string | null;
  coursier_nom: string | null;
  coursier_telephone: string | null;
  vehicule_type: string | null;
  /** Code de l'étape (`status` de la mission, ex. `livraison-terminee`). */
  statut_code?: string | null;
  /** Catégorie de l'étape, lue sur les drapeaux `is_*` de la mission relue. */
  etape?: EtapeMissionEverest | null;
  /** Photos prises par le coursier (`medias` de type `photo`), dans l'ordre. */
  photos?: PhotoMissionEverest[];
}

/**
 * Photo prise par le coursier, lue dans `medias` de la mission relue (forme
 * mesurée sur le compte A Toute! le 2026-11-03 : `id` numérique, `type`
 * `photo`, `src` adresse publique, `date` en secondes). Les autres médias
 * (signatures…) ne sont pas des photos de la collecte.
 */
export interface PhotoMissionEverest {
  id: string;
  src: string;
  /** Prise de vue, ISO 8601, ou null si la mission ne la donne pas. */
  prise_le: string | null;
}

/**
 * Catégorie d'une étape Everest, d'après les drapeaux de la mission relue
 * (`is_cancel`, `is_fail`, `is_success`, `is_pickup`, `is_dispatch`, lus sur
 * le compte A Toute! le 2026-11-03). `null` = étape sans catégorie (mission
 * créée, coursier arrivé à destination…).
 */
export type EtapeMissionEverest =
  | 'affectee'
  | 'enlevee'
  | 'reussie'
  | 'echouee'
  | 'annulee';

export type EverestPostSuccess<T> = { ok: true; data: T };
export type EverestPostError = { ok: false; status: number; error: string };
export type EverestResult<T> = EverestPostSuccess<T> | EverestPostError;

// ─── Handlers injectables ─────────────────────────────────────────────────────

export interface EverestHandlers {
  createMission: (
    payload: Record<string, unknown>,
  ) => Promise<EverestResult<EverestCreatedMission>>;
  cancelMission: (
    payload: Record<string, unknown>,
  ) => Promise<EverestResult<EverestCancelResponse>>;
  updateMission: (
    payload: Record<string, unknown>,
  ) => Promise<EverestResult<EverestUpdateResponse>>;
  getMission: (
    missionId: string,
  ) => Promise<EverestResult<EverestMissionDetail>>;
  /** Téléchargement d'une photo de mission. Absent : une image simulée. */
  downloadPhoto?: (src: string) => Promise<PhotoTelechargee>;
}

/** Une photo téléchargée : son contenu et son type, lu sur la réponse. */
export interface PhotoTelechargee {
  contenu: Buffer;
  content_type: string;
}

let _handlers: EverestHandlers | null = null;

export function _setEverestHandlers(h: EverestHandlers | null): void {
  _handlers = h;
}

export function _getEverestHandlers(): EverestHandlers | null {
  return _handlers;
}

// ─── Setup mock prêt à l'emploi ───────────────────────────────────────────────

export interface MockMissionState {
  missions: Map<string, EverestCreatedMission>;
  /** Payload brut envoyé à createMission, keyed par client_ref */
  payloads: Map<string, Record<string, unknown>>;
  cancelledIds: Set<string>;
  /** Corps envoyés à updateMission, dans l'ordre. */
  updates: Array<Record<string, unknown>>;
  /** Détails relus par POST /missions/get, keyed par mission_id (BL-P0-07) */
  details: Map<string, EverestMissionDetail>;
}

export function setupEverestMock(
  opts: {
    createFails?: boolean;
    createFailsStatus?: number;
    cancelFails?: boolean;
    updateFailsStatus?: number;
    getMissionFails?: boolean;
    getMissionFailsStatus?: number;
  } = {},
): MockMissionState {
  const state: MockMissionState = {
    missions: new Map(),
    payloads: new Map(),
    cancelledIds: new Set(),
    updates: [],
    details: new Map(),
  };

  let missionCounter = 0;

  _setEverestHandlers({
    createMission: async (payload) => {
      if (opts.createFails) {
        return {
          ok: false,
          status: opts.createFailsStatus ?? 500,
          error: 'Everest API error',
        };
      }
      missionCounter++;
      const client_ref = String(payload['client_ref'] ?? '');
      const service_id = Number(payload['service_id'] ?? 71);
      const mission: EverestCreatedMission = {
        mission_id: `EVR-MOCK-${missionCounter}`,
        client_ref,
        service_id,
        status: 'pending',
      };
      state.missions.set(client_ref, mission);
      state.payloads.set(client_ref, payload);
      return { ok: true, data: mission };
    },

    cancelMission: async (payload) => {
      if (opts.cancelFails) {
        return { ok: false, status: 500, error: 'Cancel error' };
      }
      const mission_id = String(payload['ref'] ?? '');
      state.cancelledIds.add(mission_id);
      return { ok: true, data: { mission_id, status: 'cancelled' } };
    },

    updateMission: async (payload) => {
      if (opts.updateFailsStatus) {
        return {
          ok: false,
          status: opts.updateFailsStatus,
          error: 'Everest updateMission error',
        };
      }
      state.updates.push(payload);
      const mission_id = String(payload['ref'] ?? '');
      return { ok: true, data: { mission_id, status: 'pending' } };
    },

    getMission: async (missionId) => {
      if (opts.getMissionFails) {
        return {
          ok: false,
          status: opts.getMissionFailsStatus ?? 500,
          error: 'Everest getMission error',
        };
      }
      const detail = state.details.get(missionId) ?? {
        mission_id: missionId,
        status: 'completed',
        cout_ht: null,
        preuve_url: null,
        coursier_nom: null,
        coursier_telephone: null,
        vehicule_type: null,
      };
      return { ok: true, data: detail };
    },
  });

  return state;
}
