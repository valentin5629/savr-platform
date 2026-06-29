// Tests adapter Everest — M2.5.
// Vérifie : dispatchCollecte, cancelCollecte, idempotence, erreurs typées.
// Aucun appel réseau réel (handlers injectés via setupEverestMock).

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  setSlackSink,
  type SlackPayload,
} from '@savr/shared/src/alerting/slack.js';

import {
  LogistiquePermanentError,
  LogistiqueTransientError,
  getLogistiqueProvider,
} from '../index.js';
import type { Collecte, Lieu, Transporteur } from '../index.js';
import { AdapterEverest } from './adapter.js';
import { _setEverestHandlers, setupEverestMock } from './mock.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const LIEU_FIXTURE: Lieu = {
  id: 'lieu-001',
  nom: 'Salle Gaveau',
  adresse_acces: '45 rue La Boétie',
  code_postal: '75008',
  ville: 'Paris',
  latitude: 48.876,
  longitude: 2.313,
  acces_details: null,
  type_vehicule_max: 'velo_cargo',
  contraintes_horaires: null,
};

const COLLECTE_AG: Collecte = {
  id: 'col-ag-everest-001',
  type: 'anti_gaspi',
  date_collecte: '2026-07-20',
  heure_collecte: '22:00:00',
  nb_camions_demande: 1,
  statut_tms: 'non_envoye',
  controle_acces_requis: false,
  informations_supplementaires: null,
  notes_internes: null,
  contact_principal_nom: 'Claire Dupont',
  contact_principal_telephone: '+33612345678',
  contact_secours_nom: null,
  contact_secours_telephone: null,
  lieu: LIEU_FIXTURE,
};

const TRANSPORTEUR_EVEREST: Transporteur = {
  id: 'presta-everest-001',
  type_tms: 'a_toutes',
  code_transporteur_mts1: null,
  prestataire_logistique_id: 'shared-presta-uuid-001',
};

// ─── Mock Supabase ────────────────────────────────────────────────────────────

interface SupabaseMockOpts {
  tourneeExistante?: {
    id: string;
    external_ref_commande: string | null;
    statut: string;
  } | null;
  missionExistante?: { id: string; statut_everest: string } | null;
  brancheAttribution?: string | null;
  insertTourneeError?: boolean;
}

