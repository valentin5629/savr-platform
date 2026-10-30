/**
 * M2.4 — Régénération Admin du rapport « Événement sans excédent » (§12 §1.3-bis l.198,
 * BL-P1-RPT-02). Le type 'rapport-evenement-sans-excedent' est désormais dans la map
 * DOC_ENTITY de regenerate.ts (porté par rapports_rse) → régénérable par l'Admin
 * (route admin passe le type tel quel). Ré-enqueue le job + marque regenere_at/version.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const logoKeyToDataUri = vi.hoisted(() =>
  vi.fn(async (cle: string | null | undefined) =>
    cle ? `data:image/png;base64,${cle}` : null,
  ),
);
vi.mock('../../src/lib/pdf/logo-inline.js', () => ({ logoKeyToDataUri }));

import { regenerateCollecteDocument } from '../../src/lib/pdf/regenerate.js';

// Réponse de la lecture des logos de l'événement (lib/pdf/logo-rapport-de-don).
function logosEvenement(
  deposé: string | null,
  traiteur: string | null = null,
): Record<string, unknown> {
  return {
    data: {
      evenements: {
        logo_client_organisateur_url: deposé,
        organisations: { type: 'traiteur', logo_url: traiteur },
        traiteur_operationnel: null,
        client_organisateur: null,
      },
    },
  };
}

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
    // [0] rapports_rse docRow, [1] jobs_pdf lastJob (payload figé), [2] logos de
    // l'événement, [3] select version (lue AVANT la mise en file : une lecture en
    // échec ne lance aucun rendu), [4] insert jobs_pdf, [5] update rapports_rse,
    // [6] insert audit_log.
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
      logosEvenement(null),
      { data: { version: 1 } },
      { data: { id: 'job-regen' } },
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

  it('logo du client relu sur l’événement : un logo déposé depuis remplace l’ancien', async () => {
    const sb = makeSupabase([
      { data: { id: 'rap-se-1' } },
      {
        data: { payload: { logo_url: 'data:ancien', motif: 'Client absent' } },
      },
      logosEvenement('cle-deposee', 'cle-traiteur'),
      { data: { version: 1 } },
      { data: { id: 'job-regen' } },
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
    const job = (
      (sb._chain.insert as ReturnType<typeof vi.fn>).mock.calls as Array<
        [Record<string, unknown>]
      >
    ).find((c) => c[0].type_document !== undefined)![0];
    const payload = job.payload as Record<string, unknown>;
    expect(payload.logo_url).toBe('data:image/png;base64,cle-deposee');
    expect(payload.motif).toBe('Client absent');
  });

  it('logo retiré de l’événement et aucun autre logo : le rapport refait n’en porte plus', async () => {
    const sb = makeSupabase([
      { data: { id: 'rap-se-1' } },
      { data: { payload: { logo_url: 'data:ancien' } } },
      logosEvenement(null),
      { data: { version: 1 } },
      { data: { id: 'job-regen' } },
      { data: null },
      { data: null },
    ]);
    await regenerateCollecteDocument(
      sb as never,
      'col-se-1',
      'rapport-evenement-sans-excedent',
      { userId: 'admin-1', role: 'admin_savr' },
    );
    const job = (
      (sb._chain.insert as ReturnType<typeof vi.fn>).mock.calls as Array<
        [Record<string, unknown>]
      >
    ).find((c) => c[0].type_document !== undefined)![0];
    expect((job.payload as Record<string, unknown>).logo_url).toBeNull();
  });

  it('attestation de don : logo du client relu, jamais celui du traiteur', async () => {
    // attestations_don n'a pas de version de rapport : pas de lecture de version.
    const sb = makeSupabase([
      { data: { id: 'att-1' } },
      { data: { payload: { numero: 'ATT-DON-2026-0001' } } },
      logosEvenement(null, 'cle-traiteur'),
      { data: { id: 'job-regen' } },
      { data: null },
    ]);
    const result = await regenerateCollecteDocument(
      sb as never,
      'col-ag-1',
      'attestation-don',
      { userId: 'admin-1', role: 'admin_savr' },
    );
    expect(result.ok).toBe(true);
    const job = (
      (sb._chain.insert as ReturnType<typeof vi.fn>).mock.calls as Array<
        [Record<string, unknown>]
      >
    ).find((c) => c[0].type_document !== undefined)![0];
    const payload = job.payload as Record<string, unknown>;
    expect(payload.logo_client_url).toBeNull();
    expect(payload.numero).toBe('ATT-DON-2026-0001');
  });

  it('lecture des logos en échec : aucun rendu relancé', async () => {
    const sb = makeSupabase([
      { data: { id: 'rap-se-1' } },
      { data: { payload: { motif: 'x' } } },
      { error: { code: 'XX000', message: 'boom' } },
    ]);
    const result = await regenerateCollecteDocument(
      sb as never,
      'col-se-1',
      'rapport-evenement-sans-excedent',
      { userId: 'admin-1', role: 'admin_savr' },
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('attendu échec');
    expect(result.code).toBe('DB_ERROR');
    expect(sb._chain.insert).not.toHaveBeenCalled();
  });
});
