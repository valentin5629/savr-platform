/**
 * M0.8 — Menu : UNE seule entrée active (Design System §10, `aria-current` sur
 * l'item de nav actif).
 *
 * Défaut E2E (2026-10-06) : sur `/gestionnaire/collectes`, « Dashboard » restait
 * surligné en même temps que « Collectes ». Le Dashboard d'un espace client vit
 * à la racine de l'espace (`/gestionnaire`), donc préfixe toutes ses voisines —
 * et l'entrée active se décidait au préfixe. Touchait traiteur, agence,
 * gestionnaire et client organisateur, barre latérale et barre mobile.
 *
 * Depuis le 2026-11-05 (décision Val), les espaces clients n'ont plus d'entrée
 * « Collectes » : leurs pages collectes allument « Événements », d'où l'on y
 * arrive, et jamais le Dashboard.
 */
import { it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

const etat = vi.hoisted(() => ({ pathname: '/gestionnaire' }));

vi.mock('next/navigation', () => ({
  usePathname: () => etat.pathname,
}));

import { Sidebar } from '@/components/layout/sidebar.js';
import { BottomNav } from '@/components/layout/bottom-nav.js';
import { NAV_CONFIG, getNavItems, hrefNavActif } from '@/lib/nav-config.js';
import type { NavRole } from '@/lib/roles.js';

/** Libellés des liens marqués `aria-current="page"` à l'écran. */
function entreesActives(): string[] {
  return screen
    .queryAllByRole('link', { current: 'page' })
    .map((lien) => lien.textContent ?? '');
}

beforeEach(() => {
  cleanup();
});

it('M0.8-67 — Menu : sur une page collecte d’un espace client, seule « Événements » est active (le Dashboard ne s’allume pas)', () => {
  etat.pathname = '/gestionnaire/collectes';
  render(<Sidebar role="gestionnaire_lieux" />);
  expect(entreesActives()).toEqual(['Événements']);

  // Même défaut, mêmes causes, dans les autres espaces à Dashboard racine.
  for (const [role, pathname] of [
    ['traiteur_manager', '/traiteur/collectes'],
    ['agence', '/agence/collectes'],
    ['client_organisateur', '/organisateur/collectes'],
  ] as const) {
    cleanup();
    etat.pathname = pathname;
    render(<Sidebar role={role} />);
    expect(entreesActives()).toEqual(['Événements']);
    const espace = pathname.replace(/\/collectes$/, '');
    expect(hrefNavActif(role, pathname)).toBe(`${espace}/evenements`);
    expect(hrefNavActif(role, `${pathname}/abc`)).toBe(`${espace}/evenements`);
  }
});

it('M0.8-68 — Menu : la racine de l’espace allume le Dashboard, une sous-page allume l’entrée qui la contient', () => {
  const role = 'gestionnaire_lieux';
  expect(hrefNavActif(role, '/gestionnaire')).toBe('/gestionnaire');
  expect(hrefNavActif(role, '/gestionnaire/evenements/abc')).toBe(
    '/gestionnaire/evenements',
  );
  // L'Admin garde son entrée « Collectes ».
  expect(hrefNavActif('admin_savr', '/admin/collectes/abc')).toBe(
    '/admin/collectes',
  );
  expect(hrefNavActif(role, '/registre/methodologie')).toBe('/registre');
  // Pas de faux ami : un chemin qui commence pareil sans être une sous-page.
  expect(hrefNavActif('admin_savr', '/admin/dashboard-client')).toBe(
    '/admin/dashboard-client',
  );
  // Hors du menu du rôle : rien d'actif.
  expect(hrefNavActif(role, '/programmer/nouveau')).toBeUndefined();

  etat.pathname = '/gestionnaire';
  render(<Sidebar role={role} />);
  expect(entreesActives()).toEqual(['Dashboard']);
});

it('M0.8-69 — Menu : pour chaque rôle, chaque entrée est seule active sur sa propre page', () => {
  for (const role of Object.keys(NAV_CONFIG) as NavRole[]) {
    for (const { href } of getNavItems(role)) {
      expect(hrefNavActif(role, href), `${role} · ${href}`).toBe(href);
    }
  }
});

it('M0.8-70 — Barre mobile : même règle, et rien d’allumé quand la page courante n’est pas dans les 4 entrées affichées', () => {
  etat.pathname = '/gestionnaire/collectes';
  render(<BottomNav role="gestionnaire_lieux" />);
  expect(entreesActives()).toEqual(['Événements']);

  // « Paramètres » est au-delà des 4 entrées de la barre mobile. Son adresse
  // est sous celle du Dashboard, qui ne doit pas s'allumer à sa place.
  cleanup();
  etat.pathname = '/gestionnaire/parametres';
  render(<BottomNav role="gestionnaire_lieux" />);
  expect(entreesActives()).toEqual([]);
});

it('M0.8-71 — Menu : sur « Mon pack Anti-Gaspi », seule son entrée s’allume (le Dashboard, qui préfixe son adresse, reste éteint)', () => {
  etat.pathname = '/gestionnaire/mon-pack-ag';
  render(<Sidebar role="gestionnaire_lieux" />);
  expect(entreesActives()).toEqual(['Mon pack Anti-Gaspi']);
});

it('M0.8-73 — Menu : aucun rôle client n’a d’entrée « Collectes », l’Admin la garde (Val 2026-11-05)', () => {
  for (const role of Object.keys(NAV_CONFIG) as NavRole[]) {
    const libelles = getNavItems(role).map((i) => i.label);
    if (role === 'admin_savr') expect(libelles).toContain('Collectes');
    else expect(libelles, role).not.toContain('Collectes');
  }
});
