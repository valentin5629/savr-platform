/**
 * Menus des sections transverses : le registre réglementaire et le formulaire
 * de programmation ont leur propre layout, qui doit rendre le MÊME menu que
 * l'espace du rôle (défaut E2E du 2026-10-06 : une entrée y réapparaissait).
 *
 * « Mon pack Anti-Gaspi » est désormais dans le menu de tous les rôles clients,
 * même sans pack (Val 2026-11-02) : l'ancien masquage « sans pack » du
 * gestionnaire (§06.05 l.75) et son comptage de packs sont retirés.
 *
 * M0.8 (navigation par rôle) — le layout `(programmation)` lit désormais le rôle
 * côté serveur : staff et rôle illisible y sont couverts en fin de fichier.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';

const etat = vi.hoisted(() => ({
  pathname: '/registre',
  role: 'gestionnaire_lieux' as string | undefined,
  nbPacks: 0 as number | null,
  tablesLues: [] as string[],
  optionsClient: [] as unknown[],
}));

// Identité du pied de menu : avec elle, « Paramètres » quitte la barre
// latérale pour le menu de l'utilisateur (Val 2026-11-02).
const FICHES: Record<string, Record<string, unknown>> = {
  users: {
    prenom: 'Camille',
    nom: 'Martin',
    poste: null,
    organisation_id: 'org1',
  },
  organisations: { nom: 'Viparis', logo_url: null },
};

vi.mock('next/navigation', () => ({
  usePathname: () => etat.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/page-auth', () => ({
  requirePageSession: vi.fn(() =>
    Promise.resolve({
      userId: 'u1',
      role: etat.role,
      organisationId: 'org1',
      email: 'collab.viparis@savr-test.local',
    }),
  ),
}));

vi.mock('@/lib/api-auth', () => ({
  // Frontière externe : le comptage RLS des packs de l'organisation.
  createSupabaseServerClient: (options?: unknown) => {
    etat.optionsClient.push(options);
    return {
      from: (table: string) => ({
        select: () => {
          etat.tablesLues.push(table);
          // Comptage des packs (awaité tel quel) ou fiche lue par id (identité
          // du pied de menu).
          return Object.assign(
            Promise.resolve({ count: etat.nbPacks, error: null }),
            {
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({ data: FICHES[table] ?? null, error: null }),
              }),
            },
          );
        },
      }),
    };
  },
  getVerifiedClaims: vi.fn(() =>
    Promise.resolve(
      etat.role
        ? { userId: 'u1', role: etat.role, organisationId: 'org1' }
        : null,
    ),
  ),
}));

import GestionnaireLayout from '@/app/(gestionnaire)/layout.js';
import RegistreLayout from '@/app/(registre)/layout.js';
import ProgrammationLayout, {
  dynamic as programmationDynamic,
} from '@/app/(programmation)/layout.js';
import { getNavItems } from '@/lib/nav-config.js';
import type { NavRole } from '@/lib/roles.js';

type Layout = (props: {
  children: React.ReactNode;
}) => Promise<React.ReactNode>;

/** Rend un layout serveur et renvoie les libellés de son menu latéral. */
async function menuDe(layout: Layout, pathname: string): Promise<string[]> {
  cleanup();
  etat.pathname = pathname;
  render(<>{await layout({ children: <p>contenu</p> })}</>);
  // L'AppShell monte le menu latéral deux fois (bureau + volet mobile) : le
  // premier suffit, les deux reçoivent les mêmes props.
  const menu = screen.getAllByRole('navigation', {
    name: 'Navigation principale',
  })[0]!;
  // Le logo est un lien (retour au Dashboard), pas une entrée du menu.
  return within(menu)
    .getAllByRole('link')
    .filter((lien) => !lien.closest('[data-testid="savr-logo"]'))
    .map((lien) => lien.textContent ?? '');
}

beforeEach(() => {
  etat.role = 'gestionnaire_lieux';
  etat.nbPacks = 0;
  etat.tablesLues = [];
  etat.optionsClient = [];
});

/** Libellés du menu d'un rôle, tel que la config le déclare. */
function menuDuRole(role: NavRole): string[] {
  return getNavItems(role).map((entree) => entree.label);
}