function makeMockSupabase(opts: SupabaseMockOpts = {}) {
  const {
    tourneeExistante = null,
    missionExistante = null,
    brancheAttribution = 'ag_velo_programme',
    insertTourneeError = false,
  } = opts;

  const insertedRows: Record<string, unknown[]> = {};
  const updatedRows: Record<string, unknown[]> = {};
  const upsertedRows: Record<string, unknown[]> = {};

  // Chaque from() retourne un proxy qui adapte maybeSingle/single par table
  const makeTableQuery = (table: string) => {
    const q: Record<string, unknown> = {};
    let _eqFilters: Record<string, unknown> = {};

    q['select'] = vi.fn((_fields?: string) => {
      return q;
    });
    q['eq'] = vi.fn((_col: string, _val: unknown) => {
      _eqFilters = { ..._eqFilters, [_col]: _val };
      return q;
    });
    q['contains'] = vi.fn(() => q);
    q['limit'] = vi.fn(() => q);
    q['insert'] = vi.fn((data: unknown) => {
      if (!insertedRows[table]) insertedRows[table] = [];
      insertedRows[table]!.push(data);
      return {
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue(
          insertTourneeError && table === 'tournees'
            ? { data: null, error: { message: 'db error' } }
            : {
                data: {
                  id: 'tournee-everest-new-001',
                  external_ref_commande: null,
                  statut: 'planifiee',
                },
                error: null,
              },
        ),
      };
    });
    q['update'] = vi.fn((data: unknown) => {
      if (!updatedRows[table]) updatedRows[table] = [];
      updatedRows[table]!.push(data);
      return { eq: vi.fn().mockReturnThis() };
    });
    q['upsert'] = vi.fn((data: unknown) => {
      if (!upsertedRows[table]) upsertedRows[table] = [];
      upsertedRows[table]!.push(data);
      return { eq: vi.fn().mockReturnThis() };
    });

    q['maybeSingle'] = vi.fn().mockResolvedValue(() => {
      // Résolution dynamique selon la table
    });

    // Résolution dynamique : maybeSingle renvoie selon la table et les filtres
    q['maybeSingle'] = vi.fn().mockImplementation(async () => {
      if (table === 'collecte_tournees') {
        if (tourneeExistante) {
          return {
            data: { rang: 1, tournees: [tourneeExistante] },
            error: null,
          };
        }
        return { data: null, error: null };
      }
      if (table === 'everest_missions') {
        if (missionExistante) {
          return { data: missionExistante, error: null };
        }
        return { data: null, error: null };
      }
      if (table === 'attributions_antgaspi') {
        if (brancheAttribution) {
          return {
            data: { branche_attribution: brancheAttribution },
            error: null,
          };
        }
        return { data: null, error: null };
      }
      if (table === 'tournees') {
        // Lookup par reference_interne → null (pas de tournee existante)
        return { data: null, error: null };
      }
      if (table === 'collectes') {
        return {
          data: { statut_tms: 'attribuee_en_attente_acceptation' },
          error: null,
        };
      }
      if (table === 'audit_log') {
        return { data: null, error: null };
      }
      return { data: null, error: null };
    });

    q['single'] = vi.fn().mockResolvedValue({
      data: {
        id: 'tournee-everest-new-001',
        external_ref_commande: null,
        statut: 'planifiee',
      },
      error: null,
    });

    // Rendre la query thenable pour les appels sans .maybeSingle() (ex : findTournees)
    // Supabase query builder est PromiseLike — le mock doit l'être aussi.
    (
      q as Record<string, unknown> & {
        then: (onfulfilled: (v: unknown) => unknown) => Promise<unknown>;
      }
    )['then'] = (
      onfulfilled: (v: { data: unknown; error: null }) => unknown,
    ) => {
      let data: unknown;
      if (table === 'collecte_tournees') {
        data = tourneeExistante
          ? [{ rang: 1, tournees: [tourneeExistante] }]
          : [];
      } else {
        data = null;
      }
      return Promise.resolve({ data, error: null }).then(onfulfilled);
    };

    return q;
  };

  const tables: Record<string, ReturnType<typeof makeTableQuery>> = {};

  const supabase = {
    from: vi.fn((table: string) => {
      if (!tables[table]) tables[table] = makeTableQuery(table);
      return tables[table];
    }),
    _inserted: insertedRows,
    _updated: updatedRows,
    _upserted: upsertedRows,
    _tables: tables,
  };

  return supabase as unknown as import('@supabase/supabase-js').SupabaseClient & {
    _inserted: Record<string, unknown[]>;
    _updated: Record<string, unknown[]>;
    _upserted: Record<string, unknown[]>;
    _tables: Record<string, unknown>;
  };
}

// ─── Tests factory ────────────────────────────────────────────────────────────

describe('M2.5 / factory — gate Everest levée 2026-06-15', () => {
  it('getLogistiqueProvider retourne AdapterEverest pour type_tms=a_toutes', () => {
    setupEverestMock();
    const supabase = makeMockSupabase();
    const provider = getLogistiqueProvider(TRANSPORTEUR_EVEREST, supabase);
    expect(provider).toBeInstanceOf(AdapterEverest);
    _setEverestHandlers(null);
  });
});

// ─── Tests dispatchCollecte ───────────────────────────────────────────────────

