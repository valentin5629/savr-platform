/**
 * Infos d'accès chauffeur — ce qui se passe quand l'email ne part pas.
 *
 * Bout en bout : le VRAI `sendEmail`, le VRAI transport, le VRAI worker de retry
 * (`@savr/shared/src/email`), la VRAIE route du cron `email-retry` et les VRAIES
 * suites d'un email perdu. Seuls le SDK Resend et la base sont simulés (base en
 * mémoire : chaque étape relit ce que la précédente a écrit). Le fichier voisin
 * (`notify.m0-6.test.ts`) passe par le puits de capture, qui court-circuite tout
 * ce chemin.
 *
 * Décision Val 2026-10-08 (C1-C4) — le tampon `infos_acces_email_envoye_at`,
 * posé AVANT l'envoi par la RPC de marquage, ne vaut plus « email envoyé » :
 *   · tant que le worker réessaie, il reste posé (pas de second email) et la
 *     fiche lit « en reprise » dans le journal des emails ;
 *   · à l'échec définitif il est retiré (la collecte revient dans la tuile
 *     « Infos accès à envoyer ») et une alerte in-app est ouverte ;
 *   · collecte dans les 24 h : l'alerte part dès la 2e tentative en échec ;
 *   · si l'email finit par partir, l'alerte est close.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => {
  const mockSend = vi.fn();
  const ResendCtor = vi.fn(() => ({ emails: { send: mockSend } }));
  const etat = { client: null as unknown };
  return { mockSend, ResendCtor, etat };
});

vi.mock('resend', () => ({ Resend: h.ResendCtor }));
// `sendEmail` et le cron créent leur propre client admin : ils reçoivent la même
// base en mémoire que celle passée à `evaluerInfosAccesEtEnvoyer`.
vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => h.etat.client,
}));

import { logger } from '@savr/shared/src/logger/index.js';
import {
  _setOutboundThrottleEnabled,
  _resetOutboundThrottle,
} from '@savr/shared/src/rate-limit/outbound-throttle.js';
import { GET as cronEmailRetry } from '@/app/api/cron/email-retry/route';
import { CODE_ALERTE_INFOS_ACCES_NON_REMISES } from '@/lib/emails/codes-alertes.js';
import {
  creerBaseEnMemoire,
  type BaseEnMemoire,
  type Ligne,
} from '@/test-utils/base-en-memoire';
import { evaluerInfosAccesEtEnvoyer } from './notify.js';
import {
  deriverSuiviEmail,
  lireDernierEmailInfosAcces,
} from './suivi-email.js';

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

const DESTINATAIRE = 'prog@infos-acces.local';

const PAYLOAD_COMPLET = {
  to: DESTINATAIRE,
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

// 1er septembre 2026, 10 h à Paris.
const T0 = Date.parse('2026-09-01T08:00:00Z');
const MIN = 60 * 1000;
const H = 60 * MIN;
const EXPEDITEUR = 'Savr <notifications@envoi.savr-test.local>';

let b: BaseEnMemoire;

// La collecte a lieu le 10 septembre (loin) sauf mention contraire.
function creerBase(collecte: Ligne = {}): BaseEnMemoire {
  const base = creerBaseEnMemoire({
    email_templates: [{ ...TEMPLATE }],
    collectes: [
      {
        id: 'coll-1',
        statut: 'validee',
        date_collecte: '2026-09-10',
        heure_collecte: '08:00:00',
        controle_acces_requis: true,
        infos_acces_email_envoye_at: null,
        ...collecte,
      },
    ],
    emails_envoyes: [],
    alertes_admin: [],
    integrations_logs: [],
  });
  // Même contrat que `fn_infos_acces_marquer_si_complet` (prouvée en pgTAP) :
  // rien si le claim est déjà posé, sinon claim + données de l'email.
  base.rpcs['fn_infos_acces_marquer_si_complet'] = (args) => {
    const c = base.tables['collectes']!.find(
      (l) => l['id'] === args['p_collecte_id'],
    )!;
    if (c['infos_acces_email_envoye_at']) return null;
    c['infos_acces_email_envoye_at'] = new Date(Date.now()).toISOString();
    return PAYLOAD_COMPLET;
  };
  return base;
}

type Client = Parameters<typeof evaluerInfosAccesEtEnvoyer>[0];
const client = () => b.client as Client;
const collecte = () => b.tables['collectes']![0]!;
const tampon = () => collecte()['infos_acces_email_envoye_at'];
const emails = () => b.tables['emails_envoyes']!;
const alertes = (statut: string) =>
  b.tables['alertes_admin']!.filter((a) => a['statut'] === statut);

/** Ce que la fiche collecte afficherait : même lecture que GET /admin/collectes/[id]. */
async function etatAffiche() {
  const dernier = await lireDernierEmailInfosAcces(client(), 'coll-1');
  return deriverSuiviEmail(dernier.data, tampon() as string | null);
}

