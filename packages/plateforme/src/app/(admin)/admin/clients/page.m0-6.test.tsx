/**
 * M0.6 — Liste clients (§06.06) : colonne « Pack actif » + retrait SIREN.
 *
 * Revue E2E : la présentation adopte la maquette (bandeau, avatars à initiales,
 * badge « Pack actif ») SANS afficher le SIREN. Divergence assumée par Val vs
 * CDC §06.06 L555 (liste = nom/type/SIREN/users/ZD/AG/actif, sans pack actif),
 * cf. _Divergences/BOA_20260718.
 *
 * NB : DataTable rend desktop (table) + mobile (cards) → libellés en double,
 * assertions en getAllBy*.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// Impersonation : dépend d'une session Supabase navigateur → hors périmètre.
vi.mock('@/components/ui/impersonation-launcher', () => ({
  ImpersonationLauncher: () => null,
}));

// next/link sans AppRouter monté (jsdom) → simple ancre.
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

import ClientsPage from './page';

const orgs = [
  {
    id: 'org-a',
    raison_sociale: 'Fleur de Mets',
    type: 'traiteur',
    siret: '43219876500012',
    actif: true,
    nb_users: 5,
    nb_collectes_zd_12m: 38,
    nb_collectes_ag_12m: 22,
    pack_actif: { type_pack: 'pack_30', credits_restants: 3 },
  },
  {
    id: 'org-b',
    raison_sociale: 'Kaspia Réceptions',
    type: 'traiteur',
    siret: '51233487600020',
    actif: true,
    nb_users: 3,
    nb_collectes_zd_12m: 24,
    nb_collectes_ag_12m: 15,
    pack_actif: { type_pack: 'pack_10', credits_restants: 6 },
  },
  {
    id: 'org-c',
    raison_sociale: 'Viparis Lieux',
    type: 'gestionnaire_lieux',
    siret: '44086221300015',
    actif: true,
    nb_users: 6,
    nb_collectes_zd_12m: 0,
    nb_collectes_ag_12m: 0,
    pack_actif: null,
  },
];

beforeEach(() => {
  global.fetch = vi.fn((url: string) => {
    const payload = url.startsWith('/api/v1/admin/organisations')
      ? { data: orgs, total: orgs.length }
      : { data: [] };
    return Promise.resolve({
      ok: true,
      json: async () => payload,
    }) as unknown as Promise<Response>;
  }) as unknown as typeof fetch;
});
afterEach(() => vi.restoreAllMocks());

describe('M0.6 — liste clients : colonne Pack actif + retrait SIREN', () => {
  it('affiche le bandeau « Clients » et le CTA « Créer une organisation »', async () => {
    render(<ClientsPage />);
    await waitFor(() =>
      expect(screen.getAllByText('Fleur de Mets').length).toBeGreaterThan(0),
    );
    expect(
      screen.getByRole('heading', { name: 'Clients' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Créer une organisation')).toBeInTheDocument();
  });

  it('rend un avatar à initiales (première + dernière parole) devant le nom', async () => {
    render(<ClientsPage />);
    await waitFor(() =>
      expect(screen.getAllByText('Fleur de Mets').length).toBeGreaterThan(0),
    );
    expect(screen.getAllByText('FM').length).toBeGreaterThan(0); // Fleur … Mets
    expect(screen.getAllByText('KR').length).toBeGreaterThan(0); // Kaspia Réceptions
    expect(screen.getAllByText('VL').length).toBeGreaterThan(0); // Viparis Lieux
  });

  it('colonne Pack actif : badge rouge si < 5 restants, vert sinon, « — » si aucun', async () => {
    render(<ClientsPage />);
    await waitFor(() =>
      expect(screen.getAllByText('Fleur de Mets').length).toBeGreaterThan(0),
    );
    // 3 restants → rouge (error)
    const faible = screen.getAllByText(/Pack 30 · 3 restants/);
    expect(faible.length).toBeGreaterThan(0);
    expect(faible[0]!.className).toMatch(/savr-error/);
    // 6 restants → vert (success)
    const sain = screen.getAllByText(/Pack 10 · 6 restants/);
    expect(sain.length).toBeGreaterThan(0);
    expect(sain[0]!.className).toMatch(/savr-success/);
    // Aucun pack actif → « — »
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('n’affiche plus la colonne SIREN (ni en-tête, ni numéros)', async () => {
    render(<ClientsPage />);
    await waitFor(() =>
      expect(screen.getAllByText('Fleur de Mets').length).toBeGreaterThan(0),
    );
    expect(screen.queryByText(/SIREN/i)).not.toBeInTheDocument();
    expect(screen.queryByText('43219876500012')).not.toBeInTheDocument();
  });
});
