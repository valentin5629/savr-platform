/**
 * M0.4 / BL-P1-ONB-02 — revalidation SIRET asynchrone (CDC §15 §2.6 l.73).
 * Vérifie : enqueue (1er palier 15 min) ; verdict 'verifie'/'echec' → file 'resolu' +
 * entité mise à jour ; 'down' → palier suivant ; 3 paliers down → 'epuise' + alerte Admin.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Row = Record<string, unknown>;

const cfg: {
  fileRows: Row[];
  entite: Row | null;
  user: Row | null;
} = { fileRows: [], entite: null, user: null };

const captures: {
  updates: Record<string, Row[]>;
  inserts: Record<string, Row[]>;
  rpc: Array<{ fn: string; args: Row }>;
} = { updates: {}, inserts: {}, rpc: [] };

function record(bucket: Record<string, Row[]>, table: string, data: Row): void {
  (bucket[table] ??= []).push(data);
}

// Builder unique : chaîne de lecture (select…eq…lte / …maybeSingle / …order…limit…maybeSingle)
// ET d'écriture (update…eq, insert). Thenable pour les await directs.
function builder(
  table: string,
  kind: 'read' | 'write',
): Record<string, unknown> {
  const b: Record<string, unknown> = {};
  const self = () => b;
  b['select'] = vi.fn(self);
  b['eq'] = vi.fn(self);
  b['lte'] = vi.fn(self);
  b['order'] = vi.fn(self);
  b['limit'] = vi.fn(self);
  b['maybeSingle'] = vi.fn(async () => {
    if (table === 'entites_facturation')
      return { data: cfg.entite, error: null };
    if (table === 'users') return { data: cfg.user, error: null };
    return { data: null, error: null };
  });
  b['then'] = (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => {
    const res =
      kind === 'read' && table === 'file_revalidation_siret'
        ? { data: cfg.fileRows, error: null }
        : { data: null, error: null };
    return Promise.resolve(res).then(onF, onR);
  };
  return b;
}

const mockSupabase = {
  from: (table: string) => ({
    select: () => builder(table, 'read'),
    update: (data: Row) => {
      record(captures.updates, table, data);
      return builder(table, 'write');
    },
    insert: (data: Row) => {
      record(captures.inserts, table, data);
      return builder(table, 'write');
    },
  }),
  rpc: vi.fn(async (fn: string, args: Row) => {
    captures.rpc.push({ fn, args });
    return { data: null, error: null };
  }),
};

const mockVerifySiret = vi.fn();
vi.mock('../api/siret.js', () => ({
  verifySiret: (s: string) => mockVerifySiret(s),
}));
const mockSendEmail = vi.fn().mockResolvedValue(undefined);
vi.mock('../email/index.js', () => ({
  sendEmail: (...a: unknown[]) => mockSendEmail(...a),
}));

import {
  runSiretRevalidationWorker,
  enqueueSiretRevalidation,
} from './revalidation.js';

const T0 = Date.parse('2026-06-30T00:00:00Z');

beforeEach(() => {
  vi.clearAllMocks();
  captures.updates = {};
  captures.inserts = {};
  captures.rpc = [];
  cfg.fileRows = [];
  cfg.entite = {
    id: 'entite-1',
    siret: '12345678901234',
    raison_sociale: 'Traiteur Test',
    organisation_id: 'org-1',
  };
  cfg.user = { email: 'jean@traiteur-test.fr' };
  mockVerifySiret.mockResolvedValue('down');
  mockSendEmail.mockResolvedValue(undefined);
});

describe('M0.4 — revalidation SIRET : enqueue (BL-P1-ONB-02)', () => {
  it('enqueue planifie une ligne en_attente au 1er palier (15 min)', async () => {
    await enqueueSiretRevalidation(mockSupabase as never, 'entite-1', T0);

    const ins = captures.inserts['file_revalidation_siret']?.[0] as Row;
    expect(ins).toBeDefined();
    expect(ins['entite_facturation_id']).toBe('entite-1');
    expect(ins['statut']).toBe('en_attente');
    expect(ins['tentatives']).toBe(0);
    expect(ins['prochaine_tentative_le']).toBe(
      new Date(T0 + 15 * 60 * 1000).toISOString(),
    );
  });
});

describe('M0.4 — revalidation SIRET : escalade et sortie (BL-P1-ONB-02)', () => {
  it("verdict 'verifie' → entité verifie + file resolu", async () => {
    cfg.fileRows = [
      { id: 'f-1', entite_facturation_id: 'entite-1', tentatives: 0 },
    ];
    mockVerifySiret.mockResolvedValue('verifie');

    const res = await runSiretRevalidationWorker(mockSupabase as never, T0);

    expect(res.verifie).toBe(1);
    expect(
      captures.updates['entites_facturation']?.[0]?.['siret_verification'],
    ).toBe('verifie');
    expect(captures.updates['file_revalidation_siret']?.[0]?.['statut']).toBe(
      'resolu',
    );
  });

  it("verdict 'echec' → entité echec + file resolu + email à l'organisation", async () => {
    cfg.fileRows = [
      { id: 'f-1', entite_facturation_id: 'entite-1', tentatives: 0 },
    ];
    mockVerifySiret.mockResolvedValue('echec');

    const res = await runSiretRevalidationWorker(mockSupabase as never, T0);

    expect(res.echec).toBe(1);
    expect(
      captures.updates['entites_facturation']?.[0]?.['siret_verification'],
    ).toBe('echec');
    expect(captures.updates['file_revalidation_siret']?.[0]?.['statut']).toBe(
      'resolu',
    );
    expect(mockSendEmail).toHaveBeenCalledWith(
      'siret_verification_echec',
      'jean@traiteur-test.fr',
      expect.objectContaining({ siret: '12345678901234' }),
      expect.anything(),
    );
  });

  it("verdict 'down' au palier 0 → re-planifié au palier suivant (1 h), pas d'épuisement", async () => {
    cfg.fileRows = [
      { id: 'f-1', entite_facturation_id: 'entite-1', tentatives: 0 },
    ];
    mockVerifySiret.mockResolvedValue('down');

    const res = await runSiretRevalidationWorker(mockSupabase as never, T0);

    expect(res.requeue).toBe(1);
    expect(res.epuise).toBe(0);
    const upd = captures.updates['file_revalidation_siret']?.[0] as Row;
    expect(upd['tentatives']).toBe(1);
    expect(upd['prochaine_tentative_le']).toBe(
      new Date(T0 + 60 * 60 * 1000).toISOString(),
    );
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it("verdict 'down' au dernier palier → file 'epuise' + alerte Admin in-app (INSEE durablement down)", async () => {
    cfg.fileRows = [
      { id: 'f-1', entite_facturation_id: 'entite-1', tentatives: 2 },
    ];
    mockVerifySiret.mockResolvedValue('down');

    const res = await runSiretRevalidationWorker(mockSupabase as never, T0);

    expect(res.epuise).toBe(1);
    expect(captures.updates['file_revalidation_siret']?.[0]?.['statut']).toBe(
      'epuise',
    );
    // entité JAMAIS passée 'echec' (down ≠ invalide) — pas d'update siret_verification.
    expect(captures.updates['entites_facturation']).toBeUndefined();
    expect(captures.rpc[0]?.fn).toBe('f_upsert_alerte_admin');
    expect(captures.rpc[0]?.args['p_code']).toBe('siret_revalidation_epuisee');
  });
});
