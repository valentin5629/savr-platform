/**
 * Cliquet — tout passage d'un event outbox en `dead` alerte, quelle que soit la
 * famille de `consumer`.
 *
 * §07/03 l.24 (précisé au sync CDC 2026-09-14) : `outbox_events.statut = 'dead'`
 * → alerte 🔴 critique **toutes familles de `consumer` confondues, `attribution_job`
 * inclus**. L'isolation par famille (migration 20260911150000) a deux
 * consommateurs — le worker logistique (`fn_claim_outbox_batch`) et le cron
 * d'attribution AG (`fn_claim_outbox_attribution_batch`) — et le second passait un
 * event en `dead` SANS alerte : un email d'attribution AG définitivement perdu
 * (association ou transporteur jamais prévenu) tombait en DLQ silencieuse.
 *
 * `scripts/check-primitive-orpheline.sh` (G8) ne voit pas ce trou : il compte les
 * call-sites de `sendAlert` dans le repo, pas leur couverture branche par branche —
 * un consommateur muet de plus reste invisible tant qu'un autre fichier appelle la
 * primitive. D'où ce cliquet, qui raisonne par ÉCRIVAIN de `dead` : un 3e
 * consommateur d'outbox ajouté demain sans alerte fait rougir la CI.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

const RACINE = resolve(__dirname, '../../../..');
// Racines de code de PRODUCTION (mêmes que G8) : les deux consommateurs d'outbox
// vivent l'un dans plateforme, l'autre dans adapters.
const RACINES_PROD = ['packages/plateforme/src', 'packages/adapters/src'].map(
  (p) => join(RACINE, p),
);

/** Toute écriture d'un statut via `fn_result_outbox` (les 3 quotes, retour à la ligne de Prettier toléré). */
const STATUT_ECRIT = /p_statut:\s*([^,\n}]+)/g;
/** Statuts littéraux que ce cliquet sait interpréter (cf. `outbox_statut_enum`). */
const LITTERAUX = new Set(
  ["'done'", "'failed'", "'dead'"].flatMap((v) => [
    v,
    v.replace(/'/g, '"'),
    v.replace(/'/g, '`'),
  ]),
);
const estDead = (v: string) => /^['"`]dead['"`]$/.test(v);
/** Primitive d'alerte DLQ partagée (définie dans packages/adapters/src/outbox-worker.ts). */
const ALERTE_DLQ = /\balertOutboxDead\b/;

function sourcesProd(dir: string): string[] {
  const out: string[] = [];
  for (const nom of readdirSync(dir)) {
    const chemin = join(dir, nom);
    if (statSync(chemin).isDirectory()) {
      if (nom === 'node_modules' || nom === 'tests' || nom === '__tests__')
        continue;
      out.push(...sourcesProd(chemin));
    } else if (/\.tsx?$/.test(nom) && !/\.(test|spec)\.tsx?$/.test(nom)) {
      out.push(chemin);
    }
  }
  return out;
}

/** Statuts écrits par un fichier, tels qu'ils apparaissent dans la source. */
function statutsEcrits(src: string): string[] {
  return [...src.matchAll(STATUT_ECRIT)].map((m) => m[1]!.trim());
}

const appelants = RACINES_PROD.flatMap(sourcesProd)
  .map((f) => ({ f, src: readFileSync(f, 'utf8'), rel: '' }))
  .filter(({ src }) => src.includes('fn_result_outbox'))
  .map((e) => ({ ...e, rel: e.f.slice(RACINE.length + 1) }));

const ecrivainsDead = appelants.filter(({ src }) =>
  statutsEcrits(src).some(estDead),
);

describe('DLQ outbox — alerte critique sur toutes les familles de consumer', () => {
  it('au moins les 2 consommateurs connus écrivent `dead` (garde anti-vacuité)', () => {
    expect(ecrivainsDead.length).toBeGreaterThanOrEqual(2);
    expect(ecrivainsDead.map(({ f }) => f).join('\n')).toMatch(
      /outbox-worker\.ts[\s\S]*process-attributions-ag|process-attributions-ag[\s\S]*outbox-worker\.ts/,
    );
  });

  // Le cliquet ne conclut que sur des statuts LITTÉRAUX : un `p_statut` calculé
  // (variable, ternaire) le rendrait aveugle en silence — il échoue alors en le disant.
  for (const { rel, src } of appelants) {
    const opaques = statutsEcrits(src).filter((v) => !LITTERAUX.has(v));
    it(`${rel} : écrit fn_result_outbox avec des statuts littéraux (sinon ce cliquet est aveugle)`, () => {
      expect(opaques).toEqual([]);
    });
  }

  for (const { rel, src } of ecrivainsDead) {
    it(`${rel} : passe un event en \`dead\` → doit émettre l'alerte DLQ (§07/03 l.24)`, () => {
      expect(ALERTE_DLQ.test(src)).toBe(true);
    });
  }
});
