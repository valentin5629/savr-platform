/**
 * Suivi de l'email « infos d'accès chauffeur » (décision Val 2026-10-08, C1-C4).
 *
 *  · `deriverSuiviEmail` — l'état affiché vient du journal des emails ; le tampon
 *    de la collecte ne tranche que là où le journal ne dit rien.
 *  · `signalerInfosAccesNonRemises` — email perdu : tampon retiré + alerte, sauf
 *    si un envoi plus récent l'a remplacé.
 *  · `cloreAlerteInfosAcces` — l'email est finalement parti.
 *  · `alerterInfosAccesEnRepriseAvantCollecte` — alerte anticipée : 2 tentatives
 *    en échec et collecte dans les 24 h.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { CODE_ALERTE_INFOS_ACCES_NON_REMISES } from '@/lib/emails/codes-alertes.js';
import {
  creerBaseEnMemoire,
  type BaseEnMemoire,
  type Ligne,
} from '@/test-utils/base-en-memoire';
import {
  alerterInfosAccesEnRepriseAvantCollecte,
  cloreAlerteInfosAcces,
  deriverSuiviEmail,
  lireDernierEmailInfosAcces,
  signalerInfosAccesNonRemises,
  type DernierEmailInfosAcces,
} from './suivi-email.js';

type Client = Parameters<typeof signalerInfosAccesNonRemises>[0];
const client = (b: BaseEnMemoire) => b.client as Client;

const TAMPON = '2026-10-08T07:00:00.000Z';

const email = (
  surcharge: Partial<DernierEmailInfosAcces> = {},
): DernierEmailInfosAcces => ({
  id: 'em-1',
  statut: 'sent',
  tentative_numero: 1,
  created_at: '2026-10-08T07:00:01.000Z',
  envoye_at: '2026-10-08T07:00:02.000Z',
  ...surcharge,
});

describe('M0.6 / infos accès — état de l’email (deriverSuiviEmail)', () => {
  it('aucun envoi, aucun tampon → à envoyer', () => {
    expect(deriverSuiviEmail(null, null)).toEqual({
      etat: 'a_envoyer',
      date: null,
      tentative: null,
      motif: null,
    });
  });

  it('tampon posé mais AUCUNE ligne d’envoi (envoi réservé, interrompu avant d’être tracé) → à envoyer : rien ne prouve qu’un email est parti', () => {
    expect(deriverSuiviEmail(null, TAMPON)).toEqual({
      etat: 'a_envoyer',
      date: null,
      tentative: null,
      motif: null,
    });
  });

  it.each(['sent', 'delivered'])(
    'ligne %s + tampon → envoyé, à la date réelle de l’envoi',
    (statut) => {
      expect(deriverSuiviEmail(email({ statut }), TAMPON)).toEqual({
        etat: 'envoye',
        date: '2026-10-08T07:00:02.000Z',
        tentative: 1,
        motif: null,
      });
    },
  );

  it('ligne envoyée mais tampon retiré (renvoi demandé, pas encore reparti) → à envoyer', () => {
    expect(deriverSuiviEmail(email(), null).etat).toBe('a_envoyer');
  });

  it.each([1, 2, 3])(
    'ligne en échec, tentative %i → en reprise, tampon posé ou non',
    (tentative) => {
      const ligne = email({
        statut: 'failed',
        tentative_numero: tentative,
        envoye_at: null,
      });
      for (const tampon of [TAMPON, null]) {
        expect(deriverSuiviEmail(ligne, tampon)).toEqual({
          etat: 'en_reprise',
          date: '2026-10-08T07:00:01.000Z',
          tentative,
          motif: null,
        });
      }
    },
  );

  it('4e tentative en échec → non remis, MÊME si le tampon « envoyé » est encore posé', () => {
    const ligne = email({
      statut: 'failed',
      tentative_numero: 4,
      envoye_at: null,
    });
    for (const tampon of [TAMPON, null]) {
      expect(deriverSuiviEmail(ligne, tampon)).toEqual({
        etat: 'non_remis',
        date: '2026-10-08T07:00:01.000Z',
        tentative: 4,
        motif: 'tentatives_epuisees',
      });
    }
  });

  it('ligne refusée par la messagerie du destinataire → non remis, adresse refusée', () => {
    expect(deriverSuiviEmail(email({ statut: 'bounced' }), TAMPON)).toEqual({
      etat: 'non_remis',
      date: '2026-10-08T07:00:01.000Z',
      tentative: 1,
      motif: 'adresse_refusee',
    });
  });

  it('statut inconnu du suivi (queued) → repli sur le tampon', () => {
    expect(deriverSuiviEmail(email({ statut: 'queued' }), TAMPON).etat).toBe(
      'envoye',
    );
    expect(deriverSuiviEmail(email({ statut: 'queued' }), null).etat).toBe(
      'a_envoyer',
    );
  });
});

const ligneEmail = (surcharge: Ligne = {}): Ligne => ({
  id: 'em-1',
  template_code: 'infos_acces_collecte',
  destinataire: 'prog@infos-acces.local',
  entity_type: 'collecte',
  entity_id: 'coll-1',
  statut: 'failed',
  tentative_numero: 4,
  created_at: '2026-10-08T07:00:01.000Z',
  envoye_at: null,
  ...surcharge,
});

const collecte = (surcharge: Ligne = {}): Ligne => ({
  id: 'coll-1',
  statut: 'validee',
  date_collecte: '2026-10-08',
  heure_collecte: '19:00:00',
  infos_acces_email_envoye_at: TAMPON,
  ...surcharge,
});

const alertesOuvertes = (b: BaseEnMemoire): Ligne[] =>
  (b.tables['alertes_admin'] ?? []).filter((a) => a['statut'] === 'ouverte');

describe('M0.6 / infos accès — email perdu (signalerInfosAccesNonRemises)', () => {
  let b: BaseEnMemoire;
  beforeEach(() => {
    b = creerBaseEnMemoire({
      emails_envoyes: [ligneEmail()],
      collectes: [collecte(), collecte({ id: 'coll-2' })],
    });
  });

  it('tampon retiré sur CETTE collecte + alerte in-app pointant la fiche', async () => {
    const erreur = await signalerInfosAccesNonRemises(
      client(b),
      'coll-1',
      'em-1',
    );

    expect(erreur).toBeNull();
    expect(b.tables['collectes']).toEqual([
      collecte({ infos_acces_email_envoye_at: null }),
      collecte({ id: 'coll-2' }),
    ]);
    expect(alertesOuvertes(b)).toHaveLength(1);
    expect(alertesOuvertes(b)[0]).toMatchObject({
      code: CODE_ALERTE_INFOS_ACCES_NON_REMISES,
      entity_type: 'collecte',
      entity_id: 'coll-1',
    });
    // L'alerte ne porte pas l'adresse du programmateur.
    expect(JSON.stringify(alertesOuvertes(b)[0])).not.toContain('@');
  });

  it('rejouée (rejeu du webhook) → toujours une seule alerte', async () => {
    await signalerInfosAccesNonRemises(client(b), 'coll-1', 'em-1');
    await signalerInfosAccesNonRemises(client(b), 'coll-1', 'em-1');
    expect(alertesOuvertes(b)).toHaveLength(1);
  });

  it('un envoi plus récent existe pour la collecte → rien : le refus tardif de l’ancien email ne défait pas le renvoi', async () => {
    b.tables['emails_envoyes']!.push(
      ligneEmail({
        id: 'em-2',
        statut: 'sent',
        tentative_numero: 1,
        created_at: '2026-10-09T09:00:00.000Z',
      }),
    );

    const erreur = await signalerInfosAccesNonRemises(
      client(b),
      'coll-1',
      'em-1',
    );

    expect(erreur).toBeNull();
    expect(b.tables['collectes']![0]!['infos_acces_email_envoye_at']).toBe(
      TAMPON,
    );
    expect(alertesOuvertes(b)).toEqual([]);
  });

  it('le dernier envoi d’un AUTRE template ne compte pas comme « plus récent »', async () => {
    b.tables['emails_envoyes']!.push(
      ligneEmail({
        id: 'em-autre',
        template_code: 'collecte_programmee',
        statut: 'sent',
        created_at: '2026-10-09T09:00:00.000Z',
      }),
    );

    await signalerInfosAccesNonRemises(client(b), 'coll-1', 'em-1');

    expect(
      b.tables['collectes']![0]!['infos_acces_email_envoye_at'],
    ).toBeNull();
    expect(alertesOuvertes(b)).toHaveLength(1);
  });

  it('tampon non retiré (erreur base) → erreur rendue à l’appelant, pas d’alerte sans retour à la tuile', async () => {
    b.pannes['collectes.update'] = { code: '08006', message: 'connexion' };

    const erreur = await signalerInfosAccesNonRemises(
      client(b),
      'coll-1',
      'em-1',
    );

    expect(erreur).toEqual({ code: '08006', message: 'connexion' });
    expect(alertesOuvertes(b)).toEqual([]);
  });

  it('journal des emails illisible → erreur rendue, rien d’écrit', async () => {
    b.pannes['emails_envoyes.select'] = { code: '57014', message: 'timeout' };

    const erreur = await signalerInfosAccesNonRemises(
      client(b),
      'coll-1',
      'em-1',
    );

    expect(erreur).toEqual({ code: '57014', message: 'timeout' });
    expect(b.tables['collectes']![0]!['infos_acces_email_envoye_at']).toBe(
      TAMPON,
    );
  });

  it('alerte non ouverte (erreur base) → erreur rendue', async () => {
    b.pannes['rpc.f_upsert_alerte_admin'] = { code: 'XX000', message: 'x' };
    expect(
      await signalerInfosAccesNonRemises(client(b), 'coll-1', 'em-1'),
    ).toEqual({ code: 'XX000', message: 'x' });
  });
});

describe('M0.6 / infos accès — lecture du journal des emails (lireDernierEmailInfosAcces)', () => {
  it('ne demande ni l’adresse du destinataire ni le message d’erreur (fiche servie aussi à ops_savr)', async () => {
    const b = creerBaseEnMemoire({ emails_envoyes: [ligneEmail()] });

    const { data } = await lireDernierEmailInfosAcces(client(b), 'coll-1');

    expect(data?.id).toBe('em-1');
    expect(b.selects['emails_envoyes']).toEqual([
      'id, statut, tentative_numero, created_at, envoye_at',
    ]);
  });

  it('rend le plus récent des envois de la collecte', async () => {
    const b = creerBaseEnMemoire({
      emails_envoyes: [
        ligneEmail({ id: 'em-ancien' }),
        ligneEmail({ id: 'em-recent', created_at: '2026-10-09T09:00:00.000Z' }),
        ligneEmail({ id: 'em-milieu', created_at: '2026-10-08T12:00:00.000Z' }),
      ],
    });
    const { data } = await lireDernierEmailInfosAcces(client(b), 'coll-1');
    expect(data?.id).toBe('em-recent');
  });
});

describe('M0.6 / infos accès — email finalement parti (cloreAlerteInfosAcces)', () => {
  it('clôt l’alerte ouverte de CETTE collecte, et elle seule', async () => {
    const alerte = (surcharge: Ligne): Ligne => ({
      code: CODE_ALERTE_INFOS_ACCES_NON_REMISES,
      entity_type: 'collecte',
      entity_id: 'coll-1',
      statut: 'ouverte',
      resolue_at: null,
      ...surcharge,
    });
    const b = creerBaseEnMemoire({
      alertes_admin: [
        alerte({ id: 'a-cible' }),
        alerte({ id: 'a-autre-collecte', entity_id: 'coll-2' }),
        alerte({ id: 'a-autre-code', code: 'pesee_hors_seuil' }),
        alerte({ id: 'a-autre-type', entity_type: 'lieux' }),
        // Déjà résolue par l'Admin lors d'un envoi précédent : sa date ne bouge pas.
        alerte({
          id: 'a-deja-resolue',
          statut: 'resolue',
          resolue_at: '2026-09-01T10:00:00.000Z',
        }),
      ],
    });

    expect(await cloreAlerteInfosAcces(client(b), 'coll-1')).toBeNull();

    const etats = Object.fromEntries(
      b.tables['alertes_admin']!.map((a) => [a['id'], a['statut']]),
    );
    expect(etats).toEqual({
      'a-cible': 'resolue',
      'a-autre-collecte': 'ouverte',
      'a-autre-code': 'ouverte',
      'a-autre-type': 'ouverte',
      'a-deja-resolue': 'resolue',
    });
    expect(b.tables['alertes_admin']![4]!['resolue_at']).toBe(
      '2026-09-01T10:00:00.000Z',
    );
    expect(b.tables['alertes_admin']![0]!['resolue_at']).toEqual(
      expect.any(String),
    );
  });

  it('erreur base → rendue à l’appelant', async () => {
    const b = creerBaseEnMemoire();
    b.pannes['alertes_admin.update'] = { code: '08006', message: 'connexion' };
    expect(await cloreAlerteInfosAcces(client(b), 'coll-1')).toEqual({
      code: '08006',
      message: 'connexion',
    });
  });
});

describe('M0.6 / infos accès — alerte anticipée avant une collecte proche', () => {
  // 8 octobre 2026, 10 h à Paris (UTC+2).
  const MAINTENANT = Date.parse('2026-10-08T08:00:00Z');

  const base = (emails: Ligne[], collectes: Ligne[], alertes: Ligne[] = []) => {
    const b = creerBaseEnMemoire({
      emails_envoyes: emails,
      collectes,
      alertes_admin: alertes,
    });
    b.maintenant = () => MAINTENANT;
    return b;
  };
  const enReprise = (surcharge: Ligne = {}): Ligne =>
    ligneEmail({ tentative_numero: 2, ...surcharge });
  const lancer = (b: BaseEnMemoire) =>
    alerterInfosAccesEnRepriseAvantCollecte(client(b), MAINTENANT);

  it('2 tentatives en échec, collecte ce soir (dans 9 h) → alerte', async () => {
    const b = base([enReprise()], [collecte()]);

    expect(await lancer(b)).toEqual({ signalees: 1, error: null });
    expect(alertesOuvertes(b)).toHaveLength(1);
    expect(alertesOuvertes(b)[0]).toMatchObject({
      code: CODE_ALERTE_INFOS_ACCES_NON_REMISES,
      entity_type: 'collecte',
      entity_id: 'coll-1',
    });
    // Le tampon reste posé : le worker de retry porte toujours l'envoi.
    expect(b.tables['collectes']![0]!['infos_acces_email_envoye_at']).toBe(
      TAMPON,
    );
  });

  it('3 tentatives en échec → alerte aussi', async () => {
    const b = base([enReprise({ tentative_numero: 3 })], [collecte()]);
    expect((await lancer(b)).signalees).toBe(1);
  });

  it('une seule tentative en échec → pas encore (un incident passager ne doit pas alerter)', async () => {
    const b = base([enReprise({ tentative_numero: 1 })], [collecte()]);
    expect(await lancer(b)).toEqual({ signalees: 0, error: null });
    expect(alertesOuvertes(b)).toEqual([]);
  });

  it('4e tentative en échec → pas ici : c’est l’échec définitif qui la traite', async () => {
    const b = base([enReprise({ tentative_numero: 4 })], [collecte()]);
    expect((await lancer(b)).signalees).toBe(0);
  });

  it('seuil des 24 h : 23 h 59 → alerte ; 24 h 01 → pas d’alerte', async () => {
    // Collecte demain : 10 h à Paris = MAINTENANT + 24 h.
    const demain = (heure: string) =>
      collecte({ date_collecte: '2026-10-09', heure_collecte: heure });

    const juste = base([enReprise()], [demain('09:59:00')]);
    expect((await lancer(juste)).signalees).toBe(1);

    const audela = base([enReprise()], [demain('10:01:00')]);
    expect((await lancer(audela)).signalees).toBe(0);
  });

  it('collecte d’hier → pas d’alerte : le camion est passé', async () => {
    const b = base([enReprise()], [collecte({ date_collecte: '2026-10-07' })]);
    expect((await lancer(b)).signalees).toBe(0);
  });

  it('collecte d’aujourd’hui dont l’heure vient de passer → alerte (le camion est peut-être à la grille)', async () => {
    const b = base([enReprise()], [collecte({ heure_collecte: '08:00:00' })]);
    expect((await lancer(b)).signalees).toBe(1);
  });

  it.each([
    'annulee',
    'realisee',
    'realisee_sans_collecte',
    'cloturee',
    'rejetee_par_prestataire',
  ])('collecte %s → pas d’alerte', async (statut) => {
    const b = base([enReprise()], [collecte({ statut })]);
    expect((await lancer(b)).signalees).toBe(0);
  });

  it('email d’un autre template en reprise → ignoré', async () => {
    const b = base(
      [enReprise({ template_code: 'collecte_programmee' })],
      [collecte()],
    );
    expect((await lancer(b)).signalees).toBe(0);
  });

  it('email rattaché à autre chose qu’une collecte → ignoré, même si l’identifiant coïncide', async () => {
    const b = base([enReprise({ entity_type: 'evenement' })], [collecte()]);
    expect((await lancer(b)).signalees).toBe(0);
  });

  it('email parti (plus en échec) → ignoré', async () => {
    const b = base([enReprise({ statut: 'sent' })], [collecte()]);
    expect((await lancer(b)).signalees).toBe(0);
  });

  it('passages suivants du cron → la même alerte n’est pas rouverte', async () => {
    const b = base([enReprise()], [collecte()]);
    await lancer(b);

    expect(await lancer(b)).toEqual({ signalees: 0, error: null });
    expect(b.tables['alertes_admin']).toHaveLength(1);
  });

  it('alerte résolue par l’Admin (programmateur prévenu) → pas rouverte tant que le même envoi est en reprise', async () => {
    const b = base([enReprise()], [collecte()]);
    await lancer(b);
    b.tables['alertes_admin']![0]!['statut'] = 'resolue';

    expect((await lancer(b)).signalees).toBe(0);
    expect(b.tables['alertes_admin']).toHaveLength(1);
  });

  it('alerte encore OUVERTE depuis un envoi précédent → rien de neuf à signaler', async () => {
    const b = base(
      [enReprise()],
      [collecte()],
      [
        {
          id: 'a-ancienne',
          code: CODE_ALERTE_INFOS_ACCES_NON_REMISES,
          entity_type: 'collecte',
          entity_id: 'coll-1',
          statut: 'ouverte',
          created_at: '2026-10-07T12:00:00.000Z',
        },
      ],
    );

    expect(await lancer(b)).toEqual({ signalees: 0, error: null });
    expect(b.tables['alertes_admin']).toHaveLength(1);
  });

  it('alerte résolue lors d’un envoi PRÉCÉDENT → le nouvel envoi en reprise rouvre une alerte', async () => {
    const b = base(
      [enReprise()],
      [collecte()],
      [
        {
          id: 'a-ancienne',
          code: CODE_ALERTE_INFOS_ACCES_NON_REMISES,
          entity_type: 'collecte',
          entity_id: 'coll-1',
          statut: 'resolue',
          // Antérieure à la demande d'envoi en cours (07:00:01Z).
          created_at: '2026-10-07T12:00:00.000Z',
        },
      ],
    );

    expect((await lancer(b)).signalees).toBe(1);
    expect(alertesOuvertes(b)).toHaveLength(1);
  });

  it('deux collectes, une seule proche → une seule signalée', async () => {
    const b = base(
      [
        enReprise(),
        enReprise({ id: 'em-2', entity_id: 'coll-loin' }),
        enReprise({ id: 'em-3', entity_id: null }),
      ],
      [collecte(), collecte({ id: 'coll-loin', date_collecte: '2026-10-12' })],
    );

    expect((await lancer(b)).signalees).toBe(1);
    expect(alertesOuvertes(b).map((a) => a['entity_id'])).toEqual(['coll-1']);
  });

  it.each([
    'emails_envoyes.select',
    'collectes.select',
    'alertes_admin.select',
  ])(
    'erreur de lecture (%s) → rendue à l’appelant, aucune alerte',
    async (cle) => {
      const b = base([enReprise()], [collecte()]);
      b.pannes[cle] = { code: '57014', message: 'timeout' };

      expect(await lancer(b)).toEqual({
        signalees: 0,
        error: { code: '57014', message: 'timeout' },
      });
      expect(alertesOuvertes(b)).toEqual([]);
    },
  );

  it('alerte non ouverte (erreur base) → rendue à l’appelant', async () => {
    const b = base([enReprise()], [collecte()]);
    b.pannes['rpc.f_upsert_alerte_admin'] = { code: 'XX000', message: 'x' };
    expect(await lancer(b)).toEqual({
      signalees: 0,
      error: { code: 'XX000', message: 'x' },
    });
  });
});
