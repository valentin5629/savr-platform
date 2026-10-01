/**
 * Clients organisateurs de seed_demo — ce que la colonne « Client » et le filtre
 * « Client organisateur » des listes Collectes ont besoin de trouver en base.
 *
 * Sans base de données : `seedDemo` tourne sur un client pg factice, et on lit
 * les lignes qu'il aurait écrites dans `plateforme.evenements`. C'est la colonne
 * réellement insérée qui est vérifiée, pas seulement la fonction de tirage — une
 * ligne perdue dans `demo.ts` ferait rougir ces tests.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type pg from 'pg';
import { seedDemo } from './demo.js';
import { seedUuid } from './uuid.js';
import {
  CLIENTS_ORGANISATEURS_SEED,
  clientOrganisateurSeed,
} from './clients-organisateurs.js';

const ANCRE = '2026-10-01';
const NOMS: readonly string[] = CLIENTS_ORGANISATEURS_SEED;

type Evenement = Record<string, unknown>;
let colonnes: string[] = [];
const evenements: Evenement[] = [];

const clientsDe = (evts: Evenement[]): Set<unknown> =>
  new Set(
    evts.map((e) => e['nom_client_organisateur']).filter((nom) => nom !== null),
  );

beforeAll(async () => {
  vi.stubEnv('SEED_TODAY', ANCRE);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  // Référentiel seedé par les migrations : le strict nécessaire pour que
  // `seedDemo` atteigne l'écriture des événements.
  const referentiel: [RegExp, Record<string, string>[]][] = [
    [/grilles_tarifaires_zd/, [{ id: 'grille', nom: 'Grille standard V1' }]],
    [
      /from plateforme\.types_evenements/,
      [
        { code: 'cocktail_repas_complet', id: 'type_zd' },
        { code: 'repas_assis', id: 'type_ag' },
      ],
    ],
  ];
  // On s'arrête dès les événements écrits : ce que `seedDemo` pose ensuite
  // (collectes, tournées, factures…) est hors sujet, et simuler le référentiel
  // que cette suite relit lierait ce test à des lots qui ne le concernent pas.
  class EvenementsEcrits extends Error {}
  const client = {
    query: (sql: string, params: unknown[] = []) => {
      if (sql.startsWith('INSERT INTO plateforme.evenements ')) {
        colonnes = /\(([^)]+)\) VALUES/.exec(sql)![1]!.split(', ');
        for (let i = 0; i < params.length; i += colonnes.length) {
          evenements.push(
            Object.fromEntries(colonnes.map((c, k) => [c, params[i + k]])),
          );
        }
        return Promise.reject(new EvenementsEcrits());
      }
      const rows = referentiel.find(([re]) => re.test(sql))?.[1] ?? [];
      return Promise.resolve({ rows });
    },
  };
  await expect(seedDemo(client as unknown as pg.Client)).rejects.toBeInstanceOf(
    EvenementsEcrits,
  );
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('clients organisateurs — tirage', () => {
  it('SEED-CO-1 — un même slug donne toujours le même client', () => {
    for (const slug of ['col_zd_0001', 'col_ag_0042', 'viv_2026-09-30_1']) {
      expect(clientOrganisateurSeed(slug)).toBe(clientOrganisateurSeed(slug));
    }
  });

  it('SEED-CO-2 — la liste est courte et sans doublon', () => {
    expect(NOMS.length).toBeLessThanOrEqual(10);
    expect(new Set(NOMS).size).toBe(NOMS.length);
  });
});

describe('clients organisateurs — ce que seed_demo écrit en base', () => {
  it('SEED-CO-3 — la colonne est écrite, avec des noms de la liste seulement', () => {
    expect(colonnes).toContain('nom_client_organisateur');
    expect(evenements.length).toBeGreaterThan(478);
    for (const nom of clientsDe(evenements)) expect(NOMS).toContain(nom);
  });

  it('SEED-CO-4 — une majorité est renseignée, mais des lignes restent vides', () => {
    const renseignes = evenements.filter(
      (e) => typeof e['nom_client_organisateur'] === 'string',
    );
    const part = renseignes.length / evenements.length;
    expect(part).toBeGreaterThan(0.6);
    expect(part).toBeLessThan(0.8);
  });

  it('SEED-CO-5 — chaque client revient sur plusieurs événements (le filtre a du sens)', () => {
    for (const nom of NOMS) {
      const n = evenements.filter(
        (e) => e['nom_client_organisateur'] === nom,
      ).length;
      expect(n, nom).toBeGreaterThanOrEqual(10);
    }
  });

  it('SEED-CO-6 — l’agence voit plusieurs clients, et des lignes sans client', () => {
    const agence = evenements.filter(
      (e) => e['organisation_id'] === seedUuid('org_ag_caromy'),
    );
    expect(clientsDe(agence).size).toBeGreaterThanOrEqual(4);
    expect(agence.some((e) => e['nom_client_organisateur'] === null)).toBe(
      true,
    );
  });

  it('SEED-CO-7 — chaque traiteur voit plusieurs clients, et des lignes sans client', () => {
    const traiteurs = new Set(
      evenements.map((e) => e['traiteur_operationnel_organisation_id']),
    );
    expect(traiteurs.size).toBeGreaterThanOrEqual(7);
    for (const traiteur of traiteurs) {
      const siens = evenements.filter(
        (e) => e['traiteur_operationnel_organisation_id'] === traiteur,
      );
      expect(clientsDe(siens).size, String(traiteur)).toBeGreaterThanOrEqual(4);
      expect(
        siens.some((e) => e['nom_client_organisateur'] === null),
        String(traiteur),
      ).toBe(true);
    }
  });

  it('SEED-CO-8 — le rattachement à un compte client (réservé Admin) n’est pas posé', () => {
    expect(colonnes).not.toContain('client_organisateur_organisation_id');
  });
});