describe('M2.5 / AdapterEverest — dispatchCollecte', () => {
  afterEach(() => _setEverestHandlers(null));

  it('dispatch nominal — createMission appelé avec service_id=71 (ag_velo_programme)', async () => {
    const { missions } = setupEverestMock();
    const supabase = makeMockSupabase({
      brancheAttribution: 'ag_velo_programme',
    });
    const adapter = new AdapterEverest(TRANSPORTEUR_EVEREST, supabase);

    await adapter.dispatchCollecte(COLLECTE_AG, 1);

    expect(missions.size).toBe(1);
    const mission = [...missions.values()][0]!;
    expect(mission.service_id).toBe(71);
    // client_ref = tournee.id (M14 W1 R_M14.2), pas collecte.id
    expect(mission.client_ref).toBe('tournee-everest-new-001');
  });

  it('dispatch vélo express — createMission appelé avec service_id=74 (ag_velo_express)', async () => {
    const { missions } = setupEverestMock();
    const supabase = makeMockSupabase({
      brancheAttribution: 'ag_velo_express',
    });
    const adapter = new AdapterEverest(TRANSPORTEUR_EVEREST, supabase);

    await adapter.dispatchCollecte(COLLECTE_AG, 1);

    const mission = [...missions.values()][0]!;
    expect(mission.service_id).toBe(74);
  });

  it('dispatch backup camion — createMission appelé avec service_id=91', async () => {
    const { missions } = setupEverestMock();
    const supabase = makeMockSupabase({
      brancheAttribution: 'ag_marathon_volume_backup_camion',
    });
    const adapter = new AdapterEverest(TRANSPORTEUR_EVEREST, supabase);

    await adapter.dispatchCollecte(COLLECTE_AG, 1);

    const mission = [...missions.values()][0]!;
    expect(mission.service_id).toBe(91);
  });

  // BL-P1-API-04 (a) — camion express last-minute. L'algo M2.3 produit déjà la
  // branche `ag_everest_camion_express` ; sans ce mapping le dispatch échouait.
  it('dispatch camion express — createMission appelé avec service_id=77 (ag_everest_camion_express)', async () => {
    const { missions, payloads } = setupEverestMock();
    const supabase = makeMockSupabase({
      brancheAttribution: 'ag_everest_camion_express',
    });
    const adapter = new AdapterEverest(TRANSPORTEUR_EVEREST, supabase);

    await adapter.dispatchCollecte(COLLECTE_AG, 1);

    const mission = [...missions.values()][0]!;
    expect(mission.service_id).toBe(77);
    // service 77 = créneau 1h (SERVICE_SLOT_MINUTES[77]=60)
    const payload = payloads.get('tournee-everest-new-001') as {
      timeslot?: { start: string; end: string };
    };
    expect(payload?.timeslot?.start).toBe('22:00');
    expect(payload?.timeslot?.end).toBe('23:00');
  });

  it('dispatch timeslot — start=22:00, end=22:30 (30 min service 71)', async () => {
    const { payloads } = setupEverestMock();
    const supabase = makeMockSupabase({
      brancheAttribution: 'ag_velo_programme',
    });
    const adapter = new AdapterEverest(TRANSPORTEUR_EVEREST, supabase);

    await adapter.dispatchCollecte(COLLECTE_AG, 1);

    // Le payload brut envoyé à createMission contient le timeslot
    // client_ref = tournee.id → la clé du Map est 'tournee-everest-new-001'
    const payload = payloads.get('tournee-everest-new-001') as {
      timeslot?: { start: string; end: string };
    };
    expect(payload?.timeslot?.start).toBe('22:00');
    expect(payload?.timeslot?.end).toBe('22:30');
  });

  it('idempotence — mission active existante → no createMission (no-op)', async () => {
    const { missions } = setupEverestMock();
    const supabase = makeMockSupabase({
      tourneeExistante: {
        id: 'tournee-existing-001',
        external_ref_commande: 'EVR-MOCK-EXISTING',
        statut: 'planifiee',
      },
      missionExistante: { id: 'em-001', statut_everest: 'created' },
    });
    const adapter = new AdapterEverest(TRANSPORTEUR_EVEREST, supabase);

    await adapter.dispatchCollecte(COLLECTE_AG, 1);

    expect(missions.size).toBe(0);
  });

  it('pas d attribution → LogistiquePermanentError', async () => {
    setupEverestMock();
    const supabase = makeMockSupabase({ brancheAttribution: null });
    const adapter = new AdapterEverest(TRANSPORTEUR_EVEREST, supabase);

    await expect(adapter.dispatchCollecte(COLLECTE_AG, 1)).rejects.toThrow(
      LogistiquePermanentError,
    );
  });

  it('branche inconnue → LogistiquePermanentError', async () => {
    setupEverestMock();
    const supabase = makeMockSupabase({
      brancheAttribution: 'branche_inexistante',
    });
    const adapter = new AdapterEverest(TRANSPORTEUR_EVEREST, supabase);

    await expect(adapter.dispatchCollecte(COLLECTE_AG, 1)).rejects.toThrow(
      LogistiquePermanentError,
    );
  });

  it('Everest 5xx → LogistiqueTransientError (retry via outbox)', async () => {
    setupEverestMock({ createFails: true, createFailsStatus: 500 });
    const supabase = makeMockSupabase({
      brancheAttribution: 'ag_velo_programme',
    });
    const adapter = new AdapterEverest(TRANSPORTEUR_EVEREST, supabase);

    await expect(adapter.dispatchCollecte(COLLECTE_AG, 1)).rejects.toThrow(
      LogistiqueTransientError,
    );
  });

  it('Everest 422 → LogistiquePermanentError (pas de retry)', async () => {
    setupEverestMock({ createFails: true, createFailsStatus: 422 });
    const supabase = makeMockSupabase({
      brancheAttribution: 'ag_velo_programme',
    });
    const adapter = new AdapterEverest(TRANSPORTEUR_EVEREST, supabase);

    await expect(adapter.dispatchCollecte(COLLECTE_AG, 1)).rejects.toThrow(
      LogistiquePermanentError,
    );
  });

  it('Everest 422 (rejet permanent) → statut_tms = rejetee_par_prestataire (BL-P1-ALGO-07)', async () => {
    setupEverestMock({ createFails: true, createFailsStatus: 422 });
    const supabase = makeMockSupabase({
      brancheAttribution: 'ag_velo_programme',
    });
    const adapter = new AdapterEverest(TRANSPORTEUR_EVEREST, supabase);

    await expect(adapter.dispatchCollecte(COLLECTE_AG, 1)).rejects.toThrow(
      LogistiquePermanentError,
    );

    const collecteUpdates = supabase._updated['collectes'] ?? [];
    expect(
      collecteUpdates.some(
        (u) =>
          (u as { statut_tms?: string }).statut_tms ===
          'rejetee_par_prestataire',
      ),
    ).toBe(true);
  });

  it('Everest 5xx (transient) → PAS de rejet statut_tms (le worker retente)', async () => {
    setupEverestMock({ createFails: true, createFailsStatus: 500 });
    const supabase = makeMockSupabase({
      brancheAttribution: 'ag_velo_programme',
    });
    const adapter = new AdapterEverest(TRANSPORTEUR_EVEREST, supabase);

    await expect(adapter.dispatchCollecte(COLLECTE_AG, 1)).rejects.toThrow(
      LogistiqueTransientError,
    );

    const collecteUpdates = supabase._updated['collectes'] ?? [];
    expect(
      collecteUpdates.some(
        (u) =>
          (u as { statut_tms?: string }).statut_tms ===
          'rejetee_par_prestataire',
      ),
    ).toBe(false);
  });
});

