/**
 * M0.6 — Formulaire création/édition association (BL-P1-BOA-01).
 * Tous les champs CDC §5 sauf « upload logo » (divergence _Divergences/BOA_20260702.md :
 * pas de colonne logo sur `associations`, ni V1 ni DDL cible V2).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const pushMock = vi.fn();
const refreshMock = vi.fn();
const backMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock, back: backMock }),
}));

import { AssociationForm } from '@/components/admin/association-form';

describe('M0.6 — formulaire association (BL-P1-BOA-01)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('M0.6 — pas de champ upload logo (divergence BOA_20260702)', () => {
    render(<AssociationForm />);
    expect(screen.queryByLabelText(/logo/i)).toBeNull();
  });

  it('M0.6 — rend les champs obligatoires du formulaire de création', () => {
    render(<AssociationForm />);
    expect(screen.getByLabelText(/Nom de l'association/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Adresse/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Ville/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Région/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Nom prénom du contact/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Numéro de contact/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Email\(s\) à prévenir/)).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Capacité max bénéficiaires/),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Description pour le rapport d'impact/),
    ).toBeInTheDocument();
    expect(screen.getByTestId('horaires-ouverture-editor')).toBeInTheDocument();
    expect(screen.getByLabelText(/Habilitation 2041-GE/)).toBeInTheDocument();
  });

  it('M0.6 — bloque la soumission si description rapport d’impact < 30 caractères', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<AssociationForm />);

    fireEvent.change(screen.getByLabelText(/Nom de l'association/), {
      target: { value: 'Les Restos' },
    });
    fireEvent.change(screen.getByLabelText(/^Adresse/), {
      target: { value: '1 rue de Paris' },
    });
    fireEvent.change(screen.getByLabelText(/Ville/), {
      target: { value: 'Paris' },
    });
    fireEvent.change(screen.getByLabelText(/Région/), {
      target: { value: 'idf' },
    });
    fireEvent.change(screen.getByLabelText(/Nom prénom du contact/), {
      target: { value: 'Jean Dupont' },
    });
    fireEvent.change(screen.getByLabelText(/Numéro de contact/), {
      target: { value: '0102030405' },
    });
    fireEvent.change(screen.getByLabelText(/Email\(s\) à prévenir/), {
      target: { value: 'contact@asso.fr' },
    });
    fireEvent.change(screen.getByLabelText(/Capacité max bénéficiaires/), {
      target: { value: '100' },
    });
    fireEvent.change(
      screen.getByLabelText(/Description pour le rapport d'impact/),
      { target: { value: 'trop court' } },
    );

    fireEvent.click(
      screen.getByRole('button', { name: /Créer l’association/ }),
    );

    expect(
      await screen.findByText(/30 caractères minimum/),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('M0.6 — soumission valide → POST associations puis redirection', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'asso-1' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<AssociationForm />);

    fireEvent.change(screen.getByLabelText(/Nom de l'association/), {
      target: { value: 'Les Restos' },
    });
    fireEvent.change(screen.getByLabelText(/^Adresse/), {
      target: { value: '1 rue de Paris' },
    });
    fireEvent.change(screen.getByLabelText(/Ville/), {
      target: { value: 'Paris' },
    });
    fireEvent.change(screen.getByLabelText(/Région/), {
      target: { value: 'idf' },
    });
    fireEvent.change(screen.getByLabelText(/Nom prénom du contact/), {
      target: { value: 'Jean Dupont' },
    });
    fireEvent.change(screen.getByLabelText(/Numéro de contact/), {
      target: { value: '0102030405' },
    });
    fireEvent.change(screen.getByLabelText(/Email\(s\) à prévenir/), {
      target: { value: 'contact@asso.fr' },
    });
    fireEvent.change(screen.getByLabelText(/Capacité max bénéficiaires/), {
      target: { value: '100' },
    });
    fireEvent.change(
      screen.getByLabelText(/Description pour le rapport d'impact/),
      {
        target: {
          value:
            'Une description suffisamment longue pour passer la validation.',
        },
      },
    );

    fireEvent.click(
      screen.getByRole('button', { name: /Créer l’association/ }),
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/admin/associations',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith('/admin/associations/asso-1'),
    );
  });

  it('M0.6 — mode édition : PATCH vers l’association ciblée', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'asso-1' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <AssociationForm
        associationId="asso-1"
        initialValues={{
          nom: 'Les Restos',
          adresse: '1 rue de Paris',
          ville: 'Paris',
          region: 'idf',
          contact_nom: 'Jean Dupont',
          contact_telephone: '0102030405',
          contact_email: 'contact@asso.fr',
          capacite_max_beneficiaires: '100',
          description_rapport_impact:
            'Une description suffisamment longue pour passer la validation.',
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Enregistrer/ }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/admin/associations/asso-1',
        expect.objectContaining({ method: 'PATCH' }),
      ),
    );
  });
});
