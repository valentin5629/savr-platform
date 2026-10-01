/**
 * Attestations de don de seed_demo — elles portent ce que porte l'attribution
 * de la même collecte, comme en flux réel (batch J+1 puis
 * `trg_regenerer_attestation`).
 *
 * Le gestionnaire de lieux ne lit pas l'attribution d'une collecte programmée
 * par un traiteur tiers (`aa_select`) : il lit les repas donnés dans
 * l'attestation. Si le seed recalcule ce nombre de son côté, le traiteur et le
 * gestionnaire voient deux nombres différents pour une même collecte.
 *
 * Sans base de données : `seedDemo` tourne sur un client pg factice, et on lit
 * les lignes qu'il aurait écrites. Ce sont les colonnes réellement insérées
 * qui sont comparées, pas une fonction de calcul.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type pg from 'pg';
import { seedDemo } from './demo.js';
import { seedUuid } from './uuid.js';

const ANCRE = '2026-10-01';

type Ligne = Record<string, unknown>;
const collectes: Ligne[] = [];
const attributions: Ligne[] = [];
const attestations: Ligne[] = [];
const ecrites = new Map<string, Ligne[]>([
  ['plateforme.collectes', collectes],
  ['plateforme.attributions_antgaspi', attributions],
  ['plateforme.attestations_don', attestations],
]);

const attributionDe = (attestation: Ligne): Ligne | undefined =>
  attributions.find((a) => a['collecte_id'] === attestation['collecte_id']);

beforeAll(async () => {
  vi.stubEnv('SEED_TODAY', ANCRE);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  // Référentiel seedé par les migrations : le strict nécessaire pour que
  // `seedDemo` atteigne l'écriture des attestations.
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
  // On s'arrête dès les attestations écrites : ce que `seedDemo` pose ensuite
  // (tournées, factures…) est hors sujet, et simuler le référentiel que cette
  // suite relit lierait ce test à des lots qui ne le concernent pas.
  class AttestationsEcrites extends Error {}
  const client = {
    query: (sql: string, params: unknown[] = []) => {
      const insert =
        /^INSERT INTO (\S+) \(([^)]+)\) VALUES (.+) ON CONFLICT/.exec(sql);
      const cible = insert ? ecrites.get(insert[1]!) : undefined;
      if (cible) {
        const colonnes = insert![2]!.split(', ');
        // Chaque valeur est lue par son numéro de paramètre (`$12`), pas par sa
        // position dans `params` : une valeur écrite en dur dans le SQL
        // (`DEFAULT`) ne consomme aucun paramètre et décalerait les suivantes.
        for (const [, ligne] of insert![3]!.matchAll(/\(([^)]*)\)/g)) {
          const valeurs = ligne!.split(', ').map((valeur) => {
            const numero = /^\$(\d+)/.exec(valeur)?.[1];
            return numero ? params[Number(numero) - 1] : undefined;
          });
          cible.push(
            Object.fromEntries(colonnes.map((c, k) => [c, valeurs[k]])),
          );
        }
      } else if (attestations.length > 0) {
        return Promise.reject(new AttestationsEcrites());
      }
      const rows = referentiel.find(([re]) => re.test(sql))?.[1] ?? [];
      return Promise.resolve({ rows });
    },
  };
  await expect(seedDemo(client as unknown as pg.Client)).rejects.toBeInstanceOf(
    AttestationsEcrites,
  );
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('attestations de don — ce que seed_demo écrit en base', () => {
  it('SEED-ATT-1 — une attestation par collecte AG clôturée, ni plus ni moins', () => {
    const agCloturees = collectes
      .filter((c) => c['type'] === 'anti_gaspi' && c['statut'] === 'cloturee')
      .map((c) => c['id']);
    expect(agCloturees.length).toBeGreaterThan(100);
    expect(attestations.map((a) => a['collecte_id']).sort()).toEqual(
      agCloturees.sort(),
    );
  });

  it('SEED-ATT-2 — les repas de l’attestation sont ceux de l’attribution de la même collecte', () => {
    for (const att of attestations) {
      const attribution = attributionDe(att);
      expect(attribution, String(att['collecte_id'])).toBeDefined();
      expect(att['nb_repas'], String(att['collecte_id'])).toBe(
        attribution!['volume_repas_realise'],
      );
    }
  });

  it('SEED-ATT-3 — ces repas sont un vrai volume, qui varie d’une collecte à l’autre', () => {
    const repas = attestations.map((a) => a['nb_repas']);
    for (const n of repas) {
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThan(0);
    }
    expect(new Set(repas).size).toBeGreaterThan(20);
  });

  it('SEED-ATT-4 — l’attestation nomme l’association de l’attribution, et la mention fiscale la suit', () => {
    const habilitees = [seedUuid('asso_alpha'), seedUuid('asso_charlie')];
    for (const att of attestations) {
      const association = attributionDe(att)?.['association_id'];
      expect(att['association_id'], String(att['collecte_id'])).toBe(
        association,
      );
      expect(att['mention_fiscale_2041ge'], String(att['collecte_id'])).toBe(
        habilitees.includes(association as string),
      );
    }
    // Les deux cas de la règle 2041-GE restent représentés.
    const mentions = new Set(
      attestations.map((a) => a['mention_fiscale_2041ge']),
    );
    expect(mentions).toEqual(new Set([true, false]));
  });
});
