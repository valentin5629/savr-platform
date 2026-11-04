/**
 * Documents d'une collecte fabriqués juste après une saisie de poids par
 * l'Admin (Val 2026-11-04) : batch de CETTE collecte, puis rendu de ses seuls
 * documents. Un échec ne remonte jamais à la route (le passage planifié reprend).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sim = vi.hoisted(() => ({
  apresTaches: [] as Array<() => Promise<void>>,
  afterLeve: false,
}));

vi.mock('next/server', () => ({
  after: (tache: () => Promise<void>) => {
    if (sim.afterLeve) throw new Error('hors requête');
    sim.apresTaches.push(tache);
  },
}));

const runBatchPdfJ1 = vi.fn();
const runBatchPdfJ1Ag = vi.fn();
const runPdfWorker = vi.fn();
vi.mock('../../src/lib/pdf/batch-pdf-j1.js', () => ({
  runBatchPdfJ1: (...a: unknown[]) => runBatchPdfJ1(...a),
}));
vi.mock('../../src/lib/pdf/batch-pdf-j1-ag.js', () => ({
  runBatchPdfJ1Ag: (...a: unknown[]) => runBatchPdfJ1Ag(...a),
}));
vi.mock('../../src/lib/pdf/pdf-worker.js', () => ({
  runPdfWorker: (...a: unknown[]) => runPdfWorker(...a),
}));

const documents = vi.fn();
const client = {
  from: vi.fn(() => ({
    select: () => ({ eq: () => documents() }),
  })),
};
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => client,
}));

import { logger } from '@savr/shared/src/logger/index.js';
import {
  fabriquer,
  fabriquerDocumentsSansAttendre,
} from '../../src/lib/pdf/documents-sans-attendre.js';

const batchVide = { enqueued: 0, errors: [] as string[] };

beforeEach(() => {
  vi.clearAllMocks();
  sim.apresTaches.length = 0;
  sim.afterLeve = false;
  runBatchPdfJ1.mockResolvedValue(batchVide);
  runBatchPdfJ1Ag.mockResolvedValue(batchVide);
  runPdfWorker.mockResolvedValue({ processed: 0 });
  documents.mockResolvedValue({ data: [{ id: 'doc-1' }], error: null });
});

describe('fabrication des documents juste après une saisie Admin', () => {
  it('ZD : batch des bordereaux pour cette collecte, puis rendu de son bordereau seul', async () => {
    await fabriquer(client as never, 'col-1', 'zero_dechet');
    expect(runBatchPdfJ1).toHaveBeenCalledWith(client, { collecteId: 'col-1' });
    expect(runBatchPdfJ1Ag).not.toHaveBeenCalled();
    expect(client.from).toHaveBeenCalledWith('bordereaux_savr');
    expect(runPdfWorker).toHaveBeenCalledWith(client, { entityIds: ['doc-1'] });
  });

  it('AG : batch des attestations pour cette collecte, rendu de ses attestations', async () => {
    documents.mockResolvedValue({
      data: [{ id: 'att-1' }, { id: 'att-2' }],
      error: null,
    });
    await fabriquer(client as never, 'col-ag', 'anti_gaspi');
    expect(runBatchPdfJ1Ag).toHaveBeenCalledWith(client, {
      collecteId: 'col-ag',
    });
    expect(client.from).toHaveBeenCalledWith('attestations_don');
    expect(runPdfWorker).toHaveBeenCalledWith(client, {
      entityIds: ['att-1', 'att-2'],
    });
  });

  it('rendus repris tant qu’il en reste, au plus 3 passages', async () => {
    runPdfWorker.mockResolvedValue({ processed: 5 });
    await fabriquer(client as never, 'col-1', 'zero_dechet');
    expect(runPdfWorker).toHaveBeenCalledTimes(3);
  });

  it('programmée après la réponse : rien ne tourne avant', async () => {
    fabriquerDocumentsSansAttendre('col-1', 'zero_dechet');
    expect(runBatchPdfJ1).not.toHaveBeenCalled();
    await sim.apresTaches[0]!();
    expect(runBatchPdfJ1).toHaveBeenCalledWith(client, { collecteId: 'col-1' });
  });

  it('un échec après la réponse est journalisé, jamais relancé', async () => {
    const logErr = vi.spyOn(logger, 'error');
    runBatchPdfJ1.mockRejectedValue(new Error('base indisponible'));
    fabriquerDocumentsSansAttendre('col-1', 'zero_dechet');
    await expect(sim.apresTaches[0]!()).resolves.toBeUndefined();
    expect(logErr).toHaveBeenCalledWith(
      'pdf.documents_sans_attendre.echec',
      expect.objectContaining({ collecte_id: 'col-1' }),
    );
  });

  it('hors requête (after indisponible) : la route n’échoue pas', () => {
    sim.afterLeve = true;
    const logErr = vi.spyOn(logger, 'error');
    expect(() =>
      fabriquerDocumentsSansAttendre('col-1', 'anti_gaspi'),
    ).not.toThrow();
    expect(logErr).toHaveBeenCalledWith(
      'pdf.documents_sans_attendre.non_programme',
      expect.objectContaining({ collecte_id: 'col-1' }),
    );
  });
});
