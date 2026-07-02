/**
 * M0.6 — Formulaire CRUD lieu Admin (BL-P1-BOA-03).
 * 8 champs visibles programmation + 4 champs admin/ops-only (RLS column-level).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const pushMock = vi.fn();
const refreshMock = vi.fn();
const backMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock, back: backMock }),
}));

import { LieuForm } from '@/components/admin/lieu-form';

describe('M0.6 — formulaire lieu CRUD Admin (BL-P1-BOA-03)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('M0.6 — rend les champs visibles programmation + admin/ops-only', () => {
    render(<LieuForm />);
    expect(screen.getByLabelText(/Nom du lieu/)).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Adresse accès livraison/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Code postal/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Ville/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Accès office/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Stationnement/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Type de véhicule max/)).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Contrôle d'accès requis/),
    ).toBeInTheDocument();
    // Admin/ops only
    expect(screen.getByLabelText(/^SIREN/)).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Mail gestionnaire du lieu/),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Commentaire sur le lieu/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Référencé Citeo/)).toBeInTheDocument();
    // Pas de champ "Contact sur place" (divergence BOA-LIEUX_20260702)
    expect(screen.queryByLabelText(/Contact sur place/)).toBeNull();
  });

  it('M0.6 — soumission valide → POST lieux puis redirection', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'lieu-1' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<LieuForm />);

    fireEvent.change(screen.getByLabelText(/Nom du lieu/), {
      target: { value: 'Château de Saint-Cloud' },
    });
    fireEvent.change(screen.getByLabelText(/Adresse accès livraison/), {
      target: { value: '1 avenue de Paris' },
    });
    fireEvent.change(screen.getByLabelText(/Code postal/), {
      target: { value: '92210' },
    });
    fireEvent.change(screen.getByLabelText(/Ville/), {
      target: { value: 'Saint-Cloud' },
    });
    fireEvent.change(screen.getByLabelText(/Type de véhicule max/), {
      target: { value: 'fourgon' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Créer le lieu/ }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/admin/lieux',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith('/admin/lieux/lieu-1'),
    );
  });

  it('M0.6 — SIREN invalide bloque la soumission', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<LieuForm />);

    fireEvent.change(screen.getByLabelText(/Nom du lieu/), {
      target: { value: 'Château de Saint-Cloud' },
    });
    fireEvent.change(screen.getByLabelText(/Adresse accès livraison/), {
      target: { value: '1 avenue de Paris' },
    });
    fireEvent.change(screen.getByLabelText(/Code postal/), {
      target: { value: '92210' },
    });
    fireEvent.change(screen.getByLabelText(/Ville/), {
      target: { value: 'Saint-Cloud' },
    });
    fireEvent.change(screen.getByLabelText(/Type de véhicule max/), {
      target: { value: 'fourgon' },
    });
    fireEvent.change(screen.getByLabelText(/^SIREN/), {
      target: { value: 'abc' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Créer le lieu/ }));

    expect(await screen.findByText(/SIREN : 9 chiffres/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
