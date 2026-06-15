// Mock Everest — injection en CI (jamais l'API réelle).
// Pattern identique à mts1/mock.ts.

// ─── Types as-built Everest ───────────────────────────────────────────────────

export interface EverestCreatedMission {
  mission_id: string;
  client_ref: string;
  service_id: number;
  status: string;
  created_at: string;
}

export interface EverestCancelResponse {
  mission_id: string;
  status: string;
  cancelled_at: string;
}

export interface EverestAuthResponse {
  access_token: string;
}

export type EverestPostSuccess<T> = { ok: true; data: T };
export type EverestPostError = { ok: false; status: number; error: string };
export type EverestResult<T> = EverestPostSuccess<T> | EverestPostError;

// ─── Handlers injectables ─────────────────────────────────────────────────────

export interface EverestHandlers {
  auth: (
    payload: Record<string, unknown>,
  ) => Promise<EverestResult<EverestAuthResponse>>;
  createMission: (
    payload: Record<string, unknown>,
  ) => Promise<EverestResult<EverestCreatedMission>>;
  cancelMission: (
    payload: Record<string, unknown>,
  ) => Promise<EverestResult<EverestCancelResponse>>;
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
}

export function setupEverestMock(
  opts: {
    authFails?: boolean;
    createFails?: boolean;
    createFailsStatus?: number;
    cancelFails?: boolean;
  } = {},
): MockMissionState {
  const state: MockMissionState = {
    missions: new Map(),
    payloads: new Map(),
    cancelledIds: new Set(),
  };

  let missionCounter = 0;

  _setEverestHandlers({
    auth: async (_payload) => {
      if (opts.authFails) {
        return { ok: false, status: 401, error: 'Unauthorized' };
      }
      return { ok: true, data: { access_token: 'mock-bearer-token' } };
    },

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
        created_at: new Date().toISOString(),
      };
      state.missions.set(client_ref, mission);
      state.payloads.set(client_ref, payload);
      return { ok: true, data: mission };
    },

    cancelMission: async (payload) => {
      if (opts.cancelFails) {
        return { ok: false, status: 500, error: 'Cancel error' };
      }
      const mission_id = String(payload['mission_id'] ?? '');
      state.cancelledIds.add(mission_id);
      return {
        ok: true,
        data: {
          mission_id,
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
        },
      };
    },
  });

  return state;
}
