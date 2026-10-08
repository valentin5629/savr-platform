/**
 * M0.6 — GET /api/v1/admin/collectes/[id] : état réel de l'email « infos d'accès
 * chauffeur » (décision Val 2026-10-08, C3).
 *
 * La fiche affichait « Email envoyé au programmateur » dès que le tampon
 * `collectes.infos_acces_email_envoye_at` était posé — or il l'est AVANT
 * l'envoi. La route sert désormais `infos_acces_email`, lu dans le journal des
 * emails (`emails_envoyes`), sans en sortir ni l'adresse ni le message d'erreur.
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

vi.mock('@/lib/api-auth.js', () => ({
  requireStaff: (...a: unknown[]) => mockRequireStaff(...a),
}));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => h.client,
}));
vi.mock('@savr/shared/src/email/index.js', () => ({ sendEmail: vi.fn() }));

import { GET } from '@/app/api/v1/admin/collectes/[id]/route';

const TAMPON = '2026-10-08T07:00:00.000Z';
const ADRESSE = 'prog@infos-acces.local';
const ERREUR_RESEND = `Invalid recipient ${ADRESSE}`;

const collecte = (surcharge: Ligne = {}): Ligne => ({
  id: 'coll-1',
  statut: 'validee',
  controle_acces_requis: true,
  infos_acces_email_envoye_at: TAMPON,
  prestataire_logistique_id: null,
  ...surcharge,
});

const email = (surcharge: Ligne = {}): Ligne => ({
  id: 'em-1',
  template_code: 'infos_acces_collecte',
  entity_type: 'collecte',
  entity_id: 'coll-1',
  destinataire: ADRESSE,
  erreur: ERREUR_RESEND,
  statut: 'failed',
  tentative_numero: 2,
  created_at: '2026-10-08T07:00:01.000Z',
  envoye_at: null,
  ...surcharge,
});

let b: BaseEnMemoire;

function installer(collectes: Ligne[], emails: Ligne[]): void {
  b = creerBaseEnMemoire({ collectes, emails_envoyes: emails });
  h.client = b.client;
}

async function lire(): Promise<Response> {
  return GET(
    new NextRequest('http://localhost/api/v1/admin/collectes/coll-1'),
    {
      params: Promise.resolve({ id: 'coll-1' }),
    },
  );
}

async function etat(): Promise<unknown> {
  const res = await lire();
  expect(res.status).toBe(200);
  return ((await res.json()) as { infos_acces_email: unknown })
    .infos_acces_email;
}

beforeEach(() => {
  mockRequireStaff.mockReset();
  mockRequireStaff.mockResolvedValue({
    ctx: { userId: 'u-1', role: 'ops_savr' },
  });
});

describe('M0.6 — GET admin/collectes/[id] : infos_acces_email', () => {
  it('tampon posé mais email en reprise → « en_reprise », pas « envoyé »', async () => {
    installer([collecte()], [email()]);
    expect(await etat()).toEqual({
      etat: 'en_reprise',
      date: '2026-10-08T07:00:01.000Z',
      tentative: 2,
      motif: null,
    });
  });

  it('tampon ENCORE posé mais 4 tentatives épuisées → « non_remis »', async () => {
    installer([collecte()], [email({ tentative_numero: 4 })]);
    expect(await etat()).toMatchObject({
      etat: 'non_remis',
      motif: 'tentatives_epuisees',
    });
  });

  it('email refusé par la messagerie du programmateur → « non_remis », adresse refusée', async () => {
    installer(
      [collecte({ infos_acces_email_envoye_at: null })],
      [email({ statut: 'bounced', tentative_numero: 1 })],
    );
    expect(await etat()).toMatchObject({
      etat: 'non_remis',
      motif: 'adresse_refusee',
    });
  });

  it('email parti → « envoye », à la date réelle de l’envoi', async () => {
    installer(
      [collecte()],
      [
        email({
          statut: 'sent',
          tentative_numero: 3,
          envoye_at: '2026-10-08T08:05:00.000Z',
        }),
      ],
    );
    expect(await etat()).toEqual({
      etat: 'envoye',
      date: '2026-10-08T08:05:00.000Z',
      tentative: 3,
      motif: null,
    });
  });

  it('plusieurs envois : le plus récent fait foi (renvoi réussi après un échec)', async () => {
    installer(
      [collecte()],
      [
        email({ id: 'em-ancien', tentative_numero: 4 }),
        email({
          id: 'em-recent',
          statut: 'sent',
          tentative_numero: 1,
          created_at: '2026-10-09T09:00:00.000Z',
          envoye_at: '2026-10-09T09:00:01.000Z',
        }),
      ],
    );
    expect(await etat()).toMatchObject({ etat: 'envoye', tentative: 1 });
  });

  it('seuls les emails « infos d’accès » de CETTE collecte comptent', async () => {
    installer(
      [collecte({ infos_acces_email_envoye_at: null })],
      [
        // Autre template, même collecte, plus récent.
        email({
          id: 'em-autre-template',
          template_code: 'collecte_programmee',
          statut: 'sent',
          created_at: '2026-10-09T09:00:00.000Z',
        }),
        // Même template, autre collecte.
        email({ id: 'em-autre-collecte', entity_id: 'coll-2' }),
        // Même template, même id mais autre type d'entité.
        email({ id: 'em-autre-type', entity_type: 'evenement' }),
      ],
    );
    expect(await etat()).toEqual({
      etat: 'a_envoyer',
      date: null,
      tentative: null,
      motif: null,
    });
  });

  it('tampon posé mais aucun envoi tracé (envoi interrompu avant d’être écrit) → « a_envoyer » : jamais « envoyé » sans trace', async () => {
    installer([collecte()], []);
    expect(await etat()).toEqual({
      etat: 'a_envoyer',
      date: null,
      tentative: null,
      motif: null,
    });
  });

  it('collecte sans contrôle d’accès → null, et le journal des emails n’est pas lu', async () => {
    installer([collecte({ controle_acces_requis: false })], [email()]);
    // Une lecture ferait échouer la route : elle n'a pas lieu.
    b.pannes['emails_envoyes.select'] = { code: '57014', message: 'timeout' };
    expect(await etat()).toBeNull();
  });

  it('ni l’adresse du programmateur ni le message d’erreur de Resend ne sortent (fiche servie aussi à ops_savr)', async () => {
    installer([collecte()], [email()]);
    const res = await lire();
    const corps = JSON.stringify(await res.json());
    expect(corps).not.toContain(ADRESSE);
    expect(corps).not.toContain('Invalid recipient');
  });

  it('journal des emails illisible → 500 générique', async () => {
    installer([collecte()], [email()]);
    b.pannes['emails_envoyes.select'] = { code: '57014', message: 'timeout' };
    const res = await lire();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Erreur serveur' });
  });

  it('non-staff → refus d’auth, aucune lecture', async () => {
    installer([collecte()], [email()]);
    mockRequireStaff.mockResolvedValue({
      error: new Response('nope', { status: 403 }),
    });
    const res = await lire();
    expect(res.status).toBe(403);
  });
});
