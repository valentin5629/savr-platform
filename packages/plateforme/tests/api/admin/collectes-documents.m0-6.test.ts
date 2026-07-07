/**
 * M0.6 — Régénération PDF de la fiche collecte (BL-P1-BOA-07, §06.06 l.283-284).
 * Vérifie le helper regenerateCollecteDocument : ré-enqueue jobs_pdf (copie du
 * dernier payload figé) + audit_log, gardes NO_DOCUMENT / NO_PRIOR_JOB / UNKNOWN_TYPE,
 * bump regenere_at/version pour le rapport RSE (picto ⟳, §06.06 l.170).
 */
import { describe, it, expect } from 'vitest';
import { regenerateCollecteDocument } from '@/lib/pdf/regenerate.js';

interface MockResults {
  docRow?: { id: string } | null;
  lastJob?: { payload: Record<string, unknown> } | null;
  newJob?: { id: string };
  cur?: { version: number };
}

function makeSupabase(r: MockResults) {
  const inserts: { table: string; payload: Record<string, unknown> }[] = [];
  const updates: { table: string; payload: Record<string, unknown> }[] = [];

  const from = (table: string) => {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () =>
        table === 'jobs_pdf'
          ? { data: r.lastJob ?? null, error: null }
          : { data: r.docRow ?? null, error: null },
      single: async () => ({ data: r.cur ?? { version: 1 }, error: null }),
      insert: (payload: Record<string, unknown>) => {
        inserts.push({ table, payload });
        return {
          select: () => ({
            single: async () => ({
              data: r.newJob ?? { id: 'job-new' },
              error: null,
            }),
          }),
          then: (resolve: (v: unknown) => void) =>
            resolve({ data: null, error: null }),
        };
      },
      update: (payload: Record<string, unknown>) => {
        updates.push({ table, payload });
        return { eq: async () => ({ data: null, error: null }) };
      },
    };
    return chain;
  };

  return { supabase: { from } as never, inserts, updates };
}

const actor = { userId: 'admin-1', role: 'admin_savr' };

describe('M0.6 — régénération PDF collecte (BL-P1-BOA-07)', () => {
  it('M0.6 — type de document inconnu → UNKNOWN_TYPE (422 côté route)', async () => {
    const { supabase } = makeSupabase({});
    const res = await regenerateCollecteDocument(supabase, 'c1', 'foo', actor);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('UNKNOWN_TYPE');
  });

  it('M0.6 — document jamais généré → NO_DOCUMENT (409)', async () => {
    const { supabase, inserts } = makeSupabase({ docRow: null });
    const res = await regenerateCollecteDocument(
      supabase,
      'c1',
      'bordereau-zd',
      actor,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('NO_DOCUMENT');
    expect(inserts).toHaveLength(0);
  });

  it('M0.6 — aucun rendu antérieur → NO_PRIOR_JOB (409)', async () => {
    const { supabase } = makeSupabase({
      docRow: { id: 'b1' },
      lastJob: null,
    });
    const res = await regenerateCollecteDocument(
      supabase,
      'c1',
      'bordereau-zd',
      actor,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('NO_PRIOR_JOB');
  });

  it('M0.6 — succès rapport RSE : ré-enqueue jobs_pdf (payload copié) + audit_log + bump regenere_at/version', async () => {
    const { supabase, inserts, updates } = makeSupabase({
      docRow: { id: 'r1' },
      lastJob: { payload: { numero: 'BSAV-1', poids_total_kg: 12 } },
      newJob: { id: 'job-42' },
      cur: { version: 2 },
    });
    const res = await regenerateCollecteDocument(
      supabase,
      'c1',
      'rapport-recyclage-zd',
      actor,
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.jobId).toBe('job-42');

    // jobs_pdf ré-enqueué avec le type + le payload figé recopié.
    const job = inserts.find((i) => i.table === 'jobs_pdf');
    expect(job).toBeTruthy();
    expect(job!.payload.type_document).toBe('rapport-recyclage-zd');
    expect(job!.payload.entity_type).toBe('rapports_rse');
    expect(job!.payload.entity_id).toBe('r1');
    // Payload figé recopié + mention de régénération pied de page (§12 §1.4, BL-P2-20).
    const rePayload = job!.payload.payload as Record<string, unknown>;
    expect(rePayload.numero).toBe('BSAV-1');
    expect(rePayload.poids_total_kg).toBe(12);
    expect(typeof rePayload.regenere_le).toBe('string');
    expect(job!.payload.statut).toBe('pending');

    // audit_log tracé.
    const audit = inserts.find((i) => i.table === 'audit_log');
    expect(audit).toBeTruthy();
    expect(audit!.payload.action).toBe('document_regenere');
    expect(audit!.payload.record_id).toBe('r1');

    // Rapport : regenere_at + version+1 (picto ⟳).
    const upd = updates.find((u) => u.table === 'rapports_rse');
    expect(upd).toBeTruthy();
    expect(upd!.payload.regenere_at).toBeTruthy();
    expect(upd!.payload.regenere_par_user_id).toBe('admin-1');
    expect(upd!.payload.version).toBe(3);
  });

  it('M0.6 — succès attestation : ré-enqueue + audit sans bump version rapport', async () => {
    const { supabase, inserts, updates } = makeSupabase({
      docRow: { id: 'a1' },
      lastJob: { payload: { numero: 'ATT-1' } },
      newJob: { id: 'job-77' },
    });
    const res = await regenerateCollecteDocument(
      supabase,
      'c1',
      'attestation-don',
      actor,
    );
    expect(res.ok).toBe(true);
    const job = inserts.find((i) => i.table === 'jobs_pdf');
    expect(job!.payload.type_document).toBe('attestation-don');
    expect(job!.payload.entity_type).toBe('attestations_don');
    // Pas d'update rapports_rse (bump ⟳ réservé au rapport RSE).
    expect(updates.find((u) => u.table === 'rapports_rse')).toBeUndefined();
  });
});
