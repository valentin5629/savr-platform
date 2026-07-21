/**
 * M1.1b — Modale création/édition transporteur (BL-P1-BOA-02).
 * Ouverte depuis la liste /admin/transporteurs (clic ligne ou « Nouveau »).
 * Chips véhicules/collecte, code_transporteur_mts1 conditionnel, POST/PATCH,
 * Désactiver = PATCH { actif:false }.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

import {
  TransporteurModal,
  type TransporteurRecord,
} from '@/components/admin/transporteur-modal';

const EDIT_FIXTURE: TransporteurRecord = {
  id: 'transp-42',
  nom: 'Strike Logistique',
  siren: '123456789',
  contact_nom: 'Alex Martin',
  contact_telephone: '0102030405',
  contact_email: 'contact@strike.fr',
  adresse: '10 rue de Lyon',
  code_postal: '75012',
  ville: 'Paris',
  types_vehicules: ['camionnette'],
  types_collecte: ['zero_dechet'],
  type_tms: 'autre',
  description_process_collecte: null,
  code_transporteur_mts1: null,
  actif: true,
};

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
  fireEvent.change(screen.getByLabelText(/Téléphone/), {
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
  fireEvent.click(screen.getByRole('button', { name: 'Camionnette' }));
}

describe('M1.1b — modale transporteur (BL-P1-BOA-02)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('code_transporteur_mts1 masqué tant que type_tms ≠ mts1', () => {
    render(
      <TransporteurModal
        open
        transporteur={null}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
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

  it('bloque la soumission si type_tms=mts1 sans code', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(
      <TransporteurModal
        open
        transporteur={null}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

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

  it('création (type_tms=autre) → POST + onSaved/onClose', async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'transp-1' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <TransporteurModal
        open
        transporteur={null}
        onClose={onClose}
        onSaved={onSaved}
      />,
    );

    fillCommonFields();
    fireEvent.change(screen.getByLabelText(/Type de TMS/), {
      target: { value: 'autre' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Anti-Gaspi (AG)' }));
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
      types_collecte: string[] | null;
      type_tms: string;
      code_transporteur_mts1: string | null;
    };
    expect(body.types_vehicules).toEqual(['camionnette']);
    expect(body.types_collecte).toEqual(['anti_gaspi']);
    expect(body.type_tms).toBe('autre');
    expect(body.code_transporteur_mts1).toBeNull();

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it('édition → PATCH /transporteurs/{id} avec les champs modifiés', async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: EDIT_FIXTURE.id }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <TransporteurModal
        open
        transporteur={EDIT_FIXTURE}
        onClose={onClose}
        onSaved={onSaved}
      />,
    );

    // Champ prérempli puis modifié.
    fireEvent.change(screen.getByLabelText(/Nom du transporteur/), {
      target: { value: 'Strike Logistique 2' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Enregistrer/ }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/v1/admin/transporteurs/${EDIT_FIXTURE.id}`,
        expect.objectContaining({ method: 'PATCH' }),
      ),
    );
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string) as { nom: string };
    expect(body.nom).toBe('Strike Logistique 2');
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('Désactiver → PATCH { actif:false } + onSaved/onClose', async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <TransporteurModal
        open
        transporteur={EDIT_FIXTURE}
        onClose={onClose}
        onSaved={onSaved}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Désactiver/ }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/v1/admin/transporteurs/${EDIT_FIXTURE.id}`,
        expect.objectContaining({ method: 'PATCH' }),
      ),
    );
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string) as { actif: boolean };
    expect(body.actif).toBe(false);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });
});