// ─── Tests cancelCollecte ─────────────────────────────────────────────────────

describe('M2.5 / AdapterEverest — cancelCollecte', () => {
  afterEach(() => _setEverestHandlers(null));

  it('cancel nominal — cancelMission appelé avec le mission_id Everest', async () => {
    const { cancelledIds } = setupEverestMock();
    const supabase = makeMockSupabase({
      tourneeExistante: {
        id: 'tournee-001',
        external_ref_commande: 'EVR-MOCK-CANCEL-001',
        statut: 'planifiee',
      },
      missionExistante: { id: 'em-001', statut_everest: 'created' },
    });
    const adapter = new AdapterEverest(TRANSPORTEUR_EVEREST, supabase);

    await adapter.cancelCollecte(COLLECTE_AG);

    expect(cancelledIds.has('EVR-MOCK-CANCEL-001')).toBe(true);
  });

  it('cancel — pas de tournée avec external_ref → no-op succès', async () => {
    const { cancelledIds } = setupEverestMock();
    const supabase = makeMockSupabase({ tourneeExistante: null });
    const adapter = new AdapterEverest(TRANSPORTEUR_EVEREST, supabase);

    await adapter.cancelCollecte(COLLECTE_AG);

    expect(cancelledIds.size).toBe(0);
  });

  it('cancel — mission déjà annulée → no-op (idempotence)', async () => {
    const { cancelledIds } = setupEverestMock();
    const supabase = makeMockSupabase({
      tourneeExistante: {
        id: 'tournee-001',
        external_ref_commande: 'EVR-MOCK-ALREADY',
        statut: 'planifiee',
      },
      missionExistante: { id: 'em-001', statut_everest: 'cancelled' },
    });
    const adapter = new AdapterEverest(TRANSPORTEUR_EVEREST, supabase);

    await adapter.cancelCollecte(COLLECTE_AG);

    expect(cancelledIds.size).toBe(0);
  });
});

