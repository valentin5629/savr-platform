/**
 * SECU — `resetBusinessData()` et la garde d'immuabilité de `audit_log`.
 *
 * Ce que ce fichier verrouille, et pourquoi il ne suffit pas seul
 * ----------------------------------------------------------------
 * Depuis les migrations 20260921200000 / 20260921210000, `plateforme.audit_log`
 * refuse UPDATE, DELETE et vidage de table. Or le reset du seed vide les tables
 * métier, `audit_log` comprise — il échouait donc en `42501`, à la toute
 * première instruction de `pnpm seed:minimal` / `seed:demo`.
 *
 * `reset.ts` neutralise la garde le temps du vidage puis la réactive. Deux
 * propriétés doivent tenir, et une régression sur l'une ou l'autre est
 * silencieuse jusqu'à ce qu'un seed casse ou qu'une base reste ouverte :
 *
 *   1. la garde est désactivée AVANT le vidage et réactivée APRÈS ;
 *   2. si le vidage échoue, la désactivation est ANNULÉE — c'est le ROLLBACK
 *      qui s'en charge, pas un `ENABLE` de rattrapage, lequel ne serait de
 *      toute façon jamais atteint.
 *
 * L'oracle porte sur le SQL RÉELLEMENT émis : le test importe les mêmes
 * fonctions (`sqlGardeAuditLog`, `sqlVidageTablesMetier`) que le code de
 * production, plutôt que d'en recopier le texte — une copie divergerait en
 * silence le jour où `reset.ts` changerait.
 *
 * Ce fichier ne touche PAS la base : il prouve la forme de la séquence, pas son
 * effet. La preuve d'effet est `supabase/tests/SECU__audit_log_immuable.test.sql`
 * T14, qui rejoue la séquence en base et vérifie que la table se vide et que la
 * garde mord de nouveau ensuite. Les deux sont nécessaires.
 */

import { describe, it, expect, vi } from 'vitest';
import type pg from 'pg';
import {
  resetBusinessData,
  sqlGardeAuditLog,
  sqlVidageTablesMetier,
  GARDE_AUDIT_LOG,
} from './reset.js';

/** Client `pg` minimal qui enregistre les requêtes, dans l'ordre. */
function clientEspion(options: { echoueSurVidage?: boolean } = {}) {
  const requetes: string[] = [];
  const client = {
    query: vi.fn(async (sql: string) => {
      requetes.push(sql);
      if (
        options.echoueSurVidage &&
        sql.includes(' RESTART IDENTITY CASCADE')
      ) {
        const err = new Error(
          'plateforme.audit_log est append-only : TRUNCATE interdit',
        ) as Error & { code?: string };
        err.code = '42501';
        throw err;
      }
      return { rows: [], rowCount: 0 };
    }),
  } as unknown as pg.Client;
  return { client, requetes };
}

const estVidage = (sql: string) => sql.includes(' RESTART IDENTITY CASCADE');
const estDesactivation = (sql: string) =>
  sql.includes(`DISABLE TRIGGER ${GARDE_AUDIT_LOG}`);
const estReactivation = (sql: string) =>
  sql.includes(`ENABLE TRIGGER ${GARDE_AUDIT_LOG}`);

describe('resetBusinessData — garde d’immuabilité de audit_log', () => {
  it('désactive la garde AVANT le vidage et la réactive APRÈS, dans une transaction', async () => {
    const { client, requetes } = clientEspion();

    await resetBusinessData(client);

    const iDisable = requetes.findIndex(estDesactivation);
    const iVidage = requetes.findIndex(estVidage);
    const iEnable = requetes.findIndex(estReactivation);

    // Les trois ordres existent…
    expect(
      iDisable,
      'désactivation de la garde absente',
    ).toBeGreaterThanOrEqual(0);
    expect(iVidage, 'vidage des tables métier absent').toBeGreaterThanOrEqual(
      0,
    );
    expect(iEnable, 'réactivation de la garde absente').toBeGreaterThanOrEqual(
      0,
    );
    // …et dans cet ordre.
    expect(iDisable).toBeLessThan(iVidage);
    expect(iVidage).toBeLessThan(iEnable);

    // Le tout encadré par une transaction : sans elle, un échec laisserait la
    // garde désactivée en base.
    expect(requetes[0]).toBe('BEGIN');
    expect(requetes.at(-1)).toBe('COMMIT');
    expect(requetes).not.toContain('ROLLBACK');
  });

  it('émet exactement le SQL du module, pas une copie', async () => {
    const { client, requetes } = clientEspion();

    await resetBusinessData(client);

    expect(requetes).toContain(sqlGardeAuditLog('DISABLE'));
    expect(requetes).toContain(sqlVidageTablesMetier());
    expect(requetes).toContain(sqlGardeAuditLog('ENABLE'));
  });

  it('vide bien audit_log — la table doit être dans le lot, pas contournée', () => {
    // Retirer `audit_log` de la liste serait le réflexe naturel pour éviter la
    // garde. Ça ne marche pas : ses deux FK vers `users` la ramènent par le
    // CASCADE, et le seed échouerait quand même. On verrouille donc sa présence.
    expect(sqlVidageTablesMetier()).toContain('plateforme.audit_log');
  });

  it('ROLLBACK si le vidage échoue — la garde ne reste jamais désactivée', async () => {
    const { client, requetes } = clientEspion({ echoueSurVidage: true });

    await expect(resetBusinessData(client)).rejects.toThrow(/append-only/);

    expect(requetes).toContain('ROLLBACK');
    expect(requetes).not.toContain('COMMIT');
    // La réactivation n'est PAS atteinte : c'est le ROLLBACK qui annule la
    // désactivation. Si un jour on la déplaçait dans un `finally`, elle
    // s'exécuterait hors transaction et ce test le signalerait.
    expect(requetes.some(estReactivation)).toBe(false);
  });

  it('la garde est pilotée par pg_trigger — no-op avant migration, suit les partitions', () => {
    // La boucle porte sur le catalogue, pas sur une liste de tables en dur :
    // c'est ce qui rend le reset insensible à l'ajout d'une partition annuelle,
    // et inoffensif sur une base où la migration n'est pas encore appliquée.
    for (const action of ['ENABLE', 'DISABLE'] as const) {
      const sql = sqlGardeAuditLog(action);
      expect(sql).toContain('FROM pg_trigger');
      expect(sql).toContain(`tg.tgname = '${GARDE_AUDIT_LOG}'`);
      expect(sql).toContain('NOT tg.tgisinternal');
      expect(sql).not.toContain('audit_log_2026');
    }
  });
});
