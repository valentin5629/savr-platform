/**
 * SECU — `resetBusinessData()` et la garde d'immuabilité de `audit_log`.
 *
 * Ce que ce fichier verrouille, et pourquoi il ne suffit pas seul
 * ----------------------------------------------------------------
 * Depuis les migrations 20260921200000 / 20260922200000, `plateforme.audit_log`
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
 * L'ORACLE EST UNE ÉGALITÉ, PAS UNE RECHERCHE DE FRAGMENTS
 * ---------------------------------------------------------
 * Première version de ce fichier : `expect(requetes).toContain(...)` sur trois
 * sous-chaînes. Une revue adversariale a montré que ça ne prouvait rien
 * d'utile — en ajoutant `AND false` à la seule branche `ENABLE` de la boucle,
 * on obtenait une garde DÉFINITIVEMENT désactivée en base, ces 5 tests verts,
 * le pgTAP vert et `seed:check` vert. Les fragments cherchés étaient toujours
 * là ; c'est ce qui les entourait qui avait changé.
 *
 * L'oracle compare donc le SQL émis aux chaînes attendues à l'ÉGALITÉ (espaces
 * normalisés). Le texte attendu vient des fonctions exportées par le module —
 * pas d'une copie qui divergerait en silence — et les tests vérifient en plus
 * la FORME de ces fonctions, là où une copie ne dirait rien.
 *
 * CE QUI RESTE NON COUVERT ICI, ET POURQUOI C'EST ACCEPTABLE
 * -----------------------------------------------------------
 * Neutraliser la boucle pour les DEUX actions à la fois (`AND false` sans
 * distinction) passe encore ces 7 tests — l'égalité compare au SQL du module,
 * muté des deux côtés, et la symétrie ENABLE/DISABLE est préservée. Mesuré,
 * assumé : dans ce cas la garde n'est jamais désactivée, le vidage échoue en
 * `42501`, le ROLLBACK s'ensuit et la base reste PROTÉGÉE. Le seed casse
 * bruyamment, au premier lancement, chez le premier qui l'exécute.
 * C'est l'inverse exact de la mutation dangereuse (réactivation seule
 * neutralisée), qui laissait la base ouverte en silence : celle-là est
 * attrapée, par le test de symétrie ici et par l'assertion de sortie en base.
 *
 * La formule « on couvre le silencieux, pas le bruyant » serait trop flatteuse :
 * une revue adversariale a exhibé une mutation silencieuse NON couverte — deux
 * `AND false`, un dans la boucle et un dans l'assertion, laissant la base
 * ouverte avec sept tests verts. C'est ce qui a motivé l'égalité littérale sur
 * l'assertion plus bas. Ce qu'on peut dire honnêtement : le rempart est
 * désormais épinglé au caractère près, donc le neutraliser demande de modifier
 * une chaîne que ce fichier fige — et ça, ça rougit.
 *
 * Ce fichier ne touche PAS la base : il prouve la forme de la séquence, pas son
 * effet. Deux compléments indispensables :
 *   • `supabase/tests/SECU__audit_log_immuable.test.sql` T14/T15 — la séquence
 *     vide bien la table en base, et la garde mord de nouveau après ;
 *   • `sqlAssertionGardeActive()`, exécutée avant le COMMIT par `reset.ts` :
 *     c'est elle, et non ces tests, qui rend structurellement impossible de
 *     committer une base dont la garde serait restée désactivée. T16 prouve
 *     qu'elle lève réellement.
 */

import { describe, it, expect, vi } from 'vitest';
import type pg from 'pg';
import {
  resetBusinessData,
  sqlGardeAuditLog,
  sqlVidageTablesMetier,
  sqlAssertionGardeActive,
  GARDE_AUDIT_LOG,
} from './reset.js';

/** Espaces normalisés : l'oracle porte sur le SQL, pas sur son indentation. */
const sql = (s: string) => s.replace(/\s+/g, ' ').trim();

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

  it('émet EXACTEMENT la séquence attendue — égalité, pas fragments', async () => {
    const { client, requetes } = clientEspion();

    await resetBusinessData(client);

    // Égalité sur la séquence entière : une clause ajoutée dans l'une des
    // requêtes (le `AND false` de la revue) change la chaîne et rougit ici,
    // là où un `toContain` de sous-chaînes ne voyait rien.
    expect(requetes.map(sql)).toEqual([
      'BEGIN',
      sql(sqlGardeAuditLog('DISABLE')),
      sql(sqlVidageTablesMetier()),
      sql(sqlGardeAuditLog('ENABLE')),
      sql(sqlAssertionGardeActive()),
      'COMMIT',
    ]);
  });

  it('les deux actions ne diffèrent QUE par le verbe ENABLE/DISABLE', () => {
    // Le vecteur de la revue : neutraliser une seule des deux branches, par
    // exemple en n'ajoutant `AND false` qu'à `ENABLE`. Les deux SQL doivent
    // donc être identiques au verbe près — toute asymétrie est suspecte.
    const desactive = sql(sqlGardeAuditLog('DISABLE'));
    const reactive = sql(sqlGardeAuditLog('ENABLE'));

    expect(desactive.replace(/DISABLE/g, '<VERBE>')).toBe(
      reactive.replace(/ENABLE/g, '<VERBE>'),
    );
    expect(desactive).not.toBe(reactive);
  });

  it('l’assertion de sortie est épinglée au caractère près — c’est elle le rempart', () => {
    // Le SQL attendu est écrit EN DUR ici, pas dérivé du module : c'est la
    // seule façon d'épingler son contenu. Une comparaison à
    // `sqlAssertionGardeActive()` serait auto-référentielle — une mutation
    // changerait les deux côtés et passerait, ce qu'une revue adversariale a
    // mesuré : deux `AND false` bien placés (un dans la boucle, un dans
    // l'assertion) laissaient la base ouverte avec tous les tests verts.
    //
    // Ce test rougit donc au moindre changement de l'assertion — seuil,
    // sens de la comparaison, clause, message. C'est voulu : toute
    // modification du rempart doit être regardée par un humain. Si tu
    // arrives ici après avoir changé `sqlAssertionGardeActive()`
    // légitimement, vérifie d'abord que T16a/T16b passent toujours, puis
    // recopie la nouvelle chaîne.
    const ATTENDU =
      "DO $$ DECLARE n int; BEGIN SELECT count(*) INTO n FROM pg_trigger tg WHERE tg.tgname = 'trg_audit_log_vidage_interdit' AND NOT tg.tgisinternal AND tg.tgenabled <> 'O'; IF n > 0 THEN RAISE EXCEPTION 'reset seed : la garde % est restée désactivée sur % table(s) — transaction annulée', 'trg_audit_log_vidage_interdit', n; END IF; END $$;";

    expect(sql(sqlAssertionGardeActive())).toBe(ATTENDU);
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
    // L'assertion de sortie non plus n'est pas atteinte : c'est le ROLLBACK
    // qui protège ici, pas elle.
    expect(requetes.map(sql)).not.toContain(sql(sqlAssertionGardeActive()));
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
