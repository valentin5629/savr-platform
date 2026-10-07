/**
 * M3.2 — « Mon pack AG » masqué sur TOUTES les pages du gestionnaire (§06.05 l.75).
 *
 * Défaut E2E (2026-10-06) : l'entrée réapparaissait dès que le gestionnaire
 * ouvrait le registre réglementaire (ou le formulaire de programmation), puis
 * disparaissait en revenant dans son espace. Ces sections transverses ont leur
 * propre layout, et seul le layout `(gestionnaire)` jouait la règle.
 *
 * Les tests BL-P2-13 d'origine nourrissent la Sidebar à la main
 * (`hiddenNavHrefs=…`) : ils prouvent que le menu sait masquer, pas que chaque
 * layout le lui demande. Ici on rend les LAYOUTS, et on compare leurs menus.
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

vi.mock('next/navigation', () => ({
  usePathname: () => etat.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
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
          return Promise.resolve({ count: etat.nbPacks, error: null });
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
import { entreesNavMasquees } from '@/lib/nav-masquee.js';
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
  return within(menu)
    .getAllByRole('link')
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

describe('M3.2 / nav « Mon pack AG » — sections transverses', () => {
  it('M3.2/nav_pack_registre_masque_sans_pack — sur le registre, un gestionnaire sans pack ne voit pas « Mon pack AG »', async () => {
    const menu = await menuDe(RegistreLayout, '/registre');
    expect(menu).not.toContain('Mon pack AG');
    expect(menu).toContain('Registre réglementaire');
    expect(screen.queryByText('Mon pack AG')).not.toBeInTheDocument();
  });

  it('M3.2/nav_pack_registre_affiche_avec_pack — sur le registre, un gestionnaire qui a un pack garde « Mon pack AG »', async () => {
    etat.nbPacks = 1;
    const menu = await menuDe(RegistreLayout, '/registre');
    expect(menu).toContain('Mon pack AG');
  });

  it('M3.2/nav_pack_programmation_masque_sans_pack — sur le formulaire de programmation, menu du gestionnaire sans « Mon pack AG »', async () => {
    const menu = await menuDe(ProgrammationLayout, '/programmer/nouveau');
    expect(menu).not.toContain('Mon pack AG');
    // C'est bien le menu du gestionnaire, dès le premier rendu.
    expect(menu).toContain('Mes lieux');
  });

  it('M3.2/nav_pack_meme_menu_partout — espace, registre et programmation rendent le MÊME menu', async () => {
    for (const nbPacks of [0, 2]) {
      etat.nbPacks = nbPacks;
      const espace = await menuDe(GestionnaireLayout, '/gestionnaire');
      const registre = await menuDe(RegistreLayout, '/registre');
      const programmation = await menuDe(
        ProgrammationLayout,
        '/programmer/nouveau',
      );
      expect(registre).toEqual(espace);
      expect(programmation).toEqual(espace);
      expect(espace.includes('Mon pack AG')).toBe(nbPacks > 0);
    }
  });

  it('M3.2/nav_pack_autres_roles_sans_lecture — un traiteur sur le registre : menu intact, aucun comptage de packs', async () => {
    etat.role = 'traiteur_manager';
    const menu = await menuDe(RegistreLayout, '/registre');
    expect(menu).toContain('Collectes');
    expect(menu).not.toContain('Mes lieux');
    expect(etat.tablesLues).toEqual([]);
  });

  it('M3.2/nav_pack_regle_unique — entreesNavMasquees : gestionnaire sans pack → l’entrée ; avec pack, comptage illisible ou autre rôle → cas tranchés', async () => {
    etat.nbPacks = 0;
    expect(await entreesNavMasquees('gestionnaire_lieux')).toEqual([
      '/gestionnaire/mon-pack-ag',
    ]);
    expect(etat.tablesLues).toEqual(['packs_antgaspi']);
    // Rendu de page : le client ne doit pas tenter d'écrire de cookies.
    expect(etat.optionsClient).toEqual([{ readonly: true }]);

    etat.nbPacks = 3;
    expect(await entreesNavMasquees('gestionnaire_lieux')).toEqual([]);

    // Comptage illisible (lecture refusée) : on masque, jamais l'inverse.
    etat.nbPacks = null;
    expect(await entreesNavMasquees('gestionnaire_lieux')).toEqual([
      '/gestionnaire/mon-pack-ag',
    ]);

    etat.tablesLues = [];
    for (const role of ['traiteur_manager', 'agence', 'admin_savr'] as const)
      expect(await entreesNavMasquees(role)).toEqual([]);
    expect(etat.tablesLues).toEqual([]);
  });
});

describe('M0.8 / nav du formulaire de programmation — rôle lu côté serveur', () => {
  it('M0.8-72 — Formulaire de programmation : le staff (admin, ops) garde le menu du back-office', async () => {
    const backOffice = menuDuRole('admin_savr');
    expect(backOffice.length).toBeGreaterThan(0);
    for (const role of ['admin_savr', 'ops_savr']) {
      etat.role = role;
      expect(await menuDe(ProgrammationLayout, '/programmer/nouveau')).toEqual(
        backOffice,
      );
    }
    expect(etat.tablesLues).toEqual([]);
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
