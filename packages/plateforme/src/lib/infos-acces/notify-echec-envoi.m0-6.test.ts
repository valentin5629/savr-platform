/**
 * Infos d'accès chauffeur — ce qui se passe quand l'email ne peut pas partir.
 *
 * Bout en bout : le VRAI `sendEmail`, le VRAI transport et le VRAI worker de retry
 * (`@savr/shared/src/email`). Seuls le SDK Resend et la base sont simulés. Le fichier
 * voisin (`notify.m0-6.test.ts`) passe par le puits de capture, qui court-circuite
 * tout ce chemin : il ne peut pas voir ces cas.
 *
 * Depuis l'arbitrage C5 (Val, 2026-10-07), une configuration email absente n'est
 * plus une exception mais un envoi noté en échec, repris par le worker. Le tampon
 * `infos_acces_email_envoye_at` — posé AVANT l'envoi par la RPC — n'est donc plus
 * relâché dans ce cas : c'est le worker qui porte la suite.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => {
  const mockSend = vi.fn();
  const ResendCtor = vi.fn(() => ({ emails: { send: mockSend } }));
  const etat = { base: null as unknown };
  return { mockSend, ResendCtor, etat };
});

vi.mock('resend', () => ({ Resend: h.ResendCtor }));
// `sendEmail` crée son propre client admin : il reçoit la même fausse base que
// celle passée à `evaluerInfosAccesEtEnvoyer`.
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => h.etat.base,
}));

import { runEmailRetryWorker } from '@savr/shared/src/email/index.js';
import { logger } from '@savr/shared/src/logger/index.js';
import {
  _setOutboundThrottleEnabled,
  _resetOutboundThrottle,
} from '@savr/shared/src/rate-limit/outbound-throttle.js';
import { evaluerInfosAccesEtEnvoyer } from './notify.js';

type Ligne = Record<string, unknown>;

// Template tel que seedé par la migration 20260715120000 (catalogue §06.02).
const TEMPLATE = {
  code: 'infos_acces_collecte',
  sujet: "Informations d'accès pour votre collecte du {{date_collecte}}",
  corps_html:
    '<p>Bonjour{{#if prenom}} {{prenom}}{{/if}},</p>' +
    '<p>Voici les informations du ou des chauffeur(s) qui interviendront pour votre ' +
    'collecte{{#if evenement_nom}} « {{evenement_nom}} »{{/if}} prévue le ' +
    '<strong>{{date_collecte}}</strong> à <strong>{{heure_collecte}}</strong>' +
    '{{#if lieu_nom}}, {{lieu_nom}}{{/if}}' +
    '{{#if lieu_adresse}} ({{lieu_adresse}}){{/if}}.</p>' +
    "<p>Merci de les transmettre au service de contrôle d'accès du site.</p>" +
    '{{chauffeurs_bloc}}' +
    '<p>Si ces informations changent, nous vous en tiendrons informé.</p>' +
    "<p>L'équipe Savr</p>",
  actif: true,
  variables: ['date_collecte', 'heure_collecte', 'chauffeurs_bloc'],
};

const PAYLOAD_COMPLET = {
  to: 'prog@infos-acces.local',
  prenom: 'Prog',
  evenement_nom: 'Gala',
  date_collecte: '2026-09-10',
  heure_collecte: '08:00:00',
  lieu_nom: 'Salle Accès',
  lieu_adresse: '9 rue Test',
  chauffeurs: [
    {
      rang: 1,
      chauffeur_nom: 'Jean Dupont',
      chauffeur_telephone: '0611111111',
      plaque: '12ABC23',
      accompagnant_nom: null,
      accompagnant_telephone: null,
    },
    {
      rang: 2,
      chauffeur_nom: 'Marie Martin',
      chauffeur_telephone: '0622222222',
      plaque: '34XYZ56',
      accompagnant_nom: 'Luc Bernard',
      accompagnant_telephone: '0633333333',
    },
  ],
};

const T0 = Date.parse('2026-09-01T08:00:00Z');
const MIN = 60 * 1000;
const H = 60 * MIN;

// Fausse base : juste ce que lisent et écrivent la RPC de marquage, `sendEmail`
// et le worker. Les lignes `emails_envoyes` vivent en mémoire, pour que le worker
// relise ce que `sendEmail` a écrit.
function creerBase() {
  const emails: Ligne[] = [];
  const journal: Ligne[] = [];
  const majCollectes: Ligne[] = [];

  const base = {
    rpc: async () => ({ data: PAYLOAD_COMPLET, error: null }),
    from: (table: string) => {
      if (table === 'email_templates') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: TEMPLATE, error: null }),
            }),
          }),
        };
      }
      if (table === 'collectes') {
        return {
          update: (v: Ligne) => {
            majCollectes.push(v);
            return { eq: async () => ({ error: null }) };
          },
        };
      }
      if (table === 'integrations_logs') {
        return {
          insert: async (v: Ligne) => {
            journal.push(v);
            return { error: null };
          },
        };
      }
      // emails_envoyes
      return {
        insert: async (v: Ligne) => {
          emails.push({
            id: `em-${emails.length + 1}`,
            created_at: new Date(T0).toISOString(),
            ...v,
          });
          return { error: null };
        },
        // Requête du worker : .select().eq('statut','failed').lt('tentative_numero', 4)
        select: () => ({
          eq: () => ({
            lt: async () => ({
              data: emails.filter(
                (e) =>
                  e['statut'] === 'failed' &&
                  (e['tentative_numero'] as number) < 4,
              ),
              error: null,
            }),
          }),
        }),
        update: (patch: Ligne) => ({
          eq: async (_col: string, id: string) => {
            Object.assign(emails.find((e) => e['id'] === id)!, patch);
            return { error: null };
          },
        }),
      };
    },
  };
  return { base, emails, journal, majCollectes };
}

type Base = ReturnType<typeof creerBase>;
const client = (b: Base) =>
  b.base as unknown as Parameters<typeof evaluerInfosAccesEtEnvoyer>[0];

let b: Base;

beforeEach(() => {
  vi.clearAllMocks();
  h.mockSend.mockResolvedValue({ data: { id: 'rs_acces' }, error: null });
  b = creerBase();
  h.etat.base = b.base;
  // Production, vraie clé, expéditeur ABSENT : le cas que C5 a changé.
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('RESEND_API_KEY', 're_cle_de_test');
  vi.stubEnv('RESEND_FROM', undefined);
  vi.stubEnv('EMAIL_REDIRECT_TO', undefined);
  _setOutboundThrottleEnabled(false);
  vi.spyOn(logger, 'error').mockImplementation(() => {});
  vi.spyOn(logger, 'info').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  _resetOutboundThrottle();
});

describe('M0.6 / infos accès — configuration email absente au moment de l’envoi', () => {
  it('aucune exception, tampon conservé, email noté en échec avec le récapitulatif complet', async () => {
    const res = await evaluerInfosAccesEtEnvoyer(client(b), 'coll-1');

    expect(res.envoye).toBe(true);
    expect(h.mockSend).not.toHaveBeenCalled();
    // Le tampon posé par la RPC n'est pas relâché : aucun retour à NULL.
    expect(b.majCollectes).toEqual([]);

    expect(b.emails).toHaveLength(1);
    expect(b.emails[0]).toMatchObject({
      template_code: 'infos_acces_collecte',
      destinataire: 'prog@infos-acces.local',
      statut: 'failed',
      resend_id: null,
      tentative_numero: 1,
      entity_type: 'collecte',
      entity_id: 'coll-1',
    });
    expect(String(b.emails[0]!['erreur'])).toContain('RESEND_FROM');
    // Le récapitulatif est figé dans la ligne : la reprise n'a pas besoin de la RPC.
    const variables = b.emails[0]!['variables_jsonb'] as Record<string, string>;
    expect(variables['chauffeurs_bloc']).toContain('Jean Dupont');
    expect(variables['chauffeurs_bloc']).toContain('0622222222');
  });

  it('variable posée ensuite → le worker envoie au programmateur le récapitulatif des deux camions', async () => {
    await evaluerInfosAccesEtEnvoyer(client(b), 'coll-1');
    vi.stubEnv('RESEND_FROM', 'Savr <notifications@envoi.savr-test.local>');

    const res = await runEmailRetryWorker(client(b), T0 + 6 * MIN);

    expect(res).toMatchObject({ retried: 1, succeeded: 1, exhausted: 0 });
    expect(h.mockSend).toHaveBeenCalledTimes(1);
    const envoye = h.mockSend.mock.calls[0]![0] as Record<string, string>;
    expect(envoye['from']).toBe('Savr <notifications@envoi.savr-test.local>');
    expect(envoye['to']).toBe('prog@infos-acces.local');
    expect(envoye['subject']).toBe(
      "Informations d'accès pour votre collecte du 10/09/2026",
    );
    for (const attendu of [
      'Bonjour Prog',
      '« Gala »',
      '<strong>08:00</strong>',
      'Camion 1',
      'Jean Dupont — 0611111111',
      'Plaque : 12ABC23',
      'Camion 2',
      'Marie Martin — 0622222222',
      'Accompagnant : Luc Bernard — 0633333333',
    ]) {
      expect(envoye['html']).toContain(attendu);
    }
    expect(b.emails[0]).toMatchObject({
      statut: 'sent',
      resend_id: 'rs_acces',
      tentative_numero: 2,
      erreur: null,
    });
    // Un seul email : la reprise ne repasse pas par la RPC de marquage.
    expect(b.emails).toHaveLength(1);
  });

  // LIMITE CONNUE, constatée ici pour qu'elle ne passe pas inaperçue : le tampon
  // « envoyé » est posé avant l'envoi et rien ne le retire quand l'email échoue
  // définitivement. L'écran Admin affiche alors « Email envoyé au programmateur »
  // et la collecte a quitté la tuile « Infos accès à envoyer », alors que le
  // programmateur n'a rien reçu. Vrai aussi pour tout refus répété de Resend,
  // avant comme après C5. À réécrire le jour où cette limite est fermée.
  it('la variable ne revient jamais → échec définitif après 4 tentatives, tampon « envoyé » toujours posé', async () => {
    await evaluerInfosAccesEtEnvoyer(client(b), 'coll-1');

    const reprises = [
      await runEmailRetryWorker(client(b), T0 + 6 * MIN),
      await runEmailRetryWorker(client(b), T0 + H + 6 * MIN),
      await runEmailRetryWorker(client(b), T0 + 25 * H + 6 * MIN),
      // Au-delà : la ligne n'est plus relue.
      await runEmailRetryWorker(client(b), T0 + 72 * H),
    ];

    expect(reprises.map((r) => r.retried)).toEqual([1, 1, 1, 0]);
    expect(reprises.map((r) => r.exhausted)).toEqual([0, 0, 1, 0]);
    expect(h.mockSend).not.toHaveBeenCalled();
    expect(b.emails[0]).toMatchObject({
      statut: 'failed',
      tentative_numero: 4,
    });
    expect(
      b.journal.some((l) => String(l['erreur']).includes('echec_final')),
    ).toBe(true);
    expect(b.majCollectes).toEqual([]);
  });
});
