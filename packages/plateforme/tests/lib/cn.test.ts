/**
 * cn() — fusion des classes custom `savr-*` (lib/utils).
 * Sans configuration, twMerge ne reconnaît pas `rounded-savr-*` / `shadow-savr-*` :
 * la surcharge `className="rounded-savr-lg"` sur <Card> (qui pose `rounded-savr-md`)
 * gardait les deux classes et `md` gagnait par l'ordre du CSS compilé.
 * Les tokens sont relus dans globals.css : un token ajouté au thème sans être
 * déclaré dans cn() fait échouer ce test.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { cn } from '../../src/lib/utils.js';

const css = readFileSync(
  fileURLToPath(new URL('../../src/app/globals.css', import.meta.url)),
  'utf8',
);

function tokens(prefix: string): string[] {
  const re = new RegExp(`--${prefix}-(savr-[a-z0-9]+):`, 'g');
  return [...new Set([...css.matchAll(re)].map((m) => m[1]!))];
}

/** Chaque paire de valeurs d'une échelle doit se fusionner : la dernière gagne seule. */
function expectScaleMerges(utility: string, values: string[]) {
  expect(values.length).toBeGreaterThan(1);
  for (const a of values) {
    for (const b of values) {
      if (a === b) continue;
      expect(cn(`${utility}-${a}`, `${utility}-${b}`)).toBe(`${utility}-${b}`);
    }
  }
}

describe('cn — échelles savr-* relues dans globals.css', () => {
  it('rayons : rounded-savr-* (et variantes par côté)', () => {
    const radius = tokens('radius');
    expect(radius).toEqual([
      'savr-sm',
      'savr-md',
      'savr-lg',
      'savr-xl',
      'savr-full',
    ]);
    for (const u of [
      'rounded',
      'rounded-t',
      'rounded-l',
      'rounded-r',
      'rounded-b',
    ]) {
      expectScaleMerges(u, radius);
    }
  });

  it('ombres : shadow-savr-*', () => {
    expectScaleMerges('shadow', tokens('shadow'));
  });

  it('espacements : p/m/gap-savr-*', () => {
    for (const u of ['p', 'px', 'm', 'gap'])
      expectScaleMerges(u, tokens('spacing'));
  });

  it('conteneurs : max-w-savr-*', () => {
    expectScaleMerges('max-w', tokens('container'));
  });
});

describe('cn — surcharges réelles', () => {
  it('Card rounded-savr-md surchargée en rounded-savr-lg', () => {
    expect(cn('rounded-savr-md border bg-card', 'rounded-savr-lg')).toBe(
      'border bg-card rounded-savr-lg',
    );
  });

  it('mélange échelle Tailwind et échelle savr', () => {
    expect(cn('rounded-md', 'rounded-savr-lg')).toBe('rounded-savr-lg');
    expect(cn('rounded-savr-lg', 'rounded-none')).toBe('rounded-none');
    expect(cn('shadow-sm', 'shadow-savr-md')).toBe('shadow-savr-md');
    expect(cn('p-4', 'p-savr-6')).toBe('p-savr-6');
  });

  it('une ombre savr ne supprime pas une couleur d’ombre (groupes distincts)', () => {
    expect(cn('shadow-savr-md', 'shadow-savr-primary-500/20')).toBe(
      'shadow-savr-md shadow-savr-primary-500/20',
    );
  });

  it('couleurs savr : taille et couleur de texte coexistent, deux couleurs fusionnent', () => {
    expect(cn('text-sm text-savr-neutral-500', 'text-savr-primary-700')).toBe(
      'text-sm text-savr-primary-700',
    );
  });

  it('variantes et côtés indépendants conservés', () => {
    expect(cn('rounded-savr-md', 'hover:rounded-savr-lg')).toBe(
      'rounded-savr-md hover:rounded-savr-lg',
    );
    expect(cn('rounded-savr-md', 'rounded-t-savr-lg')).toBe(
      'rounded-savr-md rounded-t-savr-lg',
    );
  });
});
