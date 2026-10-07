/**
 * R-UI-0 — garde-fou B1 : toute classe `*-savr-*` du code référence un token
 * défini dans `app/globals.css` (`--color-savr-*`, `--radius-savr-*`,
 * `--shadow-savr-*`, `--transition-duration-savr-*` pour `duration-savr-*`,
 * R-UI-6a). Une classe vers un token inexistant (ex.
 * `text-savr-success-600`) ne produit AUCUN style : le texte s'affiche sans
 * couleur, sans erreur de build ni de lint. Ce test rend le cas impossible.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(__dirname, '..');
const SCAN = ['app', 'components', 'lib'].map((d) => join(SRC, d));

const UTILS_COULEUR =
  'bg|text|border(?:-[trblxyse]+)?|ring|ring-offset|inset-ring|outline|fill|stroke|from|via|to|divide|placeholder|decoration|accent|caret|shadow';
const CLASSE_RE = new RegExp(
  `(?<![\\w-])(${UTILS_COULEUR}|rounded(?:-[a-z]{1,2})?|duration)-savr-([a-z0-9]+(?:-[a-z0-9]+)*)`,
  'g',
);
const VAR_RE =
  /var\(--(color|radius|shadow|transition-duration)-savr-([a-z0-9-]+)\)/g;

function tokensDefinis(): Set<string> {
  const css = readFileSync(join(SRC, 'app/globals.css'), 'utf8');
  const defs = new Set<string>();
  for (const m of css.matchAll(
    /--(color|radius|shadow|transition-duration)-savr-([a-z0-9-]+)\s*:/g,
  ))
    defs.add(`${m[1]}:${m[2]}`);
  return defs;
}

function fichiers(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      fichiers(full, out);
    } else if (
      /\.(ts|tsx)$/.test(entry) &&
      !/\.(test|spec)\.(ts|tsx)$/.test(entry)
    ) {
      out.push(full);
    }
  }
}

describe('R-UI-0 — tokens Design System référencés par le code', () => {
  it('chaque classe *-savr-* et chaque var(--*-savr-*) désigne un token défini dans globals.css', () => {
    const defs = tokensDefinis();
    expect(defs.size).toBeGreaterThan(20);

    const files: string[] = [];
    for (const d of SCAN) fichiers(d, files);
    const manquants: string[] = [];

    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(CLASSE_RE)) {
        const util = m[1]!;
        const suffixe = m[2]!;
        const famille = util.startsWith('rounded')
          ? 'radius'
          : util === 'duration'
            ? 'transition-duration'
            : util === 'shadow' && defs.has(`shadow:${suffixe}`)
              ? 'shadow'
              : 'color';
        if (!defs.has(`${famille}:${suffixe}`))
          manquants.push(
            `${relative(SRC, f)} : ${m[0]} (--${famille}-savr-${suffixe})`,
          );
      }
      for (const m of src.matchAll(VAR_RE)) {
        if (!defs.has(`${m[1]}:${m[2]}`))
          manquants.push(`${relative(SRC, f)} : ${m[0]}`);
      }
    }

    expect(
      manquants,
      `Classe(s) vers un token inexistant (aucun style produit) :\n${manquants.join('\n')}`,
    ).toEqual([]);
  });
});
