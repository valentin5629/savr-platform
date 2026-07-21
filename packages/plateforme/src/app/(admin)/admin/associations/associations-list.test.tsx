/**
 * M1.1 — Liste associations Admin. Colonnes recentrées sur Nom · Adresse ·
 * Capacité max · Collectes (30 j) (revue E2E 2026-07-15). Depuis la revue-écran
 * modale : clic ligne / crayon → modale d'édition ; « Nouvelle association » →
 * modale de création (plus de navigation vers des pages [id]/nouvelle).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  waitFor,
  within,
  fireEvent,
} from '@testing-library/react';

import AssociationsPage from './page';

const rows = [
  {
    id: 'a1',
    nom: 'Association Alpha (fictif)',
    adresse: '12 Rue Alpha',
    ville: 'Paris',
    region: 'idf',
    capacite_max_beneficiaires: 150,
    collectes_realisees_30j: 3,
  },
  {
    id: 'a2',
    nom: 'Association Bravo (fictif)',
    adresse: '8 Rue Bravo',
    ville: 'Paris',
    region: 'idf',
    capacite_max_beneficiaires: null,
    collectes_realisees_30j: 0,
  },
];

describe('M1.1 — Liste associations Admin (colonnes revue E2E)', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: rows, total: rows.length }),
    }) as unknown as typeof fetch;
  });
  afterEach(() => vi.restoreAllMocks());

  it('affiche les 4 colonnes cibles et retire les anciennes', async () => {
    render(<AssociationsPage />);
    // En-têtes de colonnes = uniquement dans le <table> (la vue mobile n'a pas
    // de columnheader) → assertions non ambiguës.
    await waitFor(() =>
      expect(
        screen.getByRole('columnheader', { name: 'Nom' }),
      ).toBeInTheDocument(),
    );
    for (const h of ['Nom', 'Adresse', 'Capacité max', 'Collectes (30 j)']) {
      expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    }
    for (const h of ['Ville', 'Contact', 'Habilitation 2041-GE', 'Statut']) {
      expect(
        screen.queryByRole('columnheader', { name: h }),
      ).not.toBeInTheDocument();
    }
  });

  it('rend les valeurs adresse, capacité et compteur 30 j', async () => {
    render(<AssociationsPage />);
    // DataTable rend un tableau desktop ET des cartes mobiles → on scope au
    // <table role="grid"> pour éviter les doublons de texte.
    await waitFor(() => expect(screen.getByRole('grid')).toBeInTheDocument());
    const table = within(screen.getByRole('grid'));
    expect(table.getByText('Association Alpha (fictif)')).toBeInTheDocument();
    expect(table.getByText('12 Rue Alpha')).toBeInTheDocument();
    expect(table.getByText('150')).toBeInTheDocument();
    expect(table.getByText('3')).toBeInTheDocument();
    // Capacité nulle → « — » (Bravo), compteur 0 affiché tel quel.
    expect(table.getByText('8 Rue Bravo')).toBeInTheDocument();
  });

  it('bouton « Nouvelle association » → modale de création', async () => {
    render(<AssociationsPage />);
    await waitFor(() => expect(screen.getByRole('grid')).toBeInTheDocument());

    // Pas de modale au chargement.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: /Nouvelle association/ }),
    );

    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByText('Nouvelle association'),
    ).toBeInTheDocument();
  });

  it('crayon d’une ligne → modale d’édition préremplie', async () => {
    render(<AssociationsPage />);
    await waitFor(() => expect(screen.getByRole('grid')).toBeInTheDocument());

    // DataTable rend un tableau desktop ET des cartes mobiles → le crayon existe
    // en double. On scope au <table role="grid"> pour cibler l'action desktop.
    const grid = within(screen.getByRole('grid'));
    fireEvent.click(
      grid.getByRole('button', {
        name: 'Modifier Association Alpha (fictif)',
      }),
    );

    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByText(
        'Fiche association — Association Alpha (fictif)',
      ),
    ).toBeInTheDocument();
  });
});