/** Un passage du cron `email-retry` à l'instant `t`. */
async function passageCron(t: number): Promise<Record<string, unknown>> {
  vi.setSystemTime(t);
  const res = await cronEmailRetry(
    new Request('http://localhost/api/cron/email-retry', {
      headers: { authorization: 'Bearer secret-cron' },
    }),
  );
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

const resendRefuse = () =>
  h.mockSend.mockResolvedValue({
    data: null,
    error: { name: 'application_error', message: '503 upstream' },
  });
const resendAccepte = () =>
  h.mockSend.mockResolvedValue({ data: { id: 'rs_acces' }, error: null });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  resendAccepte();
  b = creerBase();
  h.etat.client = b.client;
  // Production, vraie clé, expéditeur posé.
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('RESEND_API_KEY', 're_cle_de_test');
  vi.stubEnv('RESEND_FROM', EXPEDITEUR);
  vi.stubEnv('EMAIL_REDIRECT_TO', undefined);
  vi.stubEnv('CRON_SECRET', 'secret-cron');
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

describe('M0.6 / infos accès — l’email part du premier coup', () => {
  it('claim conservé, la fiche affiche « envoyé » à la date de l’envoi', async () => {
    const res = await evaluerInfosAccesEtEnvoyer(client(), 'coll-1');

    expect(res).toEqual({ envoye: true, issue: 'envoye' });
    expect(h.mockSend).toHaveBeenCalledTimes(1);
    expect(tampon()).toBe(new Date(T0).toISOString());
    expect(emails()).toHaveLength(1);
    expect(emails()[0]).toMatchObject({
      template_code: 'infos_acces_collecte',
      entity_type: 'collecte',
      entity_id: 'coll-1',
      statut: 'sent',
    });
    expect(await etatAffiche()).toEqual({
      etat: 'envoye',
      date: new Date(T0).toISOString(),
      tentative: 1,
      motif: null,
    });
  });
});

describe('M0.6 / infos accès — configuration email absente au moment de l’envoi', () => {
  beforeEach(() => {
    // Le cas que l'arbitrage C5 de la garde Resend a changé : plus d'exception.
    vi.stubEnv('RESEND_FROM', undefined);
  });

  it('aucune exception, l’envoi n’est PAS annoncé : en reprise, claim conservé, récapitulatif figé dans la ligne', async () => {
    const res = await evaluerInfosAccesEtEnvoyer(client(), 'coll-1');

    expect(res).toEqual({ envoye: false, issue: 'en_reprise' });
    expect(h.mockSend).not.toHaveBeenCalled();
    // Le claim reste posé : le worker porte l'envoi, un second ne doit pas partir.
    expect(tampon()).toBe(new Date(T0).toISOString());

    expect(emails()).toHaveLength(1);
    expect(emails()[0]).toMatchObject({
      template_code: 'infos_acces_collecte',
      destinataire: DESTINATAIRE,
      statut: 'failed',
      resend_id: null,
      tentative_numero: 1,
      entity_type: 'collecte',
      entity_id: 'coll-1',
    });
    expect(String(emails()[0]!['erreur'])).toContain('RESEND_FROM');
    // Le récapitulatif est figé dans la ligne : la reprise n'a pas besoin de la RPC.
    const variables = emails()[0]!['variables_jsonb'] as Record<string, string>;
    expect(variables['chauffeurs_bloc']).toContain('Jean Dupont');
    expect(variables['chauffeurs_bloc']).toContain('0622222222');

    // La fiche ne dit plus « envoyé ».
    expect(await etatAffiche()).toMatchObject({
      etat: 'en_reprise',
      tentative: 1,
    });
  });

  it('pendant la reprise, une nouvelle saisie Admin ne fait pas partir un second email', async () => {
    await evaluerInfosAccesEtEnvoyer(client(), 'coll-1');

    const seconde = await evaluerInfosAccesEtEnvoyer(client(), 'coll-1');

    expect(seconde).toEqual({ envoye: false, issue: 'sans_objet' });
    expect(emails()).toHaveLength(1);
  });

  it('variable posée ensuite → le worker envoie au programmateur le récapitulatif des deux camions', async () => {
    await evaluerInfosAccesEtEnvoyer(client(), 'coll-1');
    vi.stubEnv('RESEND_FROM', EXPEDITEUR);

    const passage = await passageCron(T0 + 6 * MIN);

    expect(passage).toMatchObject({ retried: 1, succeeded: 1, exhausted: 0 });
    expect(h.mockSend).toHaveBeenCalledTimes(1);
    const envoye = h.mockSend.mock.calls[0]![0] as Record<string, string>;
    expect(envoye['from']).toBe(EXPEDITEUR);
    expect(envoye['to']).toBe(DESTINATAIRE);
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
    expect(emails()[0]).toMatchObject({
      statut: 'sent',
      resend_id: 'rs_acces',
      tentative_numero: 2,
      erreur: null,
    });
    // Un seul email : la reprise ne repasse pas par la RPC de marquage.
    expect(emails()).toHaveLength(1);
    expect(tampon()).toBe(new Date(T0).toISOString());
    expect(await etatAffiche()).toMatchObject({ etat: 'envoye', tentative: 2 });
    // Collecte lointaine, email parti : aucune alerte n'a été ouverte.
    expect(b.tables['alertes_admin']).toEqual([]);
  });

  // Ex-« LIMITE CONNUE » : le tampon restait posé après l'échec définitif, l'écran
  // affichait « Email envoyé au programmateur » et la collecte avait quitté la
  // tuile « Infos accès à envoyer » alors que le programmateur n'avait rien reçu.
  it('la variable ne revient jamais → échec définitif après 4 tentatives : tampon retiré, alerte ouverte, fiche « non remis »', async () => {
    await evaluerInfosAccesEtEnvoyer(client(), 'coll-1');

    const passages = [
      await passageCron(T0 + 6 * MIN),
      await passageCron(T0 + H + 6 * MIN),
    ];
    // Tant que le worker réessaie : claim posé, fiche « en reprise », pas d'alerte
    // (la collecte est dans 9 jours).
    expect(tampon()).toBe(new Date(T0).toISOString());
    expect(await etatAffiche()).toMatchObject({
      etat: 'en_reprise',
      tentative: 3,
    });
    expect(b.tables['alertes_admin']).toEqual([]);

    passages.push(await passageCron(T0 + 25 * H + 6 * MIN));
    // Au-delà : la ligne n'est plus relue.
    passages.push(await passageCron(T0 + 72 * H));

    expect(passages.map((p) => p['retried'])).toEqual([1, 1, 1, 0]);
    expect(passages.map((p) => p['exhausted'])).toEqual([0, 0, 1, 0]);
    expect(passages.map((p) => p['errors'])).toEqual([[], [], [], []]);
    expect(h.mockSend).not.toHaveBeenCalled();
    expect(emails()[0]).toMatchObject({
      statut: 'failed',
      tentative_numero: 4,
    });
    expect(
      b.tables['integrations_logs']!.some((l) =>
        String(l['erreur']).includes('echec_final'),
      ),
    ).toBe(true);

    // 1. Le tampon est retiré : la collecte répond de nouveau au filtre de la
    //    tuile « Infos accès à envoyer » (`infos_acces_email_envoye_at IS NULL`).
    expect(tampon()).toBeNull();
    // 2. Une alerte in-app, une seule, pointe la fiche collecte.
    expect(alertes('ouverte')).toHaveLength(1);
    expect(alertes('ouverte')[0]).toMatchObject({
      code: CODE_ALERTE_INFOS_ACCES_NON_REMISES,
      entity_type: 'collecte',
      entity_id: 'coll-1',
    });
    // 3. La fiche dit que l'email n'est pas arrivé.
    expect(await etatAffiche()).toEqual({
      etat: 'non_remis',
      date: new Date(T0).toISOString(),
      tentative: 4,
      motif: 'tentatives_epuisees',
    });
  });

  it('après l’échec définitif, un nouvel envoi repart (claim libre), arrive, et clôt l’alerte', async () => {
    await evaluerInfosAccesEtEnvoyer(client(), 'coll-1');
    await passageCron(T0 + 6 * MIN);
    await passageCron(T0 + H + 6 * MIN);
    await passageCron(T0 + 25 * H + 6 * MIN);
    expect(alertes('ouverte')).toHaveLength(1);

    // La configuration est réparée, l'Admin renvoie l'email.
    vi.stubEnv('RESEND_FROM', EXPEDITEUR);
    vi.setSystemTime(T0 + 26 * H);
    const renvoi = await evaluerInfosAccesEtEnvoyer(client(), 'coll-1');

    expect(renvoi).toEqual({ envoye: true, issue: 'envoye' });
    expect(h.mockSend).toHaveBeenCalledTimes(1);
    expect(emails().map((e) => e['statut'])).toEqual(['failed', 'sent']);
    expect(tampon()).toBe(new Date(T0 + 26 * H).toISOString());
    expect(alertes('ouverte')).toEqual([]);
    expect(alertes('resolue')).toHaveLength(1);
    expect(await etatAffiche()).toMatchObject({ etat: 'envoye', tentative: 1 });
  });

  it('la réponse du cron ne porte que des compteurs : aucune adresse, aucune ligne d’email', async () => {
    await evaluerInfosAccesEtEnvoyer(client(), 'coll-1');
    await passageCron(T0 + 6 * MIN);
    await passageCron(T0 + H + 6 * MIN);

    const passage = await passageCron(T0 + 25 * H + 6 * MIN);

    expect(passage).toEqual({
      ok: true,
      scanned: 1,
      retried: 1,
      succeeded: 0,
      exhausted: 1,
      infos_acces_signalees: 0,
      errors: [],
    });
    expect(JSON.stringify(passage)).not.toContain(DESTINATAIRE);
  });
});

describe('M0.6 / infos accès — Resend refuse, collecte ce soir', () => {
  beforeEach(() => {
    // Collecte le jour même à 19 h (dans 9 h).
    b = creerBase({ date_collecte: '2026-09-01', heure_collecte: '19:00:00' });
    h.etat.client = b.client;
    resendRefuse();
  });

  it('alerte dès la 2e tentative en échec, sans attendre les 25 h — le claim reste posé', async () => {
    await evaluerInfosAccesEtEnvoyer(client(), 'coll-1');
    // Un seul échec : pas encore d'alerte.
    expect(b.tables['alertes_admin']).toEqual([]);

    const passage = await passageCron(T0 + 6 * MIN);

    expect(passage).toMatchObject({
      retried: 1,
      exhausted: 0,
      infos_acces_signalees: 1,
      errors: [],
    });
    expect(alertes('ouverte')).toHaveLength(1);
    expect(alertes('ouverte')[0]).toMatchObject({
      code: CODE_ALERTE_INFOS_ACCES_NON_REMISES,
      entity_id: 'coll-1',
    });
    // Le worker porte toujours l'envoi : pas de retour dans la tuile, pas de renvoi.
    expect(tampon()).toBe(new Date(T0).toISOString());
    expect(await etatAffiche()).toMatchObject({
      etat: 'en_reprise',
      tentative: 2,
    });
  });

  it('les passages suivants du cron ne rouvrent pas l’alerte', async () => {
    await evaluerInfosAccesEtEnvoyer(client(), 'coll-1');
    await passageCron(T0 + 6 * MIN);

    const suivant = await passageCron(T0 + 11 * MIN);

    expect(suivant).toMatchObject({ retried: 0, infos_acces_signalees: 0 });
    expect(b.tables['alertes_admin']).toHaveLength(1);
  });

  it('Resend revient → l’email part à la reprise suivante et l’alerte est close toute seule', async () => {
    await evaluerInfosAccesEtEnvoyer(client(), 'coll-1');
    await passageCron(T0 + 6 * MIN);
    expect(alertes('ouverte')).toHaveLength(1);

    resendAccepte();
    const passage = await passageCron(T0 + H + 6 * MIN);

    expect(passage).toMatchObject({ succeeded: 1, errors: [] });
    expect(alertes('ouverte')).toEqual([]);
    expect(alertes('resolue')).toHaveLength(1);
    expect(emails()).toHaveLength(1);
    expect(await etatAffiche()).toMatchObject({ etat: 'envoye', tentative: 3 });
  });
});

describe('M0.6 / infos accès — rien n’est parti et rien ne le reprendra', () => {
  it('hors production sans adresse de redirection → claim relâché, aucune ligne, la fiche reste « à envoyer »', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');

    const res = await evaluerInfosAccesEtEnvoyer(client(), 'coll-1');

    expect(res).toEqual({ envoye: false, issue: 'non_envoye' });
    expect(h.mockSend).not.toHaveBeenCalled();
    expect(emails()).toEqual([]);
    expect(tampon()).toBeNull();
    expect(await etatAffiche()).toMatchObject({ etat: 'a_envoyer' });
  });

  it('template désactivé → claim relâché, aucune ligne', async () => {
    b.tables['email_templates']![0]!['actif'] = false;

    const res = await evaluerInfosAccesEtEnvoyer(client(), 'coll-1');

    expect(res).toEqual({ envoye: false, issue: 'non_envoye' });
    expect(emails()).toEqual([]);
    expect(tampon()).toBeNull();
  });

  it('Resend refuse ET la ligne d’envoi ne s’écrit pas → claim relâché : aucune reprise n’est possible', async () => {
    resendRefuse();
    b.pannes['emails_envoyes.insert'] = { code: '08006', message: 'connexion' };

    const res = await evaluerInfosAccesEtEnvoyer(client(), 'coll-1');

    expect(res).toEqual({ envoye: false, issue: 'non_envoye' });
    expect(emails()).toEqual([]);
    expect(tampon()).toBeNull();
  });
});

