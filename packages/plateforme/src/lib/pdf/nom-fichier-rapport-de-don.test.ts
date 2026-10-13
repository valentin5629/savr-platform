/**
 * M2.4 — nom du fichier d'un « Rapport de don » (§12 §1.3-bis, décision Val
 * 2026-10-13 : le document d'une collecte AG porte ce nom jusque dans son fichier).
 */
import { describe, expect, it } from 'vitest';

import { type SupabaseClient } from '@savr/shared/src/supabase-client.js';

import {
  nomFichierAttestation,
  nomFichierDuRapportDeLaCollecte,
  nomFichierSansExcedent,
} from './nom-fichier-rapport-de-don.js';

/** Même contrainte que `getPresignedUrl` : un nom hors de ce motif est ignoré. */
const NOM_SUR = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

describe('M2.4 / nom de fichier « Rapport de don » — avec excédents', () => {
  it('reprend le numéro de l’attestation', () => {
    expect(nomFichierAttestation('ATT-DON-2026-00001')).toBe(
      'rapport-de-don-ATT-DON-2026-00001.pdf',
    );
  });

  it('numéro absent → « rapport-de-don.pdf », jamais le nom technique', () => {
    expect(nomFichierAttestation(null)).toBe('rapport-de-don.pdf');
    expect(nomFichierAttestation(undefined)).toBe('rapport-de-don.pdf');
    expect(nomFichierAttestation('')).toBe('rapport-de-don.pdf');
  });

  it('numéro inattendu → réduit à des lettres, chiffres et tirets', () => {
    const nom = nomFichierAttestation('ATT/DON "2026"\r\n00001');
    expect(nom).toBe('rapport-de-don-ATT-DON-2026-00001.pdf');
    expect(nom).toMatch(NOM_SUR);
  });
});

describe('M2.4 / nom de fichier « Rapport de don » — sans excédent', () => {
  it('date puis nom de l’événement, sans accent ni espace', () => {
    expect(
      nomFichierSansExcedent({
        date_evenement: '2026-10-09',
        nom_evenement: 'Gala de la Fondation — Été 2026',
      }),
    ).toBe('rapport-de-don-2026-10-09-gala-de-la-fondation-ete-2026.pdf');
  });

  it('date avec heure → seul le jour est gardé', () => {
    expect(
      nomFichierSansExcedent({
        date_evenement: '2026-10-09T18:30:00+02:00',
        nom_evenement: 'Gala',
      }),
    ).toBe('rapport-de-don-2026-10-09-gala.pdf');
  });

  it('nom long → coupé à 60 caractères, sans tiret final', () => {
    const nom = nomFichierSansExcedent({
      date_evenement: '2026-10-09',
      nom_evenement: `${'a'.repeat(59)} ${'b'.repeat(40)}`,
    });
    expect(nom).toBe(`rapport-de-don-2026-10-09-${'a'.repeat(59)}.pdf`);
  });

  it('date ou nom absent → la partie connue seule', () => {
    expect(
      nomFichierSansExcedent({ date_evenement: null, nom_evenement: 'Gala' }),
    ).toBe('rapport-de-don-gala.pdf');
    expect(
      nomFichierSansExcedent({
        date_evenement: '2026-10-09',
        nom_evenement: '   ',
      }),
    ).toBe('rapport-de-don-2026-10-09.pdf');
    expect(nomFichierSansExcedent(null)).toBe('rapport-de-don.pdf');
  });

  it('texte libre hostile → toujours un nom sûr pour un en-tête', () => {
    const nom = nomFichierSansExcedent({
      date_evenement: '2026-10-09',
      nom_evenement: 'Soirée "VIP"\r\nContent-Type: text/html; ../../x',
    });
    expect(nom).toMatch(NOM_SUR);
    expect(nom).toBe(
      'rapport-de-don-2026-10-09-soiree-vip-content-type-text-html-x.pdf',
    );
  });
});

type Reponse = { data: unknown; error: unknown };

/** Client simulé : rend `reponse` à la lecture de `collectes`, et note la requête. */
function clientSimule(reponse: Reponse | Error) {
  const appels: { table?: string; select?: string; eq?: unknown[] } = {};
  const chaine = {
    select(colonnes: string) {
      appels.select = colonnes;
      return chaine;
    },
    eq(...args: unknown[]) {
      appels.eq = args;
      return chaine;
    },
    maybeSingle() {
      return reponse instanceof Error
        ? Promise.reject(reponse)
        : Promise.resolve(reponse);
    },
  };
  const client = {
    from(table: string) {
      appels.table = table;
      return chaine;
    },
  } as unknown as SupabaseClient;
  return { client, appels };
}

describe('M2.4 / nom de fichier du rapport d’une collecte', () => {
  it('AG sans excédent → « Rapport de don » de l’événement, lu par la collecte', async () => {
    const { client, appels } = clientSimule({
      data: {
        type: 'anti_gaspi',
        statut: 'realisee_sans_collecte',
        evenements: { nom_evenement: 'Gala', date_evenement: '2026-10-09' },
      },
      error: null,
    });
    expect(await nomFichierDuRapportDeLaCollecte(client, 'c1')).toBe(
      'rapport-de-don-2026-10-09-gala.pdf',
    );
    expect(appels).toEqual({
      table: 'collectes',
      select: 'type, statut, evenements(nom_evenement, date_evenement)',
      eq: ['id', 'c1'],
    });
  });

  it('événement rendu en tableau par l’embed → même nom', async () => {
    const { client } = clientSimule({
      data: {
        type: 'anti_gaspi',
        statut: 'realisee_sans_collecte',
        evenements: [{ nom_evenement: 'Gala', date_evenement: '2026-10-09' }],
      },
      error: null,
    });
    expect(await nomFichierDuRapportDeLaCollecte(client, 'c1')).toBe(
      'rapport-de-don-2026-10-09-gala.pdf',
    );
  });

  it('collecte ZD → aucun nom imposé (le rapport de recyclage garde le sien)', async () => {
    const { client } = clientSimule({
      data: {
        type: 'zero_dechet',
        statut: 'cloturee',
        evenements: { nom_evenement: 'Gala', date_evenement: '2026-10-09' },
      },
      error: null,
    });
    expect(await nomFichierDuRapportDeLaCollecte(client, 'c1')).toBeUndefined();
  });

  it('AG avec excédents → aucun nom ici (son document est l’attestation)', async () => {
    const { client } = clientSimule({
      data: { type: 'anti_gaspi', statut: 'cloturee', evenements: null },
      error: null,
    });
    expect(await nomFichierDuRapportDeLaCollecte(client, 'c1')).toBeUndefined();
  });

  it('collecte illisible (erreur, absente, exception) → aucun nom, jamais d’exception', async () => {
    for (const reponse of [
      { data: null, error: { message: 'permission denied' } },
      { data: null, error: null },
      new Error('réseau'),
    ]) {
      const { client } = clientSimule(reponse);
      expect(
        await nomFichierDuRapportDeLaCollecte(client, 'c1'),
      ).toBeUndefined();
    }
  });
});