// ─── Tests sync + updateLieu ──────────────────────────────────────────────────

describe('M2.5 / AdapterEverest — sync + updateLieu', () => {
  afterEach(() => _setEverestHandlers(null));

  it('sync() est un no-op (Everest push-only)', async () => {
    setupEverestMock();
    const supabase = makeMockSupabase();
    const adapter = new AdapterEverest(TRANSPORTEUR_EVEREST, supabase);

    await expect(
      adapter.sync({ depuis: new Date(), jusqu_a: new Date() }),
    ).resolves.toBeUndefined();
  });

  it('updateLieu() est un no-op', async () => {
    setupEverestMock();
    const supabase = makeMockSupabase();
    const adapter = new AdapterEverest(TRANSPORTEUR_EVEREST, supabase);

    await expect(adapter.updateLieu(LIEU_FIXTURE)).resolves.toBeUndefined();
  });

  it('updateCollecte() = no-op tracé : consumer "noop_no_remote" + alerte Ops info (BL-P2-34)', async () => {
    setupEverestMock();
    const supabase = makeMockSupabase();
    const adapter = new AdapterEverest(TRANSPORTEUR_EVEREST, supabase);

    const alerts: SlackPayload[] = [];
    setSlackSink(async (p) => {
      alerts.push(p);
    });

    // Renvoie noop_no_remote (pas de propagation MTS-1/Everest) ...
    await expect(adapter.updateCollecte(COLLECTE_AG)).resolves.toBe(
      'noop_no_remote',
    );
    // ... ET émet une alerte Ops canal info (plus de console.warn perdu).
    const info = alerts.filter((a) => a.canal === 'info');
    expect(info.length).toBe(1);

    setSlackSink(async () => {});
  });
});

// ─── Anti-couplage G3 ─────────────────────────────────────────────────────────

describe('M2.5 / Garde-fou G3 — anti-couplage', () => {
  it('AdapterEverest est importable depuis packages/adapters uniquement', () => {
    // Ce test vérifie statiquement que l'import fonctionne depuis adapters/src/everest.
    // Le check grep réel est fait par scripts/check-coupling.sh en CI.
    expect(AdapterEverest).toBeDefined();
  });
});
