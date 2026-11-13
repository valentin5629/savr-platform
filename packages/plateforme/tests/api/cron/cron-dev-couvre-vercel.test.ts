/**
 * Cliquet — dev réagit comme la production (décision Val 2026-11-13).
 *
 * Vercel ne lance les crons que sur la production ; sur dev, le workflow GitHub
 * `cron-dev.yml` les appelle à sa place. Un cron ajouté demain à vercel.json
 * sans être ajouté au workflow ne tournerait jamais sur dev : ce test le fait
 * rougir. Il vérifie aussi que chaque planification du workflow a sa branche
 * dans l'aiguillage (sinon le passage finit en « planification inconnue »).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const racine = resolve(__dirname, '../../../../..');
const vercel = JSON.parse(
  readFileSync(resolve(racine, 'packages/plateforme/vercel.json'), 'utf8'),
) as { crons: Array<{ path: string }> };
const workflow = readFileSync(
  resolve(racine, '.github/workflows/cron-dev.yml'),
  'utf8',
);

const CRONS = vercel.crons.map((c) => c.path.replace(/^\/api\/cron\//, ''));

// Listes nommées du script (`cinq='a b c'`).
const listes = new Map<string, string[]>();
for (const m of workflow.matchAll(/^\s*([a-z]+)='([a-z0-9 -]+)'\s*$/gm)) {
  listes.set(m[1]!, m[2]!.trim().split(/\s+/));
}

// Planifications déclarées sous `on.schedule`.
const planifications = [
  ...workflow.matchAll(/^\s*- cron: '([^']+)'\s*$/gm),
].map((m) => m[1]!);

// Branches de l'aiguillage : `'<planification>') routes=<valeur> ;;`.
function routesDe(planif: string): string[] | null {
  const echappe = planif.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = workflow.match(
    new RegExp(`^\\s*'${echappe}'\\)\\s+routes=([^;]+);;`, 'm'),
  );
  if (!m) return null;
  const valeur = m[1]!.trim();
  const nom = valeur.match(/^\$([a-z]+)$/);
  if (nom) return listes.get(nom[1]!) ?? null;
  return valeur.replace(/^'|'$/g, '').split(/\s+/);
}

describe('cron-dev.yml couvre les crons de vercel.json', () => {
  it('le workflow déclare au moins une planification', () => {
    expect(planifications.length).toBeGreaterThan(0);
  });

  it.each(planifications)('la planification %s a sa branche', (planif) => {
    expect(routesDe(planif)).not.toBeNull();
  });

  it('chaque cron de vercel.json est appelé par une planification', () => {
    const appelees = new Set(planifications.flatMap((p) => routesDe(p) ?? []));
    const oubliees = CRONS.filter((c) => !appelees.has(c));
    expect(oubliees).toEqual([]);
  });

  it("aucune route appelée n'est absente de vercel.json", () => {
    const appelees = planifications.flatMap((p) => routesDe(p) ?? []);
    expect(appelees.filter((r) => !CRONS.includes(r))).toEqual([]);
  });
});
