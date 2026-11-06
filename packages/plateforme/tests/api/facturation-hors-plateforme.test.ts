/**
 * Facturation hors plateforme au go-live (décision Val 2026-10-22), côté serveur.
 *
 * L'interrupteur `facturationPlateformeActive()` est éteint : l'email récapitulatif
 * de programmation ne donne plus le tarif ZD, et le traitement de nuit ne prépare
 * aucun brouillon de facture. Chaque cas « éteint » lit la vraie valeur de
 * l'interrupteur ; son pendant « allumé » force la valeur, pour prouver que c'est
 * bien l'interrupteur qui décide (et non un cas qui passerait de toute façon).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  setEmailCaptureSink,
  type CapturedEmail,
} from '@savr/shared/src/email/index.js';

const interrupteur = vi.hoisted(() => ({ force: null as boolean | null }));
vi.mock('@/lib/facturation-plateforme.js', async (importOriginal) => {
  const reel =
    await importOriginal<typeof import('@/lib/facturation-plateforme.js')>();
  return {
    facturationPlateformeActive: () =>
      interrupteur.force ?? reel.facturationPlateformeActive(),
  };
});

const tarif = vi.hoisted(() => ({
  calculer: vi.fn(async () => ({ montant_ht: 412, montant_brut_ht: 412 })),
}));
vi.mock('@/lib/tarif-zd.js', () => ({ calculer_tarif_zd: tarif.calculer }));

const batch = vi.hoisted(() => ({
  run: vi.fn(async () => ({
    zd_par_collecte: 1,
    zd_mensuel: 0,
    ag_par_collecte: 0,
    errors: [],
  })),
}));
vi.mock('@/lib/facturation/batch-brouillons.js', () => ({
  runBatchBrouillonsJ1: batch.run,
}));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => ({}),
}));

import { envoyerRecapProgrammation } from '@/lib/programmation/recap-email.js';
import { GET } from '../../src/app/api/cron/batch-brouillons-j1/route.js';

// Le récapitulatif lit le programmeur (`users`), puis relit les collectes de
// l'événement (une ligne par collecte, refonte du formulaire, lot B2).
const COLLECTES_EVT = [
  {
    id: 'col-zd-1',
    type: 'zero_dechet',
    date_collecte: '2030-01-15',
    heure_collecte: '19:00:00',
    pax: 650,
    created_at: '2030-01-01T10:00:00Z',
  },
];
const supabase = {
  from: (table: string) => ({
    select: () => ({
      eq: () =>
        table === 'users'
          ? {
              maybeSingle: async () => ({
                data: { email: 'julie@traiteur.local', prenom: 'Julie' },
                error: null,
              }),
            }
          : Promise.resolve({ data: COLLECTES_EVT, error: null }),
    }),
  }),
} as unknown as Parameters<typeof envoyerRecapProgrammation>[0];

const PROGRAMMATION_ZD = {
  programmeurUserId: 'user-1',
  evenementId: 'evt-1',
  nomEvenement: 'Gala',
  organisationId: 'org-1',
  lieuId: 'lieu-1',
  collecteIds: ['col-zd-1'],
};

function appelCron(authorization?: string): Promise<Response> {
  return GET(
    new Request('http://localhost/api/cron/batch-brouillons-j1', {
      method: 'GET',
      headers: authorization ? { authorization } : {},
    }),
  );
}

let emails: CapturedEmail[] = [];
beforeEach(() => {
  interrupteur.force = null;
  emails = [];
  tarif.calculer.mockClear();
  batch.run.mockClear();
  setEmailCaptureSink((e) => emails.push(e));
  process.env['CRON_SECRET'] = 'test-secret';
});
afterEach(() => {
  setEmailCaptureSink(null);
  delete process.env['CRON_SECRET'];
});

describe('facturation_hors_plateforme — interrupteur', () => {
  it('est éteint au go-live (le rallumer est une décision de Val)', async () => {
    const reel = await vi.importActual<
      typeof import('@/lib/facturation-plateforme.js')
    >('@/lib/facturation-plateforme.js');
    expect(reel.facturationPlateformeActive()).toBe(false);
  });
});

describe('facturation_hors_plateforme — email récapitulatif de programmation', () => {
  it('éteint : aucune ligne de tarif, aucun calcul de tarif', async () => {
    await envoyerRecapProgrammation(supabase, PROGRAMMATION_ZD);

    expect(tarif.calculer).not.toHaveBeenCalled();
    expect(emails).toHaveLength(1);
    expect(emails[0]!.variables.tarif_ligne).toBe('');
    // L'email part toujours, avec le reste de son contenu.
    expect(emails[0]!.variables.nom_evenement).toBe('Gala');
  });

  it('allumé : la ligne de tarif ZD revient', async () => {
    interrupteur.force = true;
    await envoyerRecapProgrammation(supabase, PROGRAMMATION_ZD);

    expect(tarif.calculer).toHaveBeenCalledTimes(1);
    // Sur le pax de la collecte Zéro Déchet relue en base.
    expect(tarif.calculer).toHaveBeenCalledWith(
      650,
      'org-1',
      expect.any(Date),
      supabase,
      'lieu-1',
    );
    expect(emails[0]!.variables.tarif_ligne).toBe(
      'Tarif Zéro Déchet applicable : 412.00 € HT.',
    );
  });
});

describe('facturation_hors_plateforme — traitement de nuit des brouillons', () => {
  it('éteint : répond sans préparer aucun brouillon', async () => {
    const res = await appelCron('Bearer test-secret');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      desactive: true,
      nb_traite: 0,
    });
    expect(batch.run).not.toHaveBeenCalled();
  });

  it('éteint : un appel sans le secret du cron reste refusé', async () => {
    const res = await appelCron();

    expect(res.status).toBe(401);
    expect(batch.run).not.toHaveBeenCalled();
  });

  it('allumé : le traitement prépare de nouveau les brouillons', async () => {
    interrupteur.force = true;
    const res = await appelCron('Bearer test-secret');

    expect(res.status).toBe(200);
    expect(batch.run).toHaveBeenCalledTimes(1);
    expect(await res.json()).toMatchObject({ ok: true, nb_traite: 1 });
  });
});
