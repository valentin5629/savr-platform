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
}

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
