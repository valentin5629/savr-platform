/**
 * Cliquet — `/dev/*` n'existe pas dans un build de production.
 *
 * Le middleware rend `/dev` public (smoke-tests de composants en `next dev`). Sans
 * garde, toute page ajoutée sous `src/app/dev/` serait publique en prod. Le layout
 * `src/app/dev/layout.tsx` répond 404 dès que NODE_ENV=production.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import { isHTTPAccessFallbackError } from 'next/dist/client/components/http-access-fallback/http-access-fallback.js';
import { describe, it, expect, afterEach, vi } from 'vitest';

import DevLayout from '@/app/dev/layout.js';

const DEV_DIR = resolve(__dirname, '../../src/app/dev');

afterEach(() => vi.unstubAllEnvs());

describe('/dev/* — 404 en production', () => {
  it('le layout vit à la racine de src/app/dev (couvre toutes les pages)', () => {
    expect(existsSync(join(DEV_DIR, 'layout.tsx'))).toBe(true);
  });

  it('garde anti-vacuité : des pages existent sous /dev', () => {
    const pages: string[] = [];
    const walk = (dir: string): void => {
      for (const nom of readdirSync(dir)) {
        const p = join(dir, nom);
        if (statSync(p).isDirectory()) walk(p);
        else if (/^page\.(tsx|ts|jsx|js)$/.test(nom)) pages.push(p);
      }
    };
    walk(DEV_DIR);
    expect(pages.length).toBeGreaterThan(0);
  });

  it('NODE_ENV=production → notFound() (404)', () => {
    vi.stubEnv('NODE_ENV', 'production');
    let erreur: unknown;
    try {
      DevLayout({ children: 'contenu' });
    } catch (e) {
      erreur = e;
    }
    expect(isHTTPAccessFallbackError(erreur)).toBe(true);
    expect((erreur as { digest: string }).digest).toMatch(/;404$/);
  });

  it.each(['development', 'test'])('NODE_ENV=%s → rendu', (env) => {
    vi.stubEnv('NODE_ENV', env);
    expect(DevLayout({ children: 'contenu' })).toBe('contenu');
  });
});

// Les deux régressions qui contourneraient le layout (revue sécurité 2026-09-11) :
// un route handler ne traverse AUCUN layout, et un segment `dev` ouvert ailleurs
// (route group) servirait `/dev/*` sans passer par celui-ci.
describe('/dev/* — aucune échappatoire au layout', () => {
  const APP = resolve(__dirname, '../../src/app');

  // Pathname URL d'un répertoire de l'App Router : les route groups `(x)` et les
  // slots `@x` ne produisent pas de segment.
  const pathnameDe = (dir: string): string =>
    '/' +
    relative(APP, dir)
      .split(sep)
      .filter((s) => s && !s.startsWith('(') && !s.startsWith('@'))
      .join('/');

  const repertoires = (racine: string): string[] => {
    const out: string[] = [];
    const walk = (dir: string): void => {
      out.push(dir);
      for (const nom of readdirSync(dir)) {
        const p = join(dir, nom);
        if (statSync(p).isDirectory()) walk(p);
      }
    };
    walk(racine);
    return out;
  };

  it('aucun route handler sous /dev (il ne traverserait pas le layout)', () => {
    const handlers = repertoires(DEV_DIR).flatMap((dir) =>
      readdirSync(dir)
        .filter((nom) => /^route\.(tsx?|jsx?)$/.test(nom))
        .map((nom) => join(dir, nom)),
    );
    expect(handlers).toEqual([]);
  });

  it('src/app/dev est le seul répertoire qui sert /dev/*', () => {
    const servants = repertoires(APP).filter((dir) => {
      const p = pathnameDe(dir);
      return p === '/dev' || p.startsWith('/dev/');
    });
    // Garde anti-vacuité : le vrai répertoire est bien détecté par ce calcul.
    expect(servants).toContain(DEV_DIR);
    expect(
      servants.filter((d) => d !== DEV_DIR && !d.startsWith(DEV_DIR + sep)),
    ).toEqual([]);
  });
});
