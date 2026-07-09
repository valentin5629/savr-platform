/**
 * M0.3 — BL-P2-30 — Cron notify-pack-etat : envoi du template 9 admin_pack_ag_etat
 * (§06.02 l.199-205) pour les alertes in-app pack_ag_bas / pack_ag_epuise écrites
 * par les triggers de débit. Idempotence via email_notifie_at. Destinataire = inbox
 * admin partagée.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  setEmailCaptureSink,
  type CapturedEmail,
} from '@savr/shared/src/email/index.js';
import { traiterAlertesPackEtat } from '@/lib/packs/notify-pack-etat.js';

// ── Mock Supabase : filtre alertes_admin (eq/is/in), maybeSingle par table,
//    et enregistre les UPDATE email_notifie_at. ────────────────────────────────
interface Alerte {
  id: string;
  code: string;
  entity_id: string | null;
  statut?: string;
  email_notifie_at?: string | null;
}
interface Cfg {
  alertes: Alerte[];
  packs: Record<string, unknown>;
  derniere: Record<string, unknown>;
  updates: { table: string; payload: unknown; id: unknown }[];
}

function makeSupabase(cfg: Cfg) {
  return {
    from(table: string) {
      const b: Record<string, unknown> & {
        _eqs: { col: string; val: unknown }[];
        _is: { col: string }[];
        _isUpdate: boolean;
        _payload: unknown;
      } = {
        _eqs: [],
        _is: [],
        _isUpdate: false,
        _payload: null,
        select: () => b,
        in: () => b,
        order: () => b,
        limit: () => b,
        eq: (col: string, val: unknown) => {
          b._eqs.push({ col, val });
          return b;
        },
        is: (col: string) => {
          b._is.push({ col });
          return b;
        },
        update: (payload: unknown) => {
          b._isUpdate = true;
          b._payload = payload;
          return b;
        },
        maybeSingle: () => {
          const lastId = b._eqs[b._eqs.length - 1]?.val as string;
          if (table === 'packs_antgaspi')
            return Promise.resolve({
              data: cfg.packs[lastId] ?? null,
              error: null,
            });
          if (table === 'collectes')
            return Promise.resolve({
              data: cfg.derniere[lastId] ?? null,
              error: null,
            });
          return Promise.resolve({ data: null, error: null });
        },
        then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => {
          let result: unknown;
          if (b._isUpdate) {
            cfg.updates.push({
              table,
              payload: b._payload,
              id: b._eqs[b._eqs.length - 1]?.val,
            });
            result = { data: null, error: null };
          } else if (table === 'alertes_admin') {
            let rows = cfg.alertes;
            for (const { col, val } of b._eqs)
              rows = rows.filter(
                (r) => (r as unknown as Record<string, unknown>)[col] === val,
              );
            for (const { col } of b._is)
              rows = rows.filter(
                (r) => (r as unknown as Record<string, unknown>)[col] == null,
              );
            result = { data: rows, error: null };
          } else {
            result = { data: null, error: null };
          }
          return Promise.resolve(result).then(onF, onR);
        },
      };
      return b;
    },
  };
}

let captured: CapturedEmail[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  captured = [];
  setEmailCaptureSink((e) => captured.push(e));
});
afterEach(() => setEmailCaptureSink(null));

const PACK_BAS = {
  credits_initiaux: 50,
  credits_restants: 4,
  credits_consommes: 46,
  type_pack: 'pack_50',
  organisation_id: 'org-1',
  organisations: { nom: 'Kaspia' },
};

describe('M0.3 — cron notify-pack-etat (template 9)', () => {
  it('M0.3-5 — alerte pack_ag_bas → template 9 niveau=bas envoyé + email_notifie_at posé', async () => {
    const cfg: Cfg = {
      alertes: [
        {
          id: 'al-1',
          code: 'pack_ag_bas',
          entity_id: 'pack-1',
          statut: 'ouverte',
          email_notifie_at: null,
        },
      ],
      packs: { 'pack-1': PACK_BAS },
      derniere: { 'pack-1': { date_collecte: '2026-07-01' } },
      updates: [],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await traiterAlertesPackEtat(makeSupabase(cfg) as any);

    expect(res.nb_traite).toBe(1);
    expect(captured).toHaveLength(1);
    const mail = captured[0]!;
    expect(mail.slug).toBe('admin_pack_ag_etat');
    expect(mail.to).toBe('hello@gosavr.io');
    expect(mail.variables.niveau).toBe('bas');
    expect(mail.variables.niveau_bas).toBe('true');
    expect(mail.variables.niveau_epuise).toBe('');
    // Idempotence : email_notifie_at posé sur l'alerte traitée.
    const upd = cfg.updates.find((u) => u.id === 'al-1');
    expect(upd).toBeTruthy();
    expect(
      (upd!.payload as { email_notifie_at?: string }).email_notifie_at,
    ).toBeTruthy();
  });

  it('M0.3-6 — alerte pack_ag_epuise → template 9 niveau=epuise (bloc programmation bloquée)', async () => {
    const cfg: Cfg = {
      alertes: [
        {
          id: 'al-2',
          code: 'pack_ag_epuise',
          entity_id: 'pack-2',
          statut: 'ouverte',
          email_notifie_at: null,
        },
      ],
      packs: {
        'pack-2': {
          ...PACK_BAS,
          credits_restants: 0,
          credits_consommes: 50,
          organisation_id: 'org-2',
          organisations: { nom: 'Fleur de Mets' },
        },
      },
      derniere: {},
      updates: [],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await traiterAlertesPackEtat(makeSupabase(cfg) as any);

    expect(captured).toHaveLength(1);
    expect(captured[0]!.variables.niveau).toBe('epuise');
    expect(captured[0]!.variables.niveau_epuise).toBe('true');
    expect(captured[0]!.variables.niveau_bas).toBe('');
  });

  it('M0.3-7 — alerte déjà notifiée (email_notifie_at renseigné) → aucun renvoi (idempotent)', async () => {
    const cfg: Cfg = {
      alertes: [
        {
          id: 'al-3',
          code: 'pack_ag_bas',
          entity_id: 'pack-1',
          statut: 'ouverte',
          email_notifie_at: '2026-07-09T06:00:00Z',
        },
      ],
      packs: { 'pack-1': PACK_BAS },
      derniere: {},
      updates: [],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await traiterAlertesPackEtat(makeSupabase(cfg) as any);

    expect(res.nb_traite).toBe(0);
    expect(captured).toHaveLength(0);
  });

  it('M0.3-8 — variables tpl 9 résolues depuis le pack (organisation, crédits, pct, etat_libelle)', async () => {
    const cfg: Cfg = {
      alertes: [
        {
          id: 'al-4',
          code: 'pack_ag_bas',
          entity_id: 'pack-1',
          statut: 'ouverte',
          email_notifie_at: null,
        },
      ],
      packs: { 'pack-1': PACK_BAS },
      derniere: { 'pack-1': { date_collecte: '2026-07-05' } },
      updates: [],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await traiterAlertesPackEtat(makeSupabase(cfg) as any);

    const v = captured[0]!.variables;
    expect(v.organisation_nom).toBe('Kaspia');
    expect(v.credits_restants).toBe('4');
    expect(v.credits_initiaux).toBe('50');
    expect(v.pct_restant).toBe('8'); // 4/50 = 8 %
    expect(v.etat_libelle).toBe('bientôt épuisé');
    expect(v.derniere_collecte_date).toBe('2026-07-05');
  });
});
