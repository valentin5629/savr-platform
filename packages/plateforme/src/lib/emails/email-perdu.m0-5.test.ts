/**
 * Suites d'un email définitivement perdu (§08 §6 « échec après les 3 retries →
 * notification Admin Savr » ; décision Val 2026-10-08, C1) : une alerte in-app,
 * pour tout template — et, pour les infos d'accès chauffeur, les suites propres
 * à la collecte (tampon retiré, alerte dédiée).
 */
import { describe, it, expect } from 'vitest';

import type { EmailTranche } from '@savr/shared/src/email/index.js';
import {
  CODE_ALERTE_EMAIL_NON_REMIS,
  CODE_ALERTE_INFOS_ACCES_NON_REMISES,
} from '@/lib/emails/codes-alertes.js';
import {
  creerBaseEnMemoire,
  type BaseEnMemoire,
} from '@/test-utils/base-en-memoire';
import { traiterEmailPerdu } from './email-perdu.js';

type Client = Parameters<typeof traiterEmailPerdu>[0];
const client = (b: BaseEnMemoire) => b.client as Client;

const EMAIL: EmailTranche = {
  id: 'em-1',
  template_code: 'collecte_programmee',
  destinataire: 'contact@traiteur.local',
  entity_type: 'collectes',
  entity_id: 'coll-1',
};

describe('M0.5 / email perdu — alerte in-app (traiterEmailPerdu)', () => {
  it('4 tentatives épuisées → alerte « Email non remis » rattachée à l’entité de l’email', async () => {
    const b = creerBaseEnMemoire();

    expect(
      await traiterEmailPerdu(client(b), EMAIL, 'tentatives_epuisees'),
    ).toBeNull();

    expect(b.tables['alertes_admin']).toHaveLength(1);
    expect(b.tables['alertes_admin']![0]).toMatchObject({
      code: CODE_ALERTE_EMAIL_NON_REMIS,
      titre: 'Email non remis',
      message:
        'L’email « collecte_programmee » destiné à contact@traiteur.local n’a pas pu être envoyé après 4 tentatives. Prévenez le destinataire par un autre moyen.',
      entity_type: 'collectes',
      entity_id: 'coll-1',
      statut: 'ouverte',
    });
  });

  it('adresse refusée par la messagerie du destinataire → le message le dit', async () => {
    const b = creerBaseEnMemoire();

    await traiterEmailPerdu(client(b), EMAIL, 'adresse_refusee');

    const message = String(b.tables['alertes_admin']![0]!['message']);
    expect(message).toContain('a été refusé par la messagerie du destinataire');
    expect(message).not.toContain('4 tentatives');
  });

  it.each([
    { entity_type: null, entity_id: null },
    { entity_type: 'collectes', entity_id: null },
    { entity_type: null, entity_id: 'coll-1' },
  ])(
    'email sans entité complète (%o) → alerte rattachée à la ligne d’envoi elle-même',
    async (entite) => {
      const b = creerBaseEnMemoire();

      await traiterEmailPerdu(
        client(b),
        { ...EMAIL, ...entite },
        'tentatives_epuisees',
      );

      expect(b.tables['alertes_admin']![0]).toMatchObject({
        entity_type: 'emails_envoyes',
        entity_id: 'em-1',
      });
    },
  );

  it('deux emails sans entité perdus → deux alertes (aucune n’absorbe l’autre)', async () => {
    const b = creerBaseEnMemoire();
    const sansEntite = { ...EMAIL, entity_type: null, entity_id: null };

    await traiterEmailPerdu(client(b), sansEntite, 'tentatives_epuisees');
    await traiterEmailPerdu(
      client(b),
      { ...sansEntite, id: 'em-2' },
      'tentatives_epuisees',
    );

    expect(b.tables['alertes_admin']).toHaveLength(2);
  });

  // Arbitrage C1 : tout email perdu ouvre une alerte, y compris l'email de
  // vérification envoyé à l'inscription. Ce cas fige ce choix : une adresse
  // saisie par un visiteur non connecté peut donc figurer dans une alerte
  // (revue de sécurité 2026-10-08 — question posée à Val).
  it.each(['tentatives_epuisees', 'adresse_refusee'] as const)(
    'email de vérification d’inscription perdu (%s) → alerte, comme tout autre email',
    async (motif) => {
      const b = creerBaseEnMemoire();

      await traiterEmailPerdu(
        client(b),
        {
          id: 'em-inscription',
          template_code: 'verification_email',
          destinataire: 'visiteur@adresse-saisie.local',
          entity_type: null,
          entity_id: null,
        },
        motif,
      );

      expect(b.tables['alertes_admin']).toHaveLength(1);
      expect(b.tables['alertes_admin']![0]).toMatchObject({
        code: CODE_ALERTE_EMAIL_NON_REMIS,
        entity_type: 'emails_envoyes',
        entity_id: 'em-inscription',
      });
      expect(String(b.tables['alertes_admin']![0]!['message'])).toContain(
        'visiteur@adresse-saisie.local',
      );
    },
  );

  it('alerte non écrite (erreur base) → erreur rendue à l’appelant', async () => {
    const b = creerBaseEnMemoire();
    b.pannes['rpc.f_upsert_alerte_admin'] = { code: 'XX000', message: 'x' };

    expect(
      await traiterEmailPerdu(client(b), EMAIL, 'tentatives_epuisees'),
    ).toEqual({ code: 'XX000', message: 'x' });
  });
});

