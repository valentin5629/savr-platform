/**
 * M1.6 — `pnpm documents:dev` : la commande qui rejoue sur savr-dev la chaîne des
 * documents (clôture → batchs PDF J+1 → worker PDF) ne doit jamais pouvoir viser
 * une autre base. Ce fichier ne teste que la fonction de garde ; son branchement
 * en tête de la commande est prouvé par documents-dev-main.m1-6.test.ts. Les
 * traitements eux-mêmes ont leurs propres tests (tests/api/batch-pdf-j1*.test.ts,
 * pdf-worker.m1-6.test.ts).
 */
import { describe, it, expect } from 'vitest';

import { DEV_PROJECT_REF } from '../../../shared/src/seed/constants.js';
import { refuserHorsDev } from '../../../../scripts/documents-dev.js';

const URL_DEV = `https://${DEV_PROJECT_REF}.supabase.co`;

describe('M1.6 / documents:dev — garde « savr-dev seulement »', () => {
  it('accepte la base savr-dev, hors déploiement Vercel', () => {
    expect(() =>
      refuserHorsDev({ NEXT_PUBLIC_SUPABASE_URL: URL_DEV }),
    ).not.toThrow();
  });

  const refus: Array<[string, Record<string, string | undefined>]> = [
    ['URL absente', {}],
    ['URL vide', { NEXT_PUBLIC_SUPABASE_URL: '' }],
    ['URL illisible', { NEXT_PUBLIC_SUPABASE_URL: 'pas-une-url' }],
    [
      'un autre projet Supabase',
      { NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co' },
    ],
    [
      'la référence dev en préfixe d’un autre hôte',
      {
        NEXT_PUBLIC_SUPABASE_URL: `https://${DEV_PROJECT_REF}.supabase.co.exemple.test`,
      },
    ],
    [
      'la référence dev ailleurs que dans l’hôte',
      {
        NEXT_PUBLIC_SUPABASE_URL: `https://abcdefghijklmnopqrst.supabase.co/${DEV_PROJECT_REF}.supabase.co`,
      },
    ],
    [
      'la base de dev en http (clé de service en clair)',
      { NEXT_PUBLIC_SUPABASE_URL: `http://${DEV_PROJECT_REF}.supabase.co` },
    ],
    [
      'la base de dev sur un port inhabituel',
      {
        NEXT_PUBLIC_SUPABASE_URL: `https://${DEV_PROJECT_REF}.supabase.co:8443`,
      },
    ],
    [
      'des identifiants devant un autre hôte',
      {
        NEXT_PUBLIC_SUPABASE_URL: `https://${DEV_PROJECT_REF}.supabase.co@exemple.test`,
      },
    ],
    [
      'un déploiement Vercel de production',
      { NEXT_PUBLIC_SUPABASE_URL: URL_DEV, VERCEL_ENV: 'production' },
    ],
    [
      'un déploiement Vercel d’aperçu',
      { NEXT_PUBLIC_SUPABASE_URL: URL_DEV, VERCEL_ENV: 'preview' },
    ],
    [
      'NODE_ENV=production',
      { NEXT_PUBLIC_SUPABASE_URL: URL_DEV, NODE_ENV: 'production' },
    ],
  ];

  for (const [cas, env] of refus) {
    it(`refuse : ${cas}`, () => {
      expect(() => refuserHorsDev(env)).toThrow(/^refusé : /);
    });
  }
});
