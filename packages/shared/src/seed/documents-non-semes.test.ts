/**
 * seed_demo ne sème aucun document de collecte (attestation de don, bordereau,
 * rapport de recyclage).
 *
 * Une ligne « émise » sans PDF semée par le seed laissait le bouton de
 * téléchargement sans fichier, et les batchs J+1 sautaient la collecte en la
 * croyant déjà traitée (mesuré sur savr-dev le 2026-10-28 : 224 attestations
 * et 393 bordereaux émis, aucun PDF). Sur savr-dev, `pnpm documents:dev` les
 * fabrique par le flux réel.
 *
 * Sans base de données : `seedDemo` tourne en entier sur un client pg factice,
 * et on relève toutes les tables où il insère.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type pg from 'pg';
import { seedDemo } from './demo.js';

const ANCRE = '2026-10-01';
const DOCUMENTS = [
  'plateforme.attestations_don',
  'plateforme.bordereaux_savr',
  'plateforme.rapports_rse',
  'plateforme.jobs_pdf',
];

const tablesEcrites = new Set<string>();
let fini = false;

beforeAll(async () => {
  vi.stubEnv('SEED_TODAY', ANCRE);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  // Référentiel posé par les migrations, que `seedDemo` relit.
  const referentiel: [RegExp, Record<string, string>[]][] = [
    [/grilles_tarifaires_zd/, [{ id: 'grille', nom: 'Grille standard V1' }]],
    [
      /from plateforme\.flux_dechets/,
      ['biodechet', 'carton', 'emballage', 'verre', 'dechet_residuel'].map(
        (code) => ({ code, id: `flux_${code}` }),
      ),
    ],
    [
      /from plateforme\.types_evenements/,
      [
        { code: 'cocktail_repas_complet', id: 'type_zd' },
        { code: 'repas_assis', id: 'type_ag' },
      ],
    ],
  ];
  const client = {
    query: (sql: string) => {
      const table = /^\s*INSERT INTO (\S+)/i.exec(sql)?.[1];
      if (table) tablesEcrites.add(table);
      const rows = referentiel.find(([re]) => re.test(sql))?.[1] ?? [];
      return Promise.resolve({ rows, rowCount: rows.length });
    },
  };
  await seedDemo(client as unknown as pg.Client);
  fini = true;
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('seed_demo — documents de collecte', () => {
  it('SEED-DOC-1 — le seed va jusqu’au bout (le relevé couvre toutes ses écritures)', () => {
    expect(fini).toBe(true);
    expect(tablesEcrites).toContain('plateforme.collectes');
    expect(tablesEcrites).toContain('plateforme.exports_registre');
  });

  it('SEED-DOC-2 — aucune attestation, aucun bordereau, aucun rapport, aucun PDF en file', () => {
    for (const table of DOCUMENTS)
      expect(tablesEcrites, table).not.toContain(table);
  });
});
