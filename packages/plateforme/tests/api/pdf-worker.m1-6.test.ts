/**
 * M1.6 — Tests PDF worker (claim → Railway → R2 → done/dead)
 * Scénarios P1 : retry, dead + alerte, linkage fichier vers entité.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks externes ─────────────────────────────────────────────────────────

vi.mock('../../src/lib/pdf/railway-client.js', () => ({
  generatePdf: vi.fn(),
}));
vi.mock('../../src/lib/pdf/r2-client.js', () => ({
  uploadPdf: vi.fn(),
}));

import { generatePdf } from '../../src/lib/pdf/railway-client.js';
import { uploadPdf } from '../../src/lib/pdf/r2-client.js';
import { runPdfWorker } from '../../src/lib/pdf/pdf-worker.js';

// ── Supabase mock ──────────────────────────────────────────────────────────

const mockFrom = vi.fn();
const mockRpc = vi.fn();
const supabase = {
  from: mockFrom,
  rpc: mockRpc,
  schema: vi.fn(() => ({ from: mockFrom })),
} as never;

function makePendingJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    type_document: 'bordereau-zd',
    entity_type: 'bordereaux_savr',
    entity_id: 'bord-1',
    payload: { numero: 'BSAV-2026-00001' },
    attempts: 0,
    ...overrides,
  };
}

function buildChain(responses: unknown[]) {
  let idx = 0;
  const chain: Record<string, unknown> = {};
  const next = () => responses[idx++] ?? { data: null, error: null };
  const methods = [
    'select',
    'insert',
    'update',
    'eq',
    'in',
    'or',
    'order',
    'limit',
    'is',
    'lte',
    'single',
  ];
  methods.forEach((m) => {
    chain[m] = vi.fn(() => {
      if (m === 'single' || m === 'limit') return Promise.resolve(next());
      return chain;
    });
  });
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRpc.mockResolvedValue({ data: null, error: null });
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('M1.6 / PdfWorker / Aucun job pending', () => {
  it('retourne processed=0 si la table est vide', async () => {
    mockFrom.mockReturnValue(buildChain([{ data: [], error: null }]));
    const result = await runPdfWorker(supabase);
    expect(result.processed).toBe(0);
    expect(result.done).toBe(0);
  });
});

describe('M1.6 / PdfWorker / Job nominal', () => {
  it('R-PDF-W1 : job pending → done après génération et upload R2', async () => {
    const job = makePendingJob();
    const pdfBuf = Buffer.from('PDF');
    vi.mocked(generatePdf).mockResolvedValue({ pdfBuffer: pdfBuf });
    vi.mocked(uploadPdf).mockResolvedValue(
      'bordereaux/bord-1/bordereau-zd-v1-123.pdf',
    );

    const chain = buildChain([
      { data: [job], error: null }, // select jobs
      { data: null, error: null }, // update processing
      { data: { id: 'fichier-1' }, error: null }, // insert fichiers
      { data: null, error: null }, // update jobs done
      { data: null, error: null }, // update bordereaux_savr
    ]);
    mockFrom.mockReturnValue(chain);

    const result = await runPdfWorker(supabase);
    expect(result.done).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(generatePdf).toHaveBeenCalledWith('bordereau-zd', job.payload);
    expect(uploadPdf).toHaveBeenCalledWith(
      'bordereaux',
      expect.stringContaining('bord-1'),
      pdfBuf,
    );
  });
});

describe('M1.6 / PdfWorker / Retry', () => {
  it('R-PDF-W2 : échec Railway → statut failed, next_retry_at dans 15 min', async () => {
    const job = makePendingJob({ attempts: 0 });
    vi.mocked(generatePdf).mockRejectedValue(new Error('Railway timeout'));

    const chain = buildChain([
      { data: [job], error: null },
      { data: null, error: null }, // update processing
      { data: null, error: null }, // update failed
    ]);
    mockFrom.mockReturnValue(chain);

    const result = await runPdfWorker(supabase);
    expect(result.done).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.dead).toBe(0);

    const updateCall = chain.update as ReturnType<typeof vi.fn>;
    const failArg = updateCall.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>).statut === 'failed',
    )?.[0] as Record<string, unknown> | undefined;
    expect(failArg?.statut).toBe('failed');
    expect(failArg?.next_retry_at).toBeDefined();
  });

  it('R-PDF-W3 : attempts ≥ 16 → statut dead + alerte Admin', async () => {
    const job = makePendingJob({ attempts: 15 });
    vi.mocked(generatePdf).mockRejectedValue(new Error('persistent error'));

    const chain = buildChain([
      { data: [job], error: null },
      { data: null, error: null }, // update processing
      { data: null, error: null }, // update dead
    ]);
    mockFrom.mockReturnValue(chain);

    const result = await runPdfWorker(supabase);
    expect(result.dead).toBe(1);

    expect(mockRpc).toHaveBeenCalledWith(
      'f_upsert_alerte_admin',
      expect.objectContaining({
        p_code: 'pdf_job_dead',
        p_entity_type: 'bordereaux_savr',
        p_entity_id: 'bord-1',
      }),
    );
  });
});

describe('M1.6 / PdfWorker / rapport-recyclage-zd', () => {
  it('R-PDF-W4 : type rapport → bucket rapports, pdf_url = clé R2 (pas le fichier_id)', async () => {
    const storageKey = 'rapports/rse-1/rapport-recyclage-zd-v1-123.pdf';
    const job = makePendingJob({
      type_document: 'rapport-recyclage-zd',
      entity_type: 'rapports_rse',
      entity_id: 'rse-1',
    });
    vi.mocked(generatePdf).mockResolvedValue({ pdfBuffer: Buffer.from('PDF') });
    vi.mocked(uploadPdf).mockResolvedValue(storageKey);

    // limit() consomme responses[0], single() consomme responses[1]
    const chain = buildChain([
      { data: [job], error: null }, // limit → select jobs
      { data: { id: 'f-2' }, error: null }, // single → insert fichiers
    ]);
    mockFrom.mockReturnValue(chain);

    const result = await runPdfWorker(supabase);
    expect(result.done).toBe(1);
    expect(uploadPdf).toHaveBeenCalledWith(
      'rapports',
      expect.any(String),
      expect.any(Buffer),
    );

    // E2 : pdf_url doit recevoir la clé R2 (bucket/key), pas l'UUID fichier
    const updateCalls = (chain.update as ReturnType<typeof vi.fn>).mock
      .calls as Array<[Record<string, unknown>]>;
    const rseUpdate = updateCalls.find((c) => c[0].pdf_url !== undefined)?.[0];
    expect(rseUpdate?.pdf_url).toBe(storageKey);
  });
});
