/**
 * Relève entrante planifiée (cron polling-mts1) : fenêtre demandée aux
 * prestataires et nombre de relèves par passage.
 *
 * La recherche de commandes MTS-1 compare des JOURS entiers (mesuré le
 * 2026-10-13). Avec 2 h de recul, une commande du jour J n'était plus demandée
 * après 2 h du matin à J+1 : la fin d'une collecte de nuit n'était jamais vue.
 * Décision Val 2026-10-13 : 3 jours de recul.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TRANSPORTEURS = [
  {
    id: 'tr-camion-a',
    type_tms: 'mts1',
    code_transporteur_mts1: 'CA_FICTIF_A',
    prestataire_logistique_id: 'presta-a',
  },
  {
    id: 'tr-camion-b',
    type_tms: 'mts1',
    code_transporteur_mts1: 'CA_FICTIF_B',
    prestataire_logistique_id: 'presta-b',
  },
  {
    id: 'tr-velo',
    type_tms: 'a_toutes',
    code_transporteur_mts1: null,
    prestataire_logistique_id: 'presta-c',
  },
];

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => ({
    from: () => ({
      select: () => Promise.resolve({ data: TRANSPORTEURS, error: null }),
    }),
  }),
}));

const { sync, getLogistiqueProvider } = vi.hoisted(() => {
  const sync = vi.fn().mockResolvedValue(undefined);
  return { sync, getLogistiqueProvider: vi.fn(() => ({ sync })) };
});
vi.mock('@savr/adapters/src/index.js', () => ({ getLogistiqueProvider }));

function appel(): Request {
  return new Request('http://localhost/api/cron/polling-mts1', {
    method: 'POST',
    headers: { authorization: 'Bearer secret-de-test' },
  });
}

describe('M1.5b / cron polling-mts1 — fenêtre et relèves', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-13T23:30:00.000Z'));
    process.env['CRON_SECRET'] = 'secret-de-test';
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env['CRON_SECRET'];
  });

  it('M1.5b/releve_fenetre_trois_jours — la relève demande de maintenant − 3 jours à maintenant + 48 h', async () => {
    const { POST } = await import('@/app/api/cron/polling-mts1/route.js');
    const res = await POST(appel());
    expect(res.status).toBe(200);

    expect(sync).toHaveBeenCalled();
    expect(sync.mock.calls[0]![0]).toEqual({
      depuis: new Date('2026-10-10T23:30:00.000Z'),
      jusqu_a: new Date('2026-10-15T23:30:00.000Z'),
    });
  });

  it('M1.5b/releve_une_fois_par_compte — une relève par type de prestataire, pas une par transporteur', async () => {
    const { POST } = await import('@/app/api/cron/polling-mts1/route.js');
    const res = await POST(appel());
    expect(res.status).toBe(200);

    // Deux transporteurs MTS-1 partagent UN compte : une seule relève pour eux.
    expect(
      getLogistiqueProvider.mock.calls.map(
        (c) => (c as unknown as [{ type_tms: string }])[0].type_tms,
      ),
    ).toEqual(['mts1', 'a_toutes']);
    expect(sync).toHaveBeenCalledTimes(2);
  });
});
