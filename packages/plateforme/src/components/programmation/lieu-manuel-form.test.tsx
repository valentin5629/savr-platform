/**
 * M0.6 — Quick-add lieu hors référentiel (BL-P1-BOA-03, §06.01).
 * Extension aux 7 champs avec colonne DB réelle (nom, adresse_acces, code_postal,
 * ville, stationnement, type_vehicule_max, acces_office). « Contact sur place »
 * volontairement absent — divergence _Divergences/BOA-LIEUX_20260702.md (pas de
 * colonne DB correspondante, ni V1 ni DDL cible V2).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LieuManuelForm } from './lieu-manuel-form';

describe('M0.6 — quick-add lieu manuel (BL-P1-BOA-03)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('M0.6 — rend les 3 champs optionnels supplémentaires (véhicule max, stationnement, accès office)', () => {
    render(<LieuManuelForm onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByLabelText(/Type de véhicule max/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Stationnement/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Accès office/)).toBeInTheDocument();
    // Champ orphelin CDC non implémenté (divergence)
    expect(screen.queryByLabelText(/Contact sur place/)).toBeNull();
  });

  it('M0.6 — envoie les champs optionnels renseignés, omet ceux laissés vides', async () => {
    const onSave = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'l-1', nom: 'X', adresse_acces: 'Y' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<LieuManuelForm onSave={onSave} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('Nom du lieu *'), {
      target: { value: 'Château de Saint-Cloud' },
    });
    fireEvent.change(
      screen.getByPlaceholderText("Adresse d'accès livraison *"),
      { target: { value: '1 avenue de Paris' } },
    );
    fireEvent.change(screen.getByPlaceholderText('Code postal *'), {
      target: { value: '92210' },
    });
    fireEvent.change(screen.getByPlaceholderText('Ville *'), {
      target: { value: 'Saint-Cloud' },
    });
    fireEvent.change(screen.getByLabelText(/Type de véhicule max/), {
      target: { value: 'fourgon' },
    });
    // stationnement et acces_office laissés vides

    fireEvent.click(screen.getByRole('button', { name: /Ajouter ce lieu/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string) as Record<string, unknown>;
    expect(body.type_vehicule_max).toBe('fourgon');
    expect(body.stationnement).toBeUndefined();
    expect(body.acces_office).toBeUndefined();
    await waitFor(() => expect(onSave).toHaveBeenCalled());
  });
});
