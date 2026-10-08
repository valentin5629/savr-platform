/**
 * M0.6 — POST /api/v1/admin/collectes/[id]/infos-acces/renvoi : renvoi, à la
 * demande de l'équipe Savr, de l'email « infos d'accès chauffeur » (décision Val
 * 2026-10-08, C2).
 *
 * Vérifie : garde staff, refus hors périmètre (collecte inconnue, sans contrôle
 * d'accès, terminée), refus pendant une reprise automatique (deux emails
 * partiraient), retrait du claim précédent seulement s'il n'a pas bougé, et
 * issue de l'envoi rendue telle quelle.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import {
  creerBaseEnMemoire,
  type BaseEnMemoire,
  type Ligne,
} from '@/test-utils/base-en-memoire';

const h = vi.hoisted(() => ({ client: null as unknown }));
const mockRequireStaff = vi.fn();
const mockEvaluer = vi.fn();

vi.mock('@/lib/api-auth.js', () => ({
  requireStaff: (...a: unknown[]) => mockRequireStaff(...a),
}));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => h.client,
}));
vi.mock('@/lib/infos-acces/notify.js', () => ({
  evaluerInfosAccesEtEnvoyer: (...a: unknown[]) => mockEvaluer(...a),
}));

import { POST } from '@/app/api/v1/admin/collectes/[id]/infos-acces/renvoi/route';

const TAMPON = '2026-10-08T07:00:00.000Z';
const COLLECTE_ID = 'c0111111-0000-4000-8000-000000000001';

const collecte = (surcharge: Ligne = {}): Ligne => ({
  id: COLLECTE_ID,
  statut: 'validee',
  controle_acces_requis: true,
  infos_acces_email_envoye_at: TAMPON,
  ...surcharge,
});

const email = (surcharge: Ligne = {}): Ligne => ({
  id: 'em-1',
  template_code: 'infos_acces_collecte',
  entity_type: 'collecte',
  entity_id: COLLECTE_ID,
  statut: 'sent',
  tentative_numero: 1,
  created_at: '2026-10-08T07:00:01.000Z',
  envoye_at: '2026-10-08T07:00:02.000Z',
  ...surcharge,
});

let b: BaseEnMemoire;

function installer(collectes: Ligne[], emails: Ligne[] = []): void {
  b = creerBaseEnMemoire({ collectes, emails_envoyes: emails });
  h.client = b.client;
}

const tampon = () => b.tables['collectes']![0]!['infos_acces_email_envoye_at'];

async function renvoyer(id: string = COLLECTE_ID): Promise<Response> {
  return POST(
    new NextRequest(
      `http://localhost/api/v1/admin/collectes/${id}/infos-acces/renvoi`,
      { method: 'POST' },
    ),
    { params: Promise.resolve({ id }) },
  );
}

beforeEach(() => {
  mockRequireStaff.mockReset();
  mockEvaluer.mockReset();
  mockRequireStaff.mockResolvedValue({
    ctx: { userId: 'u-1', role: 'ops_savr' },
  });
  mockEvaluer.mockResolvedValue({ envoye: true, issue: 'envoye' });
});

describe('M0.6 / POST infos-acces/renvoi — gardes', () => {
  it('non-staff → refus d’auth, rien n’est touché', async () => {
    installer([collecte()], [email()]);
    mockRequireStaff.mockResolvedValue({
      error: new Response('nope', { status: 403 }),
    });

    const res = await renvoyer();

    expect(res.status).toBe(403);
    expect(mockEvaluer).not.toHaveBeenCalled();
    expect(tampon()).toBe(TAMPON);
  });

  it('identifiant mal formé → 404, sans interroger la base', async () => {
    installer([collecte()], [email()]);
    // Une lecture ferait échouer la route en 500 : elle n'a pas lieu.
    b.pannes['collectes.select'] = { code: '22P02', message: 'uuid invalide' };

    const res = await renvoyer('pas-un-uuid');

    expect(res.status).toBe(404);
    expect(mockEvaluer).not.toHaveBeenCalled();
  });

  it('collecte introuvable → 404', async () => {
    installer([collecte({ id: 'autre' })]);
    const res = await renvoyer();
    expect(res.status).toBe(404);
    expect(mockEvaluer).not.toHaveBeenCalled();
  });

  it('collecte sans contrôle d’accès → 422, aucun envoi', async () => {
    installer([collecte({ controle_acces_requis: false })]);
    const res = await renvoyer();
    expect(res.status).toBe(422);
    expect(mockEvaluer).not.toHaveBeenCalled();
    expect(tampon()).toBe(TAMPON);
  });

  it.each(['realisee', 'cloturee', 'annulee', 'realisee_sans_collecte'])(
    'collecte %s → 422 : l’email ne se renvoie plus',
    async (statut) => {
      installer([collecte({ statut })], [email()]);
      const res = await renvoyer();
      expect(res.status).toBe(422);
      expect(mockEvaluer).not.toHaveBeenCalled();
      expect(tampon()).toBe(TAMPON);
    },
  );

  it.each([1, 2, 3])(
    'reprise automatique en cours (tentative %i en échec) → 409, claim intact, aucun envoi : deux emails partiraient',
    async (tentative) => {
      installer(
        [collecte()],
        [
          email({
            statut: 'failed',
            tentative_numero: tentative,
            envoye_at: null,
          }),
        ],
      );

      const res = await renvoyer();

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        error:
          'Une nouvelle tentative d’envoi est déjà en cours pour cet email.',
      });
      expect(mockEvaluer).not.toHaveBeenCalled();
      expect(tampon()).toBe(TAMPON);
    },
  );
});

describe('M0.6 / POST infos-acces/renvoi — envoi', () => {
  it('email déjà envoyé (coordonnées changées depuis) → claim retiré puis nouvel envoi', async () => {
    installer([collecte()], [email()]);
    // Le claim doit être libre AU MOMENT où l'envoi est évalué.
    let tamponALEvaluation: unknown = 'non évalué';
    mockEvaluer.mockImplementation(async () => {
      tamponALEvaluation = tampon();
      return { envoye: true, issue: 'envoye' };
    });

    const res = await renvoyer();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: 'envoye' });
    expect(tamponALEvaluation).toBeNull();
    expect(mockEvaluer).toHaveBeenCalledTimes(1);
    expect(mockEvaluer).toHaveBeenCalledWith(expect.anything(), COLLECTE_ID);
  });

  it('email non remis (4 tentatives épuisées, claim déjà retiré) → nouvel envoi', async () => {
    installer(
      [collecte({ infos_acces_email_envoye_at: null })],
      [email({ statut: 'failed', tentative_numero: 4, envoye_at: null })],
    );

    const res = await renvoyer();

    expect(res.status).toBe(200);
    expect(mockEvaluer).toHaveBeenCalledTimes(1);
  });

  it('email non remis mais claim resté posé (retrait manqué) → claim retiré puis nouvel envoi', async () => {
    installer(
      [collecte()],
      [email({ statut: 'bounced', tentative_numero: 1 })],
    );
    let tamponALEvaluation: unknown = 'non évalué';
    mockEvaluer.mockImplementation(async () => {
      tamponALEvaluation = tampon();
      return { envoye: true, issue: 'envoye' };
    });

    const res = await renvoyer();

    expect(res.status).toBe(200);
    expect(tamponALEvaluation).toBeNull();
  });

  it('deux renvois en même temps : le claim a bougé depuis la lecture → 409, pas de second envoi', async () => {
    installer([collecte()], [email()]);
    // Entre la lecture de la collecte et le retrait du claim, un autre renvoi
    // a déjà reposé un claim (nouvelle valeur).
    const client = b.client as {
      from: (t: string) => Record<string, (...a: unknown[]) => unknown>;
    };
    const fromOriginal = client.from.bind(client);
    client.from = (table: string) => {
      const requetes = fromOriginal(table);
      if (table !== 'collectes') return requetes;
      const updateOriginal = requetes['update']!;
      return {
        ...requetes,
        update: (...args: unknown[]) => {
          b.tables['collectes']![0]!['infos_acces_email_envoye_at'] =
            '2026-10-08T09:30:00.000Z';
          return updateOriginal(...args);
        },
      };
    };

    const res = await renvoyer();

    expect(res.status).toBe(409);
    expect(mockEvaluer).not.toHaveBeenCalled();
    // Le claim de l'autre renvoi n'a pas été effacé.
    expect(tampon()).toBe('2026-10-08T09:30:00.000Z');
  });

  it.each(['envoye', 'en_reprise', 'non_envoye', 'sans_objet'])(
    'issue de l’envoi « %s » → rendue telle quelle (200)',
    async (issue) => {
      installer([collecte({ infos_acces_email_envoye_at: null })]);
      mockEvaluer.mockResolvedValue({ envoye: issue === 'envoye', issue });

      const res = await renvoyer();

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ email: issue });
    },
  );
});

describe('M0.6 / POST infos-acces/renvoi — erreurs base', () => {
  it.each([
    ['collectes.select', 'lecture de la collecte'],
    ['emails_envoyes.select', 'lecture du journal des emails'],
    ['collectes.update', 'retrait du claim'],
  ])('%s en échec (%s) → 500 générique, aucun envoi', async (cle) => {
    installer([collecte()], [email()]);
    b.pannes[cle] = { code: '08006', message: 'connexion perdue' };

    const res = await renvoyer();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Erreur serveur' });
    expect(mockEvaluer).not.toHaveBeenCalled();
  });
});