describe('Nav « Mon pack Anti-Gaspi » — toujours visible (Val 2026-11-02)', () => {
  it('M3.2/nav_pack_meme_menu_partout — espace, registre et programmation rendent le MÊME menu, avec l’entrée, sans lire les packs', async () => {
    const espace = await menuDe(GestionnaireLayout, '/gestionnaire');
    const registre = await menuDe(RegistreLayout, '/registre');
    const programmation = await menuDe(
      ProgrammationLayout,
      '/programmer/nouveau',
    );
    expect(espace).toContain('Mon pack Anti-Gaspi');
    expect(registre).toEqual(espace);
    expect(programmation).toEqual(espace);
    // Plus aucun comptage de packs pour construire le menu (l'identité du bas
    // de menu lit seulement la fiche et l'organisation, Val 2026-10-30).
    expect(etat.tablesLues).not.toContain('packs_antgaspi');
  });

  it('M3.2/nav_pack_autres_roles_sans_lecture — un traiteur sur le registre voit aussi l’entrée, sans comptage de packs', async () => {
    etat.role = 'traiteur_manager';
    const menu = await menuDe(RegistreLayout, '/registre');
    expect(menu).toContain('Événements');
    expect(menu).not.toContain('Collectes');
    expect(menu).toContain('Mon pack Anti-Gaspi');
    expect(menu).not.toContain('Mes lieux');
    expect(etat.tablesLues).not.toContain('packs_antgaspi');
  });
});

// « Événements », remise par Val le 2026-10-18 ; « Collectes » retirée du menu
// le 2026-11-05 (décision Val).
describe('M3.2 / ordre du menu du gestionnaire (décision Val 2026-10-07)', () => {
  it('M3.2/nav_ordre_menu_gestionnaire — barre latérale dans l’ordre fixé, « Mon pack Anti-Gaspi » avant « Paramètres » (où vit « Mon organisation » depuis le 2026-10-31), barre mobile = 4 premières entrées', async () => {
    expect(await menuDe(GestionnaireLayout, '/gestionnaire')).toEqual([
      'Dashboard',
      'Événements',
      'Traiteurs',
      'Mes lieux',
      'Registre réglementaire',
      'Mon pack Anti-Gaspi',
    ]);
    // « Paramètres » est dans le menu de l'utilisateur, en pied de barre.
    expect(screen.getAllByTestId('menu-utilisateur').length).toBeGreaterThan(0);
    const barreMobile = screen.getByRole('navigation', {
      name: 'Navigation mobile',
    });
    expect(
      within(barreMobile)
        .getAllByRole('link')
        .map((lien) => lien.textContent ?? ''),
    ).toEqual(['Dashboard', 'Événements', 'Traiteurs', 'Mes lieux']);
  });
});

describe('M0.8 / nav du formulaire de programmation — rôle lu côté serveur', () => {
  it('M0.8-72 — Formulaire de programmation : le staff (admin, ops) garde le menu du back-office', async () => {
    // « Paramètres » de l'Admin (réglages métier) reste dans la barre.
    const backOffice = menuDuRole('admin_savr');
    expect(backOffice.length).toBeGreaterThan(0);
    for (const role of ['admin_savr', 'ops_savr']) {
      etat.role = role;
      expect(await menuDe(ProgrammationLayout, '/programmer/nouveau')).toEqual(
        backOffice,
      );
    }
    // Aucun comptage de packs ; seule la fiche de l'utilisateur est lue
    // (identité du bas de menu, Val 2026-10-30).
    expect(etat.tablesLues).not.toContain('packs_antgaspi');
  });

  it('M0.8-73 — Formulaire de programmation : sans rôle lisible, menu par défaut du traiteur commercial', async () => {
    etat.role = undefined;
    expect(await menuDe(ProgrammationLayout, '/programmer/nouveau')).toEqual(
      menuDuRole('traiteur_commercial'),
    );
    expect(etat.tablesLues).toEqual([]);
  });

  it('M0.8-74 — Formulaire de programmation : layout rendu à la demande, jamais pré-rendu au build', () => {
    // Ce layout crée son client Supabase dès le rendu. Pré-rendu au build, il
    // casse `next build` sans variables Supabase (CI) — invisible en local.
    expect(programmationDynamic).toBe('force-dynamic');
  });
});
