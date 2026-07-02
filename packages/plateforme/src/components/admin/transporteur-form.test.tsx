/**
 * M0.6 — Formulaire création/édition transporteur (BL-P1-BOA-02).
 * Select multi-enum types_vehicules, select type_tms, code_transporteur_mts1 conditionnel.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  waitFor,
  fireEvent,
  within,
} from '@testing-library/react';

const pushMock = vi.fn();
const refreshMock = vi.fn();
const backMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock, back: backMock }),
}));

import { TransporteurForm } from '@/components/admin/transporteur-form';

function fillCommonFields() {
  fireEvent.change(screen.getByLabelText(/Nom du transporteur/), {
    target: { value: 'Strike Logistique' },
  });
  fireEvent.change(screen.getByLabelText(/SIREN/), {
    target: { value: '123456789' },
  });
  fireEvent.change(screen.getByLabelText(/Nom du contact/), {
    target: { value: 'Alex Martin' },
  });
  fireEvent.change(screen.getByLabelText(/Numéro de téléphone/), {
    target: { value: '0102030405' },
  });
  fireEvent.change(screen.getByLabelText(/Mail de contact/), {
    target: { value: 'contact@strike.fr' },
  });
  fireEvent.change(screen.getByLabelText(/^Adresse/), {
    target: { value: '10 rue de Lyon' },
  });
  fireEvent.change(screen.getByLabelText(/Code postal/), {
    target: { value: '75012' },
  });
  fireEvent.change(screen.getByLabelText(/Ville/), {
    target: { value: 'Paris' },
  });
  fireEvent.click(screen.getByLabelText(/Camionnette/));
}

describe('M0.6 — formulaire transporteur (BL-P1-BOA-02)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('M0.6 — code_transporteur_mts1 masqué tant que type_tms ≠ mts1', () => {
    render(<TransporteurForm />);
    expect(
      screen.queryByLabelText(/Code transporteur MTS-1/),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Type de TMS/), {
      target: { value: 'a_toutes' },
    });
    expect(
      screen.queryByLabelText(/Code transporteur MTS-1/),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Type de TMS/), {
      target: { value: 'mts1' },
    });
    expect(
      screen.getByLabelText(/Code transporteur MTS-1/),
    ).toBeInTheDocument();
  });

  it('M0.6 — bloque la soumission si type_tms=mts1 sans code_transporteur_mts1', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<TransporteurForm />);

    fillCommonFields();
    fireEvent.change(screen.getByLabelText(/Type de TMS/), {
      target: { value: 'mts1' },
    });

    fireEvent.click(
      screen.getByRole('button', { name: /Créer le transporteur/ }),
    );

    expect(
      await screen.findByText(/Code transporteur MTS-1 obligatoire/),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('M0.6 — soumission valide (type_tms=autre) → POST transporteurs', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'transp-1' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<TransporteurForm />);

    fillCommonFields();
    fireEvent.change(screen.getByLabelText(/Type de TMS/), {
      target: { value: 'autre' },
    });

    fireEvent.click(
      screen.getByRole('button', { name: /Créer le transporteur/ }),
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/admin/transporteurs',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string) as {
      types_vehicules: string[];
      code_transporteur_mts1: string | null;
    };
    expect(body.types_vehicules).toEqual(['camionnette']);
    expect(body.code_transporteur_mts1).toBeNull();

    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith('/admin/transporteurs/transp-1'),
    );
  });

  // R17b (Val 2026-07-02) — champs ajoutés à la revue.
  it('M0.6 — options type_tms par_mail / par_telephone présentes', () => {
    render(<TransporteurForm />);
    const select = screen.getByLabelText(/Type de TMS/);
    expect(
      within(select).getByRole('option', { name: /Par mail/ }),
    ).toBeInTheDocument();
    expect(
      within(select).getByRole('option', { name: /Par téléphone/ }),
    ).toBeInTheDocument();
  });

  it('M0.6 — types_collecte (AG/ZD) multi + description process envoyés au POST', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'transp-2' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<TransporteurForm />);

    fillCommonFields();
    fireEvent.change(screen.getByLabelText(/Type de TMS/), {
      target: { value: 'par_mail' },
    });
    fireEvent.click(screen.getByLabelText(/Anti-Gaspi \(AG\)/));
    fireEvent.click(screen.getByLabelText(/Zéro Déchet \(ZD\)/));
    fireEvent.change(
      screen.getByLabelText(/Description process de création de collecte/),
      { target: { value: 'Appeler le dispatcher au 06…' } },
    );

    fireEvent.click(
      screen.getByRole('button', { name: /Créer le transporteur/ }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string) as {
      types_collecte: string[] | null;
      type_tms: string;
      description_process_collecte: string | null;
    };
    expect(body.types_collecte).toEqual(['anti_gaspi', 'zero_dechet']);
    expect(body.type_tms).toBe('par_mail');
    expect(body.description_process_collecte).toContain('dispatcher');
    // par_mail ne demande PAS de code MTS-1
    expect(
      screen.queryByLabelText(/Code transporteur MTS-1/),
    ).not.toBeInTheDocument();
  });
});
