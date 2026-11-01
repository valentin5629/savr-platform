/**
 * En-têtes d'écran. R-UI-6c (Val 2026-10-06) réservait le bandeau aux listes ;
 * depuis le 2026-11-01 (Val, variante B2) le bandeau pâle `PageHero` ouvre
 * CHAQUE écran du menu ; le même jour, Val l'étend à toute la plateforme (sous-
 * écrans et Admin compris) et `PageHeader` est retiré. Vérification statique des sources (lecture fs), comme les
 * autres gardes du repo ; aucune page sous `app/` ne rend plus de
 * `<Heading level={1}` en direct, hors exceptions listées.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageHero } from '@/components/ui/page-hero';

const APP = resolve(__dirname, '../../app');
const SRC = resolve(__dirname, '../..');

// Écrans ouverts par une entrée du menu (lib/nav-config.ts), tous rôles. Chemin
// = fichier qui rend l'en-tête (composant partagé quand la page en délègue).
const ECRANS_MENU = [
  'app/(admin)/admin/dashboard/page.tsx',
  'app/(admin)/admin/dashboard-client/DashboardClientView.tsx',
  'app/(admin)/admin/collectes/page.tsx',
  'components/evenements/liste-evenements.tsx',
  'app/(admin)/admin/factures/page.tsx',
  'app/(admin)/admin/associations/page.tsx',
  'app/(admin)/admin/transporteurs/page.tsx',
  'app/(admin)/admin/lieux/page.tsx',
  'app/(admin)/admin/clients/page.tsx',
  'app/(admin)/admin/parametres/page.tsx',
  'app/(admin)/admin/mon-profil/page.tsx',
  'app/(admin)/admin/alertes/page.tsx',
  'app/(admin)/admin/sante-systeme/page.tsx',
  'app/(traiteur)/traiteur/traiteur-dashboard-client.tsx',
  'components/collecte/liste-collectes-client.tsx',
  'components/parametres/parametres-onglets.tsx',
  'app/(agence)/agence/page.tsx',
  'app/(gestionnaire)/gestionnaire/page.tsx',
  'app/(gestionnaire)/gestionnaire/collectes/page.tsx',
  'app/(gestionnaire)/gestionnaire/traiteurs/page.tsx',
  'app/(gestionnaire)/gestionnaire/lieux/page.tsx',
  'app/(registre)/registre/page.tsx',
  'app/(gestionnaire)/gestionnaire/mon-pack-ag/page.tsx',
  'app/(gestionnaire)/gestionnaire/parametres/parametres-client.tsx',
  'app/(client-organisateur)/organisateur/page.tsx',
  'app/(client-organisateur)/organisateur/collectes/page.tsx',
  'app/(client-organisateur)/organisateur/documents/page.tsx',
];

const LISTES = [
  '(admin)/admin/transporteurs/page.tsx',
  '(admin)/admin/associations/page.tsx',
  '(admin)/admin/parametres/grilles-zd/page.tsx',
  '(admin)/admin/alertes/page.tsx',
  '(admin)/admin/settings/users/page.tsx',
  '(gestionnaire)/gestionnaire/traiteurs/page.tsx',
  '(client-organisateur)/organisateur/documents/page.tsx',
  '(registre)/registre/page.tsx',
  '(programmation)/brouillons/page.tsx',
];

// Hors bandeau, assumés : 403 (carte centrée hors AppShell), confirmation de
// programmation (écran de succès validé le 2026-10-16), pages de développement.
// Les écrans de connexion n'ont pas de h1 de page (titre porté par AuthCard).
const EXCLUS = ['403/', 'dev/'];
const H1_HORS_BANDEAU = ['(programmation)/programmer/confirmation/page.tsx'];

function sourcesTsx(dir: string): string[] {
  return readdirSync(dir).flatMap((nom) => {
    const chemin = join(dir, nom);
    if (statSync(chemin).isDirectory()) return sourcesTsx(chemin);
    return nom.endsWith('.tsx') && !nom.includes('.test.') ? [chemin] : [];
  });
}

const rel = (chemin: string) => relative(APP, chemin).split(sep).join('/');
const lire = (r: string) => readFileSync(join(APP, r), 'utf8');

describe('Écrans du menu : bandeau PageHero (Val 2026-11-01)', () => {
  it.each(ECRANS_MENU)('%s ouvre sur PageHero', (r) => {
    expect(readFileSync(join(SRC, r), 'utf8')).toMatch(/<PageHero\b/);
  });
});

describe('Listes : bandeau PageHero', () => {
  it.each(LISTES)('%s utilise PageHero', (r) => {
    expect(lire(r)).toMatch(/<PageHero\b/);
  });

  it('PageHero porte le h1 de la page (titre accessible inchangé)', () => {
    render(<PageHero title="Transporteurs" subtitle="Référentiel" />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Transporteurs' }),
    ).toBeTruthy();
  });
});

describe('Toute la plateforme : aucun titre de page hors bandeau (Val 2026-11-01)', () => {
  it('aucune page sous app/ (hors exclusions) ne rend un h1 en direct', () => {
    const fautifs = sourcesTsx(APP)
      .map(rel)
      .filter((r) => !EXCLUS.some((e) => r.startsWith(e)))
      .filter((r) => !H1_HORS_BANDEAU.includes(r))
      .filter((r) => /<Heading\s+level=\{1\}|<h1\b/.test(lire(r)));
    expect(fautifs).toEqual([]);
  });

  it('les exceptions listées portent toujours leur propre h1', () => {
    for (const r of H1_HORS_BANDEAU) {
      expect(lire(r), r).toMatch(/<Heading\s+level=\{1\}/);
    }
  });
});
