// M0.6 — état réel de l'ordre d'envoi d'une collecte (décision Val 2026-10-12, C6).
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { getNextRetryAt } from '@savr/adapters/src/outbox-worker.js';

import {
  TENTATIVES_MAX_ORDRE,
  deriverOrdreEnvoi,
  type LigneOrdre,
} from './ordre-envoi.js';

function ligne(over: Partial<LigneOrdre>): LigneOrdre {
  return {
    seq: 1,
    event_type: 'collecte.creee',
    statut: 'pending',
    consumer: 'adapter_mts1',
    attempts: 0,
    next_retry_at: null,
    last_error: null,
    ...over,
  };
}

describe("M0.6 / ordre d'envoi — ordre de tête de la collecte", () => {
  it("M0.6/ordre_envoi_tete — rend le plus ancien ordre non terminé, quel que soit l'ordre des lignes lues", () => {
    const ordre = deriverOrdreEnvoi([
      ligne({ seq: 77, statut: 'pending' }),
      ligne({ seq: 12, statut: 'done' }),
      ligne({
        seq: 72,
        statut: 'failed',
        attempts: 2,
        next_retry_at: '2026-10-12T09:35:00Z',
        last_error: '  503 Service Unavailable  ',
      }),
    ]);

    expect(ordre).toEqual({
      etat: 'echec_reprise',
      nature: 'creation',
      tentatives: 2,
      prochaine_tentative_at: '2026-10-12T09:35:00Z',
      erreur: '503 Service Unavailable',
    });
  });

  it('plus rien en file (aucune ligne, ou toutes terminées) : null', () => {
    expect(deriverOrdreEnvoi([])).toBeNull();
    expect(
      deriverOrdreEnvoi([
        ligne({ statut: 'done' }),
        ligne({ seq: 2, statut: 'done' }),
      ]),
    ).toBeNull();
  });

  it("un job d'attribution (autre famille) n'est jamais l'ordre de tête, même plus ancien et non terminé", () => {
    const ordre = deriverOrdreEnvoi([
      ligne({
        seq: 1,
        event_type: 'attribution.validee',
        consumer: 'attribution_job',
        statut: 'failed',
      }),
      ligne({ seq: 2, consumer: null, statut: 'processing', attempts: 1 }),
    ]);

    expect(ordre?.etat).toBe('en_cours');
    expect(ordre?.tentatives).toBe(1);
  });

  it.each([
    ['pending', 'en_attente'],
    ['processing', 'en_cours'],
    ['failed', 'echec_reprise'],
    ['dead', 'echec_definitif'],
  ])('statut %s → état %s', (statut, etat) => {
    expect(deriverOrdreEnvoi([ligne({ statut })])?.etat).toBe(etat);
  });

  it.each([
    ['collecte.creee', 'creation'],
    ['collecte.modifiee', 'modification'],
    ['collecte.annulee', 'annulation'],
  ])('ordre %s → nature %s', (eventType, nature) => {
    expect(deriverOrdreEnvoi([ligne({ event_type: eventType })])?.nature).toBe(
      nature,
    );
  });

  it("la prochaine tentative n'est rendue que pour un ordre en échec avec reprise", () => {
    const date = '2026-10-12T09:35:00Z';
    expect(
      deriverOrdreEnvoi([ligne({ statut: 'failed', next_retry_at: date })])
        ?.prochaine_tentative_at,
    ).toBe(date);
    for (const statut of ['pending', 'processing', 'dead']) {
      expect(
        deriverOrdreEnvoi([ligne({ statut, next_retry_at: date })])
          ?.prochaine_tentative_at,
      ).toBeNull();
    }
  });

  it("l'erreur est tronquée à 200 caractères, et absente quand elle est vide", () => {
    expect(
      deriverOrdreEnvoi([
        ligne({ statut: 'dead', last_error: 'x'.repeat(450) }),
      ])?.erreur,
    ).toHaveLength(200);
    expect(
      deriverOrdreEnvoi([ligne({ statut: 'dead', last_error: '   ' })])?.erreur,
    ).toBeNull();
  });

  it("M0.6/ordre_envoi_predicat_sql — l'ordre de tête suit le prédicat de la réservation SQL : si elle change, cette lib est à revoir", () => {
    // Dernière définition de la réservation ciblée. `deriverOrdreEnvoi` en
    // recopie trois règles : famille logistique seule, tout statut autre que
    // `done` bloque (dead compris), ordre de la file = `seq` croissant.
    const dossier = path.resolve(__dirname, '../../../../supabase/migrations');
    const definition = readdirSync(dossier)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .reverse()
      .map((f) => readFileSync(path.join(dossier, f), 'utf8'))
      .find((sql) =>
        sql.includes(
          'CREATE OR REPLACE FUNCTION plateforme.fn_claim_outbox_collecte(',
        ),
      );
    expect(definition).toBeDefined();
    const corps = definition!.slice(
      definition!.indexOf(
        'CREATE OR REPLACE FUNCTION plateforme.fn_claim_outbox_collecte(',
      ),
    );
    expect(corps).toContain(
      "AND e.consumer IS DISTINCT FROM 'attribution_job'",
    );
    expect(corps).toContain("AND e2.statut <> 'done'");
    expect(corps).toContain(
      "AND e2.consumer IS DISTINCT FROM 'attribution_job'",
    );
    expect(corps).toContain('ORDER BY e.seq');
  });

  it('le nombre de tentatives affiché suit la politique de reprise du worker', () => {
    // Après la dernière tentative, le worker ne planifie plus rien ; avant, si.
    expect(getNextRetryAt(TENTATIVES_MAX_ORDRE)).toBeNull();
    expect(getNextRetryAt(TENTATIVES_MAX_ORDRE - 1)).not.toBeNull();
  });
});
