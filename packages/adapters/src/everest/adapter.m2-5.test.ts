// Tests adapter Everest — M2.5.
// Vérifie : dispatchCollecte, cancelCollecte, idempotence, erreurs typées.
// Aucun appel réseau réel (handlers injectés via setupEverestMock).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { composerInformationsSupplementaires } from '../infos-acces.js';
import { AdapterEverest } from './adapter.js';
import { _setEverestHandlers, setupEverestMock } from './mock.js';
import {
  PRESTA_EVEREST,
  builderTransporteurs,
} from '../mock-referentiel-transporteurs.js';

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
  prestataire_logistique_id: PRESTA_EVEREST,
};

// ─── Mock Supabase ────────────────────────────────────────────────────────────

interface SupabaseMockOpts {
  tourneeExistante?: {
    id: string;
    external_ref_commande: string | null;
    statut: string;
    // Explicite dans chaque fixture (jamais posé d'office par le mock) : c'est
    // la colonne sur laquelle findTournees cloisonne par provider.
    prestataire_logistique_id: string | null;
  } | null;
  missionExistante?: {
    id: string;
    statut_everest: string;
    /** Identifiant chez Everest — présent dès que le POST a abouti. */
    everest_mission_id?: string | null;
  } | null;
  brancheAttribution?: string | null;
  insertTourneeError?: boolean;
  /** L'INSERT du lien collecte_tournees est refusé (rang déjà pris — 23505). */
  insertLienError?: boolean;
  /** Le commit de `external_ref_commande` est refusé (référence déjà prise). */
  updateRefError?: boolean;
  /** La lecture de `everest_missions` échoue (blip PostgREST). */
  findMissionError?: boolean;
  /** L'écriture de `everest_missions` échoue (chemin de succès). */
  upsertMissionError?: boolean;
  /** L'UPDATE de `everest_missions` (annulation) est refusé avec ce code SQLSTATE. */
  updateMissionErrorCode?: string;
  /** L'INSERT de la trace `audit_log` (annulation) est refusé. */
  insertAuditError?: boolean;
  /** L'UPDATE de `collectes` portant ce champ est refusé. */
  updateCollecteError?: 'statut_tms' | 'tms_reference';
}

