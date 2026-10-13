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
  /** Erreur rendue par l'UPDATE de la ligne rapports_rse. */
  majErreur?: { message: string };
  /** Erreur rendue par la lecture de la version courante du rapport. */
  curErreur?: { message: string };
}

function makeSupabase(r: MockResults) {
  const inserts: { table: string; payload: Record<string, unknown> }[] = [];
  const updates: { table: string; payload: Record<string, unknown> }[] = [];
  const retraits: { table: string; id: unknown }[] = [];

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
      single: async () =>
        r.curErreur
          ? { data: null, error: r.curErreur }
          : { data: r.cur ?? { version: 1 }, error: null },
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
        return {
          eq: async () => ({ data: null, error: r.majErreur ?? null }),
        };
      },
      delete: () => ({
        eq: async (_col: string, id: unknown) => {
          retraits.push({ table, id });
          return { data: null, error: null };
        },
      }),
    };
    return chain;
  };

  return { supabase: { from } as never, inserts, updates, retraits };
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

// Gabarit @3 : la page 1 du rapport de recyclage existe avec ou sans le radar de
// comparaison au parc. La régénération est le seul endroit où cette version se
// choisit ; `rapports_rse.filtres_benchmark` dit laquelle est en vigueur.
describe('M1.6 / régénération — version du rapport de recyclage (avec ou sans radar)', () => {
  const RADAR = {
    benchmark_flux: [
      {
        flux_code: 'biodechet',
        flux_nom: 'Biodéchets',
        collecte_kg_pax: 0.21,
        benchmark_kg_pax: 0.24,
      },
      {
        flux_code: 'verre',
        flux_nom: 'Verre',
        collecte_kg_pax: 0.13,
        benchmark_kg_pax: null,
      },
    ],
    benchmark_legende: 'période 13/10/2024 → 13/10/2026 · lieux : tous',
    filtres_benchmark: {
      periode_debut: '2024-10-13',
      periode_fin: '2026-10-13',
      lieu_ids: null,
      type_evenement_ids: ['t1'],
      taille_evenement_codes: ['M'],
    },
  };
  const figeSansRadar = {
    client_nom: 'Groupe Lumière',
    poids_total_kg: 234,
    options: { benchmark: false },
  };
  const figeAvecRadar = {
    ...figeSansRadar,
    options: { benchmark: true },
    benchmark_flux: [{ flux_code: 'carton', collecte_kg_pax: 0.07 }],
    benchmark_legende: 'ancienne légende',
  };

  async function regenerer(
    fige: Record<string, unknown>,
    version?: Parameters<typeof regenerateCollecteDocument>[4],
    majErreur?: { message: string },
    curErreur?: { message: string },
  ) {
    const m = makeSupabase({
      docRow: { id: 'r1' },
      lastJob: { payload: fige },
      majErreur,
      curErreur,
    });
    const res = await regenerateCollecteDocument(
      m.supabase,
      'c1',
      'rapport-recyclage-zd',
      actor,
      version,
    );
    const payload = m.inserts.find((i) => i.table === 'jobs_pdf')?.payload
      .payload as Record<string, unknown> | undefined;
    const maj = m.updates.find((u) => u.table === 'rapports_rse')?.payload;
    return { res, payload, maj, retraits: m.retraits, inserts: m.inserts };
  }

  it('radar demandé → payload avec radar + filtres figés sur le rapport', async () => {
    const { res, payload, maj } = await regenerer(figeSansRadar, {
      avecRadar: true,
      radar: RADAR,
    });
    expect(res.ok).toBe(true);
    expect(payload!.options).toEqual({ benchmark: true });
    expect(payload!.benchmark_flux).toEqual(RADAR.benchmark_flux);
    expect(payload!.benchmark_legende).toBe(RADAR.benchmark_legende);
    // Le reste du payload figé est reproduit tel quel.
    expect(payload!.client_nom).toBe('Groupe Lumière');
    expect(maj!.filtres_benchmark).toEqual(RADAR.filtres_benchmark);
    expect(maj!.version).toBe(2);
  });

  it('radar décoché → ses données quittent le payload, filtres_benchmark repasse à NULL', async () => {
    const { payload, maj } = await regenerer(figeAvecRadar, {
      avecRadar: false,
    });
    expect(payload!.options).toEqual({ benchmark: false });
    expect(payload).not.toHaveProperty('benchmark_flux');
    expect(payload).not.toHaveProperty('benchmark_legende');
    expect(maj).toHaveProperty('filtres_benchmark', null);
  });

  it('aucune version demandée → reproduction fidèle : un rapport avec radar garde le sien, snapshot intouché', async () => {
    const { payload, maj } = await regenerer(figeAvecRadar);
    expect(payload!.options).toEqual({ benchmark: true });
    expect(payload!.benchmark_flux).toEqual(figeAvecRadar.benchmark_flux);
    expect(payload!.benchmark_legende).toBe('ancienne légende');
    expect(maj).not.toHaveProperty('filtres_benchmark');
  });

  it('aucune version demandée sur un rapport sans radar (dont un payload antérieur à @3) → snapshot remis à NULL', async () => {
    const figes: Record<string, unknown>[] = [
      figeSansRadar,
      // Payload @2 : pas d'« options », jauges d'époque → rendu sans radar en @3.
      { nom_evenement: 'Gala', benchmark_flux: [{ flux_nom: 'Biodéchets' }] },
    ];
    for (const fige of figes) {
      const { payload, maj } = await regenerer(fige);
      expect(payload!.options).toEqual(fige.options);
      expect(maj).toHaveProperty('filtres_benchmark', null);
    }
  });

  it('radar demandé mais aucun flux rapporté aux convives → rapport sans radar, et le snapshot le dit', async () => {
    const { res, payload, maj } = await regenerer(figeSansRadar, {
      avecRadar: true,
      radar: {
        ...RADAR,
        benchmark_flux: RADAR.benchmark_flux.map((g) => ({
          ...g,
          collecte_kg_pax: null,
        })),
      },
    });
    expect(res.ok).toBe(true);
    expect(payload!.options).toEqual({ benchmark: false });
    expect(payload).not.toHaveProperty('benchmark_flux');
    expect(maj).toHaveProperty('filtres_benchmark', null);
  });

  it('marquage du rapport en échec → DB_ERROR au message neutre, et le rendu mis en file est retiré', async () => {
    const { res, retraits, inserts } = await regenerer(
      figeSansRadar,
      { avecRadar: true, radar: RADAR },
      { message: 'permission denied for table rapports_rse' },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe('DB_ERROR');
      expect(res.message).toBe('Erreur serveur');
    }
    // Sans ce retrait, le PDF sortirait avec le radar sur une ligne qui dit « sans ».
    expect(retraits).toEqual([{ table: 'jobs_pdf', id: 'job-new' }]);
    // Rien n'est tracé comme régénéré.
    expect(inserts.some((i) => i.table === 'audit_log')).toBe(false);
  });

  it('marquage réussi → aucun retrait du rendu mis en file', async () => {
    const { res, retraits } = await regenerer(figeSansRadar, {
      avecRadar: true,
      radar: RADAR,
    });
    expect(res.ok).toBe(true);
    expect(retraits).toEqual([]);
  });

  it('version courante illisible → DB_ERROR avant toute mise en file (aucun rendu lancé)', async () => {
    const { res, inserts, maj } = await regenerer(
      figeSansRadar,
      { avecRadar: false },
      undefined,
      { message: 'connection reset' },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('DB_ERROR');
    expect(inserts).toEqual([]);
    expect(maj).toBeUndefined();
  });

  it('la version ne s’applique qu’au rapport de recyclage : un bordereau l’ignore', async () => {
    const m = makeSupabase({
      docRow: { id: 'b1' },
      lastJob: { payload: { numero: 'BSAV-1' } },
    });
    await regenerateCollecteDocument(m.supabase, 'c1', 'bordereau-zd', actor, {
      avecRadar: true,
      radar: RADAR,
    });
    const payload = m.inserts.find((i) => i.table === 'jobs_pdf')!.payload
      .payload as Record<string, unknown>;
    expect(payload).not.toHaveProperty('options');
    expect(payload).not.toHaveProperty('benchmark_flux');
    expect(m.updates).toHaveLength(0);
  });
});