// §08 §6 « échec après les 3 retries → notification Admin Savr » : vaut pour tout
// email, pas seulement les infos d'accès (décision Val 2026-10-08, C1).
describe('M0.5 / cron email-retry — email d’un autre template définitivement perdu', () => {
  it('4e tentative en échec → alerte in-app « Email non remis », rattachée à la collecte, sans toucher à son tampon', async () => {
    resendRefuse();
    b.tables['email_templates']!.push({
      code: 'collecte_programmee',
      sujet: 'Votre collecte',
      corps_html: '<p>Bonjour</p>',
      actif: true,
      variables: [],
    });
    b.tables['collectes']![0]!['infos_acces_email_envoye_at'] =
      '2026-08-30T10:00:00.000Z';
    emails().push({
      id: 'em-autre',
      template_code: 'collecte_programmee',
      destinataire: 'contact@traiteur.local',
      variables_jsonb: {},
      statut: 'failed',
      tentative_numero: 3,
      created_at: new Date(T0).toISOString(),
      entity_type: 'collecte',
      entity_id: 'coll-1',
    });

    const passage = await passageCron(T0 + 25 * H + 6 * MIN);

    expect(passage).toMatchObject({ exhausted: 1, errors: [] });
    expect(alertes('ouverte')).toHaveLength(1);
    expect(alertes('ouverte')[0]).toMatchObject({
      code: 'email_echec_definitif',
      titre: 'Email non remis',
      message:
        'L’email « collecte_programmee » destiné à contact@traiteur.local n’a pas pu être envoyé après 4 tentatives. Prévenez le destinataire par un autre moyen.',
      entity_type: 'collecte',
      entity_id: 'coll-1',
    });
    // Ce n'est pas l'email d'infos d'accès : le tampon de la collecte ne bouge pas.
    expect(tampon()).toBe('2026-08-30T10:00:00.000Z');
  });
});

describe('M0.6 / cron email-retry — une suite manquée n’arrête pas les autres', () => {
  it('tampon non retiré (erreur base) → comptée dans `errors`, journalisée sans adresse, réponse 200', async () => {
    vi.stubEnv('RESEND_FROM', undefined);
    await evaluerInfosAccesEtEnvoyer(client(), 'coll-1');
    await passageCron(T0 + 6 * MIN);
    await passageCron(T0 + H + 6 * MIN);
    b.pannes['collectes.update'] = { code: '08006', message: 'connexion' };

    const passage = await passageCron(T0 + 25 * H + 6 * MIN);

    expect(passage).toMatchObject({
      exhausted: 1,
      errors: ['email_perdu:08006'],
    });
    const trace = vi
      .mocked(logger.error)
      .mock.calls.find(
        ([evenement]) => evenement === 'email.suite_echec_non_appliquee',
      );
    expect(trace?.[1]).toEqual({
      etape: 'email_perdu',
      email_id: emails()[0]!['id'],
      error_code: '08006',
    });
    // La fiche, elle, dit quand même vrai : elle lit le journal des emails.
    expect(await etatAffiche()).toMatchObject({ etat: 'non_remis' });
  });
});
