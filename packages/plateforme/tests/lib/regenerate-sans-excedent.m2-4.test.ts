/**
 * M2.4 — Régénération Admin du rapport « Événement sans excédent » (§12 §1.3-bis l.198,
 * BL-P1-RPT-02). Le type 'rapport-evenement-sans-excedent' est désormais dans la map
 * DOC_ENTITY de regenerate.ts (porté par rapports_rse) → régénérable par l'Admin
 * (route admin passe le type tel quel). Ré-enqueue le job + marque regenere_at/version.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { regenerateCollecteDocument } from '../../src/lib/pdf/regenerate.js';

function makeSupabase(responses: Array<Record<string, unknown>>) {
  let idx = 0;
  const next = () => ({ data: null, error: null, ...responses[idx++] });
  const chain: Record<string, unknown> = {
    then(onFulfilled: (v: unknown) => unknown) {
      return Promise.resolve(next()).then(onFulfilled);
    },
    single: vi.fn(() => Promise.resolve(next())),
    maybeSingle: vi.fn(() => Promise.resolve(next())),
  };
  for (const m of ['select', 'insert', 'update', 'eq', 'order', 'limit']) {
    chain[m] = vi.fn(() => chain);
  }
  return { from: vi.fn(() => chain), _chain: chain };
}

beforeEach(() => vi.clearAllMocks());

describe('M2.4 / régénération Admin rapport sans-excédent (BL-P1-RPT-02)', () => {
  it('type rapport-evenement-sans-excedent → ré-enqueue job + regenere_at/version+1', async () => {
    // [0] rapports_rse docRow, [1] jobs_pdf lastJob (payload figé), [2] insert jobs_pdf,
    // [3] select version, [4] update rapports_rse, [5] insert audit_log.
    const sb = makeSupabase([
      { data: { id: 'rap-se-1' } },
      {
        data: {
          payload: {
            nom_evenement: 'Cocktail Élysée',
            motif: 'Client absent',
            chauffeur_nom: 'Jean Vélo',
          },
        },
      },
      { data: { id: 'job-regen' } },
      { data: { version: 1 } },
      { data: null },
      { data: null },
    ]);

    const result = await regenerateCollecteDocument(
      sb as never,
      'col-se-1',
      'rapport-evenement-sans-excedent',
      { userId: 'admin-1', role: 'admin_savr' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('attendu ok');
    expect(result.jobId).toBe('job-regen');
    expect(result.type).toBe('rapport-evenement-sans-excedent');

    const insertCalls = (sb._chain.insert as ReturnType<typeof vi.fn>).mock
      .calls as Array<[Record<string, unknown>]>;
    // Job ré-enqueué : même type + entity rapports_rse + mention de régénération.
    const jobInsert = insertCalls.find(
      (c) => c[0].type_document !== undefined,
    )?.[0];
    expect(jobInsert).toBeDefined();
    expect(jobInsert!.type_document).toBe('rapport-evenement-sans-excedent');
    expect(jobInsert!.entity_type).toBe('rapports_rse');
    const payload = jobInsert!.payload as Record<string, unknown>;
    expect(payload.regenere_le).toBeDefined();
    expect(payload.motif).toBe('Client absent'); // payload figé conservé

    // Marque de régénération sur rapports_rse (picto ⟳ + version+1).
    const updateCalls = (sb._chain.update as ReturnType<typeof vi.fn>).mock
      .calls as Array<[Record<string, unknown>]>;
    const rseUpdate = updateCalls.find(
      (c) => c[0].regenere_at !== undefined,
    )?.[0];
    expect(rseUpdate).toBeDefined();
    expect(rseUpdate!.regenere_par_user_id).toBe('admin-1');
    expect(rseUpdate!.version).toBe(2);
  });

  it('document jamais généré (pas de ligne rapports_rse) → NO_DOCUMENT', async () => {
    const sb = makeSupabase([{ data: null }]);
    const result = await regenerateCollecteDocument(
      sb as never,
      'col-se-1',
      'rapport-evenement-sans-excedent',
      { userId: 'admin-1', role: 'admin_savr' },
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('attendu échec');
    expect(result.code).toBe('NO_DOCUMENT');
  });
});
