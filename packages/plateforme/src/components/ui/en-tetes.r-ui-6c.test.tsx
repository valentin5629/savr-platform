/**
 * R-UI-6c — arbitrage Q3 b (Val 2026-10-06) : bandeau navy `PageHero` réservé
 * aux écrans LISTE ; les écrans non-liste portent un `PageHeader` sobre.
 * Vérification statique des sources (lecture fs), comme les autres gardes du
 * repo : les listes migrées utilisent PageHero, et aucune page sous `app/` ne
 * rend plus de `<Heading level={1}` en direct, hors exceptions listées.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageHero } from '@/components/ui/page-hero';

const APP = resolve(__dirname, '../../app');

const LISTES = [
  '(admin)/admin/transporteurs/page.tsx',
  '(admin)/admin/associations/page.tsx',
  '(admin)/admin/parametres/grilles-zd/page.tsx',
  '(admin)/admin/alertes/page.tsx',
  '(admin)/admin/settings/users/page.tsx',
  '(gestionnaire)/gestionnaire/evenements/page.tsx',
  '(gestionnaire)/gestionnaire/traiteurs/page.tsx',
  '(client-organisateur)/organisateur/documents/page.tsx',
  '(registre)/registre/page.tsx',
  '(programmation)/brouillons/page.tsx',
];

// Exclus du périmètre (brief R-UI-6c) : algo-ag (intouchable), 403, app/dev.
const EXCLUS = ['(admin)/admin/parametres/algo-ag/', '403/', 'dev/'];

// Titres h1 laissés en Heading : la conversion en PageHeader changerait le
// rendu (tone/weight hors props PageHeader, marge de description, badge ou
// lien retour accolés au titre, titre dans un bandeau succès). Liste figée :
// toute nouvelle page doit passer par PageHeader / PageHero.
const H1_NON_CONVERTIS = [
  '(admin)/admin/attributions-ag/[collecteId]/page.tsx',
  '(admin)/admin/dashboard/page.tsx',
  '(admin)/admin/factures/[id]/page.tsx',
  '(admin)/admin/parametres/tarifs-ag/page.tsx',
  '(admin)/admin/parametres/templates/page.tsx',
  '(gestionnaire)/gestionnaire/evenements/[id]/page.tsx',
  '(programmation)/programmer/confirmation/page.tsx',
  '(registre)/registre/[id]/page.tsx',
  '(registre)/registre/methodologie/page.tsx',
];

function sourcesTsx(dir: string): string[] {
  return readdirSync(dir).flatMap((nom) => {
    const chemin = join(dir, nom);
    if (statSync(chemin).isDirectory()) return sourcesTsx(chemin);
    return nom.endsWith('.tsx') && !nom.includes('.test.') ? [chemin] : [];
  });
}

const rel = (chemin: string) => relative(APP, chemin).split(sep).join('/');
const lire = (r: string) => readFileSync(join(APP, r), 'utf8');

describe('Q3 b — listes : bandeau PageHero', () => {
  it.each(LISTES)('%s utilise PageHero (et plus PageHeader)', (r) => {
    const src = lire(r);
    expect(src).toMatch(/<PageHero\b/);
    expect(src).not.toMatch(/<PageHeader\b/);
    expect(src).not.toMatch(/<Heading\s+level=\{1\}/);
  });

  it('PageHero porte le h1 de la page (titre accessible inchangé)', () => {
    render(<PageHero title="Transporteurs" subtitle="Référentiel" />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Transporteurs' }),
    ).toBeTruthy();
  });
});

describe('Q3 b — écrans non-liste : plus de Heading h1 en direct', () => {
  it('aucune page sous app/ (hors exclusions) ne rend <Heading level={1}> en direct', () => {
    const fautifs = sourcesTsx(APP)
      .map(rel)
      .filter((r) => !EXCLUS.some((e) => r.startsWith(e)))
      .filter((r) => !H1_NON_CONVERTIS.includes(r))
      .filter((r) => /<Heading\s+level=\{1\}/.test(lire(r)));
    expect(fautifs).toEqual([]);
  });

  it('les exceptions listées existent encore et portent toujours un Heading h1', () => {
    // Garde-fou : une exception convertie plus tard doit sortir de la liste.
    for (const r of H1_NON_CONVERTIS) {
      expect(lire(r), r).toMatch(/<Heading\s+level=\{1\}/);
    }
  });
});