function makeMockSupabase(opts: SupabaseMockOpts = {}) {
  const {
    tourneeExistante = null,
    missionExistante = null,
    brancheAttribution = 'ag_velo_programme',
    insertTourneeError = false,
    insertLienError = false,
    updateRefError = false,
    findMissionError = false,
    upsertMissionError = false,
    updateMissionErrorCode,
    insertAuditError = false,
    updateCollecteError,
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
      // Le lien de rang est INSERT-et-await (pas de .select()) : son résultat
      // est lu directement, comme le fait l'adapter.
      if (table === 'audit_log') {
        return Promise.resolve(
          insertAuditError
            ? {
                data: null,
                error: { code: '08006', message: 'connexion interrompue' },
              }
            : { data: null, error: null },
        );
      }
      if (table === 'collecte_tournees') {
        return Promise.resolve(
          insertLienError
            ? {
                data: null,
                error: {
                  code: '23505',
                  message:
                    'duplicate key value violates unique constraint "uniq_collecte_tournee_rang"',
                },
              }
            : { data: null, error: null },
        );
      }
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
      const champs = data as Record<string, unknown>;
      const refusee =
        updateRefError &&
        table === 'tournees' &&
        champs['external_ref_commande'] !== undefined;
      let erreur: { code: string; message: string } | null = refusee
        ? {
            code: '23505',
            message:
              'duplicate key value violates unique constraint "uniq_tournee_par_external_ref"',
          }
        : null;
      if (table === 'everest_missions' && updateMissionErrorCode) {
        erreur = {
          code: updateMissionErrorCode,
          message:
            updateMissionErrorCode === '23514'
              ? 'new row for relation "everest_missions" violates check constraint "chk_everest_created_manually"'
              : 'connexion interrompue',
        };
      }
      if (
        table === 'collectes' &&
        updateCollecteError &&
        champs[updateCollecteError] !== undefined
      ) {
        erreur = { code: '08006', message: 'connexion interrompue' };
      }
      // `.update().eq()` est awaité : la chaîne doit être thenable.
      return {
        eq: vi.fn(() => Promise.resolve({ data: null, error: erreur })),
      };
    });
    q['upsert'] = vi.fn((data: unknown) => {
      if (!upsertedRows[table]) upsertedRows[table] = [];
      upsertedRows[table]!.push(data);
      const resultat =
        upsertMissionError && table === 'everest_missions'
          ? {
              data: null,
              error: { code: '08006', message: 'connexion interrompue' },
            }
          : { data: null, error: null };
      // Thenable : l'upsert est awaité TEL QUEL par l'adapter (sans `.eq`), son
      // résultat doit donc être destructurable.
      const chainable: Record<string, unknown> = {
        eq: vi.fn(() => chainable),
        then: (resolve: (v: unknown) => void) => resolve(resultat),
      };
      return chainable;
    });

    q['maybeSingle'] = vi.fn().mockResolvedValue(() => {
      // Résolution dynamique selon la table
    });

    // Résolution dynamique : maybeSingle renvoie selon la table et les filtres
    q['maybeSingle'] = vi.fn().mockImplementation(async () => {
      if (table === 'collecte_tournees') {
        if (tourneeExistante) {
          return {
            // FK sortante `collecte_tournees.tournee_id` → embed OBJET.
            data: { rang: 1, tournees: tourneeExistante },
            error: null,
          };
        }
        return { data: null, error: null };
      }
      if (table === 'everest_missions') {
        if (findMissionError) {
          return {
            data: null,
            error: { code: '08006', message: 'connexion interrompue' },
          };
        }
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
          ? [{ rang: 1, tournees: tourneeExistante }]
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
      // Le référentiel transporteurs répond le lot COMPLET, réellement filtré
      // par `.eq('type_tms', …)` : c'est lui qui rend le cloisonnement par
      // provider de findTournees testable au lieu d'être vrai par construction.
      if (table === 'transporteurs') return builderTransporteurs();
      if (!tables[table]) tables[table] = makeTableQuery(table);
      return tables[table];
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
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
        prestataire_logistique_id: PRESTA_EVEREST,
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

// ─── Écritures DB refusées (invariants du cloisonnement provider) ────────────
// Les deux écritures ci-dessous ignoraient leur `error`. Les index uniques posés
// par 20260915180000 les rendent faillibles pour de bon : un échec avalé
// laisserait une mission VIVANTE chez Everest sans référence en base (jamais
// annulable ni rapprochable), ou un lien de rang resté sur la tournée de l'autre
// provider — c'est-à-dire la fuite que ce lot ferme, par la porte de derrière.

describe('M2.5 / AdapterEverest — écritures DB refusées', () => {
  afterEach(() => _setEverestHandlers(null));

  it('lien de rang refusé (rang déjà pris par un autre provider) → Permanent, mission jamais créée', async () => {
    setupEverestMock();
    const supabase = makeMockSupabase({ insertLienError: true });
    const adapter = new AdapterEverest(TRANSPORTEUR_EVEREST, supabase);

    await expect(
      adapter.dispatchCollecte(COLLECTE_AG, 1),
    ).rejects.toBeInstanceOf(LogistiquePermanentError);

    // Le refus survient AVANT le POST : aucune mission n'est ouverte chez Everest.
    expect(supabase._upserted['everest_missions']).toBeUndefined();
  });

  it('commit de la référence refusé en 23505 → Permanent (une unicité ne se résout pas en rejouant)', async () => {
    setupEverestMock();
    const supabase = makeMockSupabase({ updateRefError: true });
    const adapter = new AdapterEverest(TRANSPORTEUR_EVEREST, supabase);

    await expect(
      adapter.dispatchCollecte(COLLECTE_AG, 1),
    ).rejects.toBeInstanceOf(LogistiquePermanentError);

    // La collecte n'est surtout pas annoncée « attribuée » : sans référence en
    // base, plus personne ne peut rapprocher ni annuler la mission.
    const statuts = (supabase._updated['collectes'] ?? []) as Array<
      Record<string, unknown>
    >;
    expect(
      statuts.some(
        (u) => u['statut_tms'] === 'attribuee_en_attente_acceptation',
      ),
    ).toBe(false);
  });

  it('la mission créée est enregistrée AVANT le commit de sa référence — jamais « creation_failed » sur une mission vivante', async () => {
    setupEverestMock();
    const supabase = makeMockSupabase({ updateRefError: true });

    await expect(
      new AdapterEverest(TRANSPORTEUR_EVEREST, supabase).dispatchCollecte(
        COLLECTE_AG,
        1,
      ),
    ).rejects.toBeInstanceOf(LogistiquePermanentError);

    const missions = (supabase._upserted['everest_missions'] ?? []) as Array<
      Record<string, unknown>
    >;
    // `creation_failed` signifie « rien chez Everest » et autorise un re-POST :
    // l'écrire sur une mission vivante ferait partir un second vélo au rejeu.
    expect(
      missions.some((m) => m['statut_everest'] === 'creation_failed'),
    ).toBe(false);
    const creee = missions.find((m) => m['statut_everest'] === 'created');
    expect(creee).toBeDefined();
    expect(creee!['everest_mission_id']).toBeTruthy();
  });

  it('écriture de everest_missions en échec → Transient, et le rejeu ne crée PAS de seconde mission', async () => {
    // Symétrique du test de lecture : c'est CETTE écriture dont l'échec
    // silencieux laissait `everest_missions` vide alors que la mission tourne
    // chez Everest — le rejeu, ne trouvant rien, en créait une seconde.
    const { missions } = setupEverestMock();
    const supabase = makeMockSupabase({ upsertMissionError: true });

    await expect(
      new AdapterEverest(TRANSPORTEUR_EVEREST, supabase).dispatchCollecte(
        COLLECTE_AG,
        1,
      ),
    ).rejects.toBeInstanceOf(LogistiqueTransientError);

    // La mission a bien été créée chez Everest (c'est son enregistrement qui a
    // échoué) : le rejeu doit la retrouver, pas en créer une autre.
    expect(missions.size).toBe(1);

    const supabaseRejeu = makeMockSupabase({
      tourneeExistante: {
        id: 'tournee-existing-001',
        external_ref_commande: null,
        statut: 'planifiee',
        prestataire_logistique_id: PRESTA_EVEREST,
      },
      missionExistante: {
        id: 'em-001',
        statut_everest: 'created',
        everest_mission_id: [...missions.values()][0]!.mission_id,
      },
    });

    await new AdapterEverest(
      TRANSPORTEUR_EVEREST,
      supabaseRejeu,
    ).dispatchCollecte(COLLECTE_AG, 1);

    expect(missions.size).toBe(1);
  });

  it('course VIDE déjà effectuée (completed_incomplete) : aucun second vélo — le premier est sorti et facturé', async () => {
    // Écrit en production par le webhook (`mission_failed` + course vide :
    // « Pas de commande » / « Client absent », CLAUDE.md §7), puis
    // `realisee_sans_collecte`. Le vélo EST sorti : c'est le jumeau de
    // `completed`, pas une mission morte.
    const { missions } = setupEverestMock();
    const supabase = makeMockSupabase({
      tourneeExistante: {
        id: 'tournee-existing-001',
        external_ref_commande: null,
        statut: 'planifiee',
        prestataire_logistique_id: PRESTA_EVEREST,
      },
      missionExistante: {
        id: 'em-vide',
        statut_everest: 'completed_incomplete',
        everest_mission_id: 'EVR-COURSE-VIDE',
      },
    });

    await new AdapterEverest(TRANSPORTEUR_EVEREST, supabase).dispatchCollecte(
      COLLECTE_AG,
      1,
    );

    expect(missions.size).toBe(0);
  });

  it('lecture de everest_missions en échec → Transient, jamais « aucune mission » (l’oracle ne se tait pas)', async () => {
    // Sans la lecture de cette `error`, un blip PostgREST valait « pas de
    // mission » : la garde n'était pas prise et un second vélo partait. Cette
    // lecture est jouée à CHAQUE dispatch.
    const { missions } = setupEverestMock();
    const supabase = makeMockSupabase({
      tourneeExistante: {
        id: 'tournee-existing-001',
        external_ref_commande: null,
        statut: 'planifiee',
        prestataire_logistique_id: PRESTA_EVEREST,
      },
      findMissionError: true,
    });

    await expect(
      new AdapterEverest(TRANSPORTEUR_EVEREST, supabase).dispatchCollecte(
        COLLECTE_AG,
        1,
      ),
    ).rejects.toBeInstanceOf(LogistiqueTransientError);

    expect(missions.size).toBe(0);
  });

  it('mission acceptée au TÉLÉPHONE (created_manually) : « Renvoyer au TMS » ne dépêche pas un second vélo', async () => {
    // Lignes posées AVANT l'arbitrage du 2026-09-16 (référence obligatoire) :
    // `created_manually` SANS `everest_mission_id` ni `external_ref_commande`.
    // Le gate d'émission exige une référence de commande : il répond `false`, et
    // un clic sur « Renvoyer au TMS » émet donc E1 — le filet doit tenir.
    const { missions } = setupEverestMock();
    const supabase = makeMockSupabase({
      tourneeExistante: {
        id: 'tournee-existing-001',
        external_ref_commande: null,
        statut: 'planifiee',
        prestataire_logistique_id: PRESTA_EVEREST,
      },
      missionExistante: {
        id: 'em-manuel',
        statut_everest: 'created_manually',
        everest_mission_id: null,
      },
    });

    const consumer = await new AdapterEverest(
      TRANSPORTEUR_EVEREST,
      supabase,
    ).dispatchCollecte(COLLECTE_AG, 1);

    expect(consumer).toBe('adapter_everest');
    expect(missions.size).toBe(0);
    // Rien à réparer ici : une mission acceptée au téléphone n'a pas d'id
    // Everest. Le no-op suffit — on ne doit simplement pas en créer une autre.
    const refs = (supabase._updated['tournees'] ?? []) as Array<
      Record<string, unknown>
    >;
    expect(refs.some((u) => u['external_ref_commande'] !== undefined)).toBe(
      false,
    );
  });

  it('rejeu après un commit de référence manqué : AUCUN second createMission, et la référence est réparée', async () => {
    const { missions } = setupEverestMock();
    // État laissé par le passage précédent : la mission existe chez Everest et
    // est tracée, mais `tournees.external_ref_commande` est restée NULL.
    const supabase = makeMockSupabase({
      tourneeExistante: {
        id: 'tournee-existing-001',
        external_ref_commande: null,
        statut: 'planifiee',
        prestataire_logistique_id: PRESTA_EVEREST,
      },
      missionExistante: {
        id: 'em-001',
        statut_everest: 'created',
        everest_mission_id: 'EVR-DEJA-CREEE',
      },
    });

    const consumer = await new AdapterEverest(
      TRANSPORTEUR_EVEREST,
      supabase,
    ).dispatchCollecte(COLLECTE_AG, 1);

    expect(consumer).toBe('adapter_everest');
    // LE point : aucun second vélo dépêché.
    expect(missions.size).toBe(0);
    // Et la référence manquante est reposée depuis everest_missions, sans quoi
    // `cancelCollecte` ne saurait plus quoi annuler.
    const refs = (supabase._updated['tournees'] ?? []) as Array<
      Record<string, unknown>
    >;
    expect(
      refs.some((u) => u['external_ref_commande'] === 'EVR-DEJA-CREEE'),
    ).toBe(true);
  });
});

describe('M2.5 / AdapterEverest — cancelCollecte', () => {
  afterEach(() => _setEverestHandlers(null));

  it('cancel nominal — cancelMission appelé avec le mission_id Everest', async () => {
    const { cancelledIds } = setupEverestMock();
    const supabase = makeMockSupabase({
      tourneeExistante: {
        id: 'tournee-001',
        external_ref_commande: 'EVR-MOCK-CANCEL-001',
        statut: 'planifiee',
        prestataire_logistique_id: PRESTA_EVEREST,
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
        prestataire_logistique_id: PRESTA_EVEREST,
      },
      missionExistante: { id: 'em-001', statut_everest: 'cancelled' },
    });
    const adapter = new AdapterEverest(TRANSPORTEUR_EVEREST, supabase);

    await adapter.cancelCollecte(COLLECTE_AG);

    expect(cancelledIds.size).toBe(0);
  });
});

// ─── Acceptation manuelle (Everest indisponible) — §06.06 §3 Bloc 0 ──────────
//
// Arbitrage Val 2026-09-16 : la référence de mission communiquée par A Toutes!
// est obligatoire et écrite comme au dispatch normal
// (`fn_accepter_mission_everest_manuelle`). Les fixtures ci-dessous reproduisent
// l'état EXACT que laisse cette RPC — vérifié par pgTAP
// (everest_acceptation_manuelle_reference.test.sql A2a/A2b) : tournée avec
// `external_ref_commande`, mission `created_manually` avec `everest_mission_id`.

describe('M2.5 / AdapterEverest — mission acceptée manuellement AVEC référence', () => {
  afterEach(() => _setEverestHandlers(null));

  const ETAT_APRES_ACCEPTATION = {
    tourneeExistante: {
      id: 'tournee-manuelle-001',
      external_ref_commande: 'EVR-TEL-001',
      statut: 'planifiee',
      prestataire_logistique_id: PRESTA_EVEREST,
    },
    missionExistante: {
      id: 'em-manuelle-001',
      statut_everest: 'created_manually',
      everest_mission_id: 'EVR-TEL-001',
    },
  };

  it('annulation : cancelCollecte RETROUVE la mission et l’annule chez A Toutes! avec la référence saisie', async () => {
    const { cancelledIds } = setupEverestMock();
    const supabase = makeMockSupabase(ETAT_APRES_ACCEPTATION);

    const consumer = await new AdapterEverest(
      TRANSPORTEUR_EVEREST,
      supabase,
    ).cancelCollecte(COLLECTE_AG);

    expect(consumer).toBe('adapter_everest');
    expect([...cancelledIds]).toEqual(['EVR-TEL-001']);
  });

  it('contre-épreuve — acceptation SANS référence (état d’avant l’arbitrage) : l’annulation ne part nulle part', async () => {
    // C'est le défaut que le champ obligatoire ferme : un vélo réservé au
    // téléphone et un Annuler qui sort en no-op — le vélo se présente.
    const { cancelledIds } = setupEverestMock();
    const supabase = makeMockSupabase({
      tourneeExistante: {
        ...ETAT_APRES_ACCEPTATION.tourneeExistante,
        external_ref_commande: null,
      },
      missionExistante: {
        ...ETAT_APRES_ACCEPTATION.missionExistante,
        everest_mission_id: null,
      },
    });

    const consumer = await new AdapterEverest(
      TRANSPORTEUR_EVEREST,
      supabase,
    ).cancelCollecte(COLLECTE_AG);

    expect(consumer).toBe('noop_no_remote');
    expect(cancelledIds.size).toBe(0);
  });

  it('E1 reçu malgré tout (event en retry) : no-op idempotent — aucun second vélo, référence intacte', async () => {
    const { missions } = setupEverestMock();
    const supabase = makeMockSupabase(ETAT_APRES_ACCEPTATION);

    const consumer = await new AdapterEverest(
      TRANSPORTEUR_EVEREST,
      supabase,
    ).dispatchCollecte(COLLECTE_AG, 1);

    expect(consumer).toBe('adapter_everest');
    expect(missions.size).toBe(0);
    expect(supabase._updated['tournees'] ?? []).toEqual([]);
    expect(supabase._updated['collectes'] ?? []).toEqual([]);
  });
});

// ─── Tests sync + updateLieu ──────────────────────────────────────────────────

// ─── Écritures locales refusées APRÈS un échange avec A Toutes! ──────────────
//
// Scénario 06.06 `mission_created_manually_reprend_le_cycle_de_vie` : « une erreur
// de l'UPDATE everest_missions dans cancelCollecte n'est PLUS avalée : elle
// remonte et alerte ». Alerte = Ops in-app (`f_upsert_alerte_admin`), jamais
// Slack (CLAUDE.md §13). Les fixtures reprennent l'état que laisse
// `fn_accepter_mission_everest_manuelle` : c'est là que le 23514 a été vécu.

function alertesOps(
  supabase: ReturnType<typeof makeMockSupabase>,
): Array<Record<string, unknown>> {
  const rpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;
  return rpc.mock.calls
    .filter(([fn]) => fn === 'f_upsert_alerte_admin')
    .map(([, args]) => args as Record<string, unknown>);
}

describe('M2.5 / AdapterEverest — écritures locales refusées après A Toutes!', () => {
  const MISSION_MANUELLE = {
    tourneeExistante: {
      id: 'tournee-manuelle-002',
      external_ref_commande: 'EVR-TEL-002',
      statut: 'planifiee',
      prestataire_logistique_id: PRESTA_EVEREST,
    },
    missionExistante: {
      id: 'em-manuelle-002',
      statut_everest: 'created_manually',
      everest_mission_id: 'EVR-TEL-002',
    },
  };

  const slack: SlackPayload[] = [];
  beforeEach(() => {
    slack.length = 0;
    setSlackSink(async (p) => {
      slack.push(p);
    });
  });
  afterEach(() => {
    _setEverestHandlers(null);
    setSlackSink(async () => {});
  });

  it('annulation : UPDATE everest_missions refusé en 23514 → lève Permanent + alerte Ops in-app, jamais Slack', async () => {
    const { cancelledIds } = setupEverestMock();
    const supabase = makeMockSupabase({
      ...MISSION_MANUELLE,
      updateMissionErrorCode: '23514',
    });

    const annulation = new AdapterEverest(
      TRANSPORTEUR_EVEREST,
      supabase,
    ).cancelCollecte(COLLECTE_AG);
    await expect(annulation).rejects.toBeInstanceOf(LogistiquePermanentError);
    await expect(annulation).rejects.toThrow(/chk_everest_created_manually/);

    // L'annulation est bien partie chez A Toutes! : c'est son enregistrement
    // local qui a échoué — exactement l'état qui passait inaperçu.
    expect([...cancelledIds]).toEqual(['EVR-TEL-002']);
    const alertes = alertesOps(supabase);
    expect(alertes[0]).toMatchObject({
      p_code: 'everest_annulation_non_enregistree',
      p_entity_type: 'collectes',
      p_entity_id: COLLECTE_AG.id,
    });
    expect(String(alertes[0]!['p_message'])).toContain('EVR-TEL-002');
    expect(slack).toEqual([]);
  });

  it('annulation : UPDATE everest_missions en échec réseau → lève Transient (le worker rejoue) + alerte', async () => {
    setupEverestMock();
    const supabase = makeMockSupabase({
      ...MISSION_MANUELLE,
      updateMissionErrorCode: '08006',
    });

    await expect(
      new AdapterEverest(TRANSPORTEUR_EVEREST, supabase).cancelCollecte(
        COLLECTE_AG,
      ),
    ).rejects.toBeInstanceOf(LogistiqueTransientError);
    expect(alertesOps(supabase).map((a) => a['p_code'])).toEqual([
      'everest_annulation_non_enregistree',
    ]);
  });

  it('annulation : trace audit_log refusée → lève + alerte (sinon le webhook lit une annulation externe)', async () => {
    setupEverestMock();
    const supabase = makeMockSupabase({
      ...MISSION_MANUELLE,
      insertAuditError: true,
    });

    await expect(
      new AdapterEverest(TRANSPORTEUR_EVEREST, supabase).cancelCollecte(
        COLLECTE_AG,
      ),
    ).rejects.toBeInstanceOf(LogistiqueTransientError);
    // Le statut local, lui, a bien été écrit avant la trace.
    expect(supabase._updated['everest_missions']).toEqual([
      expect.objectContaining({ statut_everest: 'cancelled' }),
    ]);
    expect(alertesOps(supabase).map((a) => a['p_code'])).toEqual([
      'everest_trace_annulation_non_enregistree',
    ]);
  });

  it('contre-épreuve : annulation nominale → aucune alerte Ops', async () => {
    setupEverestMock();
    const supabase = makeMockSupabase(MISSION_MANUELLE);

    await expect(
      new AdapterEverest(TRANSPORTEUR_EVEREST, supabase).cancelCollecte(
        COLLECTE_AG,
      ),
    ).resolves.toBe('adapter_everest');
    expect(supabase._updated['everest_missions']).toEqual([
      expect.objectContaining({ statut_everest: 'cancelled' }),
    ]);
    expect(alertesOps(supabase)).toEqual([]);
  });

  it('dispatch : statut_tms non écrit après création de la mission → lève + alerte', async () => {
    const { missions } = setupEverestMock();
    const supabase = makeMockSupabase({ updateCollecteError: 'statut_tms' });

    await expect(
      new AdapterEverest(TRANSPORTEUR_EVEREST, supabase).dispatchCollecte(
        COLLECTE_AG,
        1,
      ),
    ).rejects.toBeInstanceOf(LogistiqueTransientError);
    expect(missions.size).toBe(1);
    expect(alertesOps(supabase)).toEqual([
      expect.objectContaining({
        p_code: 'everest_dispatch_non_enregistre',
        p_entity_id: COLLECTE_AG.id,
      }),
    ]);
  });

  it('dispatch : tms_reference non écrite sur la collecte → lève + alerte', async () => {
    setupEverestMock();
    const supabase = makeMockSupabase({ updateCollecteError: 'tms_reference' });

    await expect(
      new AdapterEverest(TRANSPORTEUR_EVEREST, supabase).dispatchCollecte(
        COLLECTE_AG,
        1,
      ),
    ).rejects.toBeInstanceOf(LogistiqueTransientError);
    expect(alertesOps(supabase).map((a) => a['p_code'])).toContain(
      'everest_dispatch_non_enregistre',
    );
  });

  it('dispatch refusé par A Toutes! + statut rejetee non écrit → le refus du transporteur reste l’erreur levée', async () => {
    setupEverestMock({ createFails: true, createFailsStatus: 422 });
    const supabase = makeMockSupabase({ updateCollecteError: 'statut_tms' });

    await expect(
      new AdapterEverest(TRANSPORTEUR_EVEREST, supabase).dispatchCollecte(
        COLLECTE_AG,
        1,
      ),
    ).rejects.toThrow(/Everest createMission 422/);
    expect(alertesOps(supabase).map((a) => a['p_code'])).toEqual([
      'everest_dispatch_non_enregistre',
    ]);
  });
});

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

// ─── Infos d'accès du lieu → `notes` Everest (Val 2026-09-15) ─────────────────
//
// Les 6 informations d'accès éditables par collecte n'ont pas de champ natif
// Everest : elles sont agrégées en amont dans `informations_supplementaires`
// (composerInformationsSupplementaires, appelé par fetchCollecte pour les DEUX
// adapters). Ce test ferme le dernier maillon côté Everest : ce qui est agrégé
// atteint bien le fil, dans `notes`.
describe('M1.5 / infos d’accès du lieu → notes Everest', () => {
  afterEach(() => _setEverestHandlers(null));

  const LIEU_ACCES: Lieu = {
    ...LIEU_FIXTURE,
    acces_details: 'Quai n°2, sonner interphone B',
    stationnement: 'difficile',
    contraintes_horaires: 'Livraison avant 9h uniquement',
    acces_office: 'tres_difficile',
    type_vehicule_max: 'camionnette',
    flux_autorises: ['biodéchets', 'carton'],
  };

  it.each([
    ['acces_details', 'Accès : Quai n°2, sonner interphone B'],
    ['stationnement', 'Stationnement : difficile'],
    [
      'contraintes_horaires',
      'Contraintes horaires : Livraison avant 9h uniquement',
    ],
    ['acces_office', 'Accès office : très difficile'],
    ['type_vehicule_max', 'Véhicule max : camionnette'],
    ['flux_autorises', 'Flux acceptés : biodéchets, carton'],
  ])(
    '%s est présent dans notes du payload createMission',
    async (_c, ligne) => {
      const { payloads } = setupEverestMock();
      const supabase = makeMockSupabase({
        brancheAttribution: 'ag_velo_programme',
      });

      await new AdapterEverest(TRANSPORTEUR_EVEREST, supabase).dispatchCollecte(
        {
          ...COLLECTE_AG,
          lieu: LIEU_ACCES,
          informations_supplementaires: composerInformationsSupplementaires(
            LIEU_ACCES,
            'Demander Karim à la plonge',
            null,
          ),
        },
        1,
      );

      const payload = payloads.get('tournee-everest-new-001') as {
        notes?: string;
      };
      expect(payload?.notes).toContain(ligne);
      // La saisie du traiteur part avec, jamais remplacée.
      expect(payload?.notes).toContain('Demander Karim à la plonge');
    },
  );
});
