/**
 * M0.6 — « Renvoyer l'email » des infos d'accès chauffeur, de bout en bout :
 * la VRAIE route `POST …/infos-acces/renvoi`, le VRAI `evaluerInfosAccesEtEnvoyer`,
 * le VRAI `sendEmail` et son transport. Seuls le SDK Resend, l'authentification
 * et la base (en mémoire) sont simulés.
 *
 * Le fichier voisin `infos-acces-renvoi.m0-6.test.ts` isole les gardes de la
 * route en simulant l'envoi : il ne prouve pas que la route et l'envoi, mis
 * bout à bout, font partir exactement un email et laissent la fiche dans le bon
 * état (décision Val 2026-10-08, C2).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => {
  const mockSend = vi.fn();
  const ResendCtor = vi.fn(() => ({ emails: { send: mockSend } }));
  return { mockSend, ResendCtor, client: null as unknown };
});

vi.mock('resend', () => ({ Resend: h.ResendCtor }));
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => h.client,
}));
vi.mock('@/lib/api-auth.js', () => ({
  requireStaff: async () => ({ ctx: { userId: 'u-1', role: 'ops_savr' } }),
}));

import { logger } from '@savr/shared/src/logger/index.js';
import {
  _setOutboundThrottleEnabled,
  _resetOutboundThrottle,
} from '@savr/shared/src/rate-limit/outbound-throttle.js';
import { POST } from '@/app/api/v1/admin/collectes/[id]/infos-acces/renvoi/route';
import { CODE_ALERTE_INFOS_ACCES_NON_REMISES } from '@/lib/emails/codes-alertes.js';
import {
  deriverSuiviEmail,
  lireDernierEmailInfosAcces,
} from '@/lib/infos-acces/suivi-email.js';
import {
  creerBaseEnMemoire,
  type BaseEnMemoire,
  type Ligne,
} from '@/test-utils/base-en-memoire';

const COLLECTE_ID = 'c0111111-0000-4000-8000-000000000001';
const DESTINATAIRE = 'prog@infos-acces.local';
const T0 = Date.parse('2026-09-01T08:00:00Z');
const H = 60 * 60 * 1000;
const ANCIEN_TAMPON = new Date(T0).toISOString();

const emailPrecedent = (surcharge: Ligne): Ligne => ({
  id: 'em-precedent',
  template_code: 'infos_acces_collecte',
  destinataire: DESTINATAIRE,
  entity_type: 'collecte',
  entity_id: COLLECTE_ID,
  variables_jsonb: {},
  created_at: new Date(T0).toISOString(),
  envoye_at: null,
  ...surcharge,
});

let b: BaseEnMemoire;
// Coordonnées « actuelles » rendues par la RPC de marquage au moment du renvoi.
let chauffeur = { nom: 'Jean Dupont', telephone: '0611111111' };

function installer(tampon: string | null, emails: Ligne[]): void {
  b = creerBaseEnMemoire({
    email_templates: [
      {
        code: 'infos_acces_collecte',
        sujet: "Informations d'accès pour votre collecte du {{date_collecte}}",
        corps_html: '<p>Bonjour,</p>{{chauffeurs_bloc}}',
        actif: true,
        variables: ['date_collecte', 'heure_collecte', 'chauffeurs_bloc'],
      },
    ],
    collectes: [
      {
        id: COLLECTE_ID,
        statut: 'validee',
        controle_acces_requis: true,
        infos_acces_email_envoye_at: tampon,
      },
    ],
    emails_envoyes: emails,
    alertes_admin: [
      {
        id: 'a-1',
        code: CODE_ALERTE_INFOS_ACCES_NON_REMISES,
        entity_type: 'collecte',
        entity_id: COLLECTE_ID,
        statut: 'ouverte',
        resolue_at: null,
      },
    ],
    integrations_logs: [],
  });
  // Même contrat que `fn_infos_acces_marquer_si_complet` (prouvée en pgTAP) :
  // rien si le claim est posé, sinon claim + coordonnées du moment.
  b.rpcs['fn_infos_acces_marquer_si_complet'] = (args) => {
    const c = b.tables['collectes']!.find(
      (l) => l['id'] === args['p_collecte_id'],
    )!;
    if (c['infos_acces_email_envoye_at']) return null;
    c['infos_acces_email_envoye_at'] = new Date(Date.now()).toISOString();
    return {
      to: DESTINATAIRE,
      prenom: 'Prog',
      date_collecte: '2026-09-10',
      heure_collecte: '08:00:00',
      chauffeurs: [
        {
          rang: 1,
          chauffeur_nom: chauffeur.nom,
          chauffeur_telephone: chauffeur.telephone,
          plaque: null,
          accompagnant_nom: null,
          accompagnant_telephone: null,
        },
      ],
    };
  };
  h.client = b.client;
}

const tampon = () => b.tables['collectes']![0]!['infos_acces_email_envoye_at'];
const emails = () => b.tables['emails_envoyes']!;
const alerte = () => b.tables['alertes_admin']![0]!['statut'];

async function etatAffiche() {
  const dernier = await lireDernierEmailInfosAcces(
    b.client as Parameters<typeof lireDernierEmailInfosAcces>[0],
    COLLECTE_ID,
  );
  return deriverSuiviEmail(dernier.data, tampon() as string | null).etat;
}

async function renvoyer(): Promise<{ status: number; corps: unknown }> {
  const res = await POST(
    new NextRequest(
      `http://localhost/api/v1/admin/collectes/${COLLECTE_ID}/infos-acces/renvoi`,
      { method: 'POST' },
    ),
    { params: Promise.resolve({ id: COLLECTE_ID }) },
  );
  return { status: res.status, corps: await res.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  // Le renvoi a lieu une heure après l'envoi précédent.
  vi.setSystemTime(T0 + H);
  h.mockSend.mockResolvedValue({ data: { id: 'rs_renvoi' }, error: null });
  chauffeur = { nom: 'Jean Dupont', telephone: '0611111111' };
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('RESEND_API_KEY', 're_cle_de_test');
  vi.stubEnv('RESEND_FROM', 'Savr <notifications@envoi.savr-test.local>');
  vi.stubEnv('EMAIL_REDIRECT_TO', undefined);
  _setOutboundThrottleEnabled(false);
  vi.spyOn(logger, 'error').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'info').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  _resetOutboundThrottle();
});

describe('M0.6 / renvoi de l’email « infos d’accès » — route et envoi bout à bout', () => {
  it('email non remis (4 tentatives épuisées) → un email part, la fiche passe à « envoyé », l’alerte est close', async () => {
    installer(null, [
      emailPrecedent({ statut: 'failed', tentative_numero: 4 }),
    ]);

    const res = await renvoyer();

    expect(res).toEqual({ status: 200, corps: { email: 'envoye' } });
    expect(h.mockSend).toHaveBeenCalledTimes(1);
    expect(h.mockSend.mock.calls[0]![0]).toMatchObject({ to: DESTINATAIRE });
    expect(emails().map((e) => e['statut'])).toEqual(['failed', 'sent']);
    expect(tampon()).toBe(new Date(T0 + H).toISOString());
    expect(alerte()).toBe('resolue');
    expect(await etatAffiche()).toBe('envoye');
  });

  it('email déjà envoyé, chauffeur changé depuis → un second email part avec les coordonnées ACTUELLES', async () => {
    installer(ANCIEN_TAMPON, [
      emailPrecedent({
        statut: 'sent',
        tentative_numero: 1,
        envoye_at: ANCIEN_TAMPON,
      }),
    ]);
    chauffeur = { nom: 'Marie Martin', telephone: '0622222222' };

    const res = await renvoyer();

    expect(res).toEqual({ status: 200, corps: { email: 'envoye' } });
    expect(h.mockSend).toHaveBeenCalledTimes(1);
    const html = (h.mockSend.mock.calls[0]![0] as { html: string }).html;
    expect(html).toContain('Marie Martin — 0622222222');
    expect(html).not.toContain('Jean Dupont');
    expect(emails().map((e) => e['statut'])).toEqual(['sent', 'sent']);
    // Nouveau claim, daté du renvoi.
    expect(tampon()).toBe(new Date(T0 + H).toISOString());
  });

  it('reprise automatique en cours → 409 : aucun email, aucune ligne, claim intact', async () => {
    installer(ANCIEN_TAMPON, [
      emailPrecedent({ statut: 'failed', tentative_numero: 2 }),
    ]);

    const res = await renvoyer();

    expect(res.status).toBe(409);
    expect(h.mockSend).not.toHaveBeenCalled();
    expect(emails()).toHaveLength(1);
    expect(tampon()).toBe(ANCIEN_TAMPON);
    expect(alerte()).toBe('ouverte');
  });

  it('Resend refuse le renvoi → « en_reprise » : claim conservé pour le worker, la fiche ne dit pas « envoyé », l’alerte reste ouverte', async () => {
    installer(null, [
      emailPrecedent({ statut: 'failed', tentative_numero: 4 }),
    ]);
    h.mockSend.mockResolvedValue({
      data: null,
      error: { name: 'application_error', message: '503 upstream' },
    });

    const res = await renvoyer();

    expect(res).toEqual({ status: 200, corps: { email: 'en_reprise' } });
    expect(emails().map((e) => [e['statut'], e['tentative_numero']])).toEqual([
      ['failed', 4],
      ['failed', 1],
    ]);
    expect(tampon()).toBe(new Date(T0 + H).toISOString());
    expect(alerte()).toBe('ouverte');
    expect(await etatAffiche()).toBe('en_reprise');
  });

  it('claim posé sans aucune ligne d’envoi (envoi interrompu) → la fiche dit « à envoyer » et le renvoi fait partir l’email', async () => {
    installer(ANCIEN_TAMPON, []);
    expect(await etatAffiche()).toBe('a_envoyer');

    const res = await renvoyer();

    expect(res).toEqual({ status: 200, corps: { email: 'envoye' } });
    expect(h.mockSend).toHaveBeenCalledTimes(1);
    expect(emails().map((e) => e['statut'])).toEqual(['sent']);
    expect(await etatAffiche()).toBe('envoye');
  });
});