describe('M0.5 / email perdu — infos d’accès chauffeur', () => {
  const INFOS_ACCES: EmailTranche = {
    id: 'em-acces',
    template_code: 'infos_acces_collecte',
    destinataire: 'prog@infos-acces.local',
    entity_type: 'collecte',
    entity_id: 'coll-1',
  };
  const base = () =>
    creerBaseEnMemoire({
      emails_envoyes: [
        {
          ...INFOS_ACCES,
          statut: 'failed',
          tentative_numero: 4,
          created_at: '2026-10-08T07:00:01.000Z',
          envoye_at: null,
        },
      ],
      collectes: [
        { id: 'coll-1', infos_acces_email_envoye_at: '2026-10-08T07:00:00Z' },
      ],
    });

  it.each(['tentatives_epuisees', 'adresse_refusee'] as const)(
    '%s → tampon de la collecte retiré + alerte dédiée, PAS l’alerte générique',
    async (motif) => {
      const b = base();

      expect(await traiterEmailPerdu(client(b), INFOS_ACCES, motif)).toBeNull();

      expect(
        b.tables['collectes']![0]!['infos_acces_email_envoye_at'],
      ).toBeNull();
      expect(b.tables['alertes_admin']!.map((a) => a['code'])).toEqual([
        CODE_ALERTE_INFOS_ACCES_NON_REMISES,
      ]);
      // L'alerte dédiée ne recopie pas l'adresse du programmateur.
      expect(JSON.stringify(b.tables['alertes_admin'])).not.toContain(
        'prog@infos-acces.local',
      );
    },
  );

  it('même template mais rattaché à autre chose qu’une collecte → alerte générique, aucun tampon touché', async () => {
    const b = base();

    await traiterEmailPerdu(
      client(b),
      // Identifiant d'une vraie collecte, mais l'envoi dit porter sur un événement.
      { ...INFOS_ACCES, entity_type: 'evenement' },
      'tentatives_epuisees',
    );

    expect(b.tables['alertes_admin']![0]).toMatchObject({
      code: CODE_ALERTE_EMAIL_NON_REMIS,
      entity_type: 'evenement',
      entity_id: 'coll-1',
    });
    expect(b.tables['collectes']![0]!['infos_acces_email_envoye_at']).toBe(
      '2026-10-08T07:00:00Z',
    );
  });

  it('même template mais sans collecte rattachée → alerte générique (rien à retirer)', async () => {
    const b = base();

    await traiterEmailPerdu(
      client(b),
      { ...INFOS_ACCES, entity_type: null, entity_id: null },
      'tentatives_epuisees',
    );

    expect(b.tables['alertes_admin']!.map((a) => a['code'])).toEqual([
      CODE_ALERTE_EMAIL_NON_REMIS,
    ]);
    expect(b.tables['collectes']![0]!['infos_acces_email_envoye_at']).toBe(
      '2026-10-08T07:00:00Z',
    );
  });
});
