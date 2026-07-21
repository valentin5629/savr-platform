/**
 * E2E (revue-écran) — Modale création/édition association.
 * Ouverte depuis la liste /admin/associations (clic ligne ou « Nouvelle »).
 * Champs identité/adresse/contact/horaires/rapport/admin, POST/PATCH,
 * Désactiver = PATCH { actif:false }. Miroir de la modale transporteur.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  waitFor,
  fireEvent,
  within,
} from '@testing-library/react';

import {
  AssociationModal,
  type AssociationRecord,
} from '@/components/admin/association-modal';

const DESCRIPTION_OK =
  'Distribue des repas chauds aux personnes en situation de précarité à Paris.';

const EDIT_FIXTURE: AssociationRecord = {
  id: 'asso-42',
  nom: 'Association Alpha',
  adresse: '1 rue Asso',
  region: 'idf',
  ville: 'Paris',
  contact_nom: 'Marie Curie',
  contact_email: 'contact@alpha.org',
  contact_telephone: '0102030405',
  capacite_max_beneficiaires: 150,
  types_aliments_acceptes: ['Frais'],
  description_rapport_impact: DESCRIPTION_OK,
  commentaires_internes: null,
  instructions_acces: null,
  siren: null,
  logo_url: null,
  id_point_collecte_mts1: null,
  habilitee_attestation_fiscale: false,
  date_expiration_habilitation: null,
  actif: true,
  horaires_ouverture: null,
};

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText(/Nom de l'association/), {
    target: { value: 'Association Alpha' },
  });
  fireEvent.change(screen.getByLabelText(/Capacité max bénéficiaires/), {
    target: { value: '150' },
  });
  fireEvent.change(screen.getByLabelText(/^Adresse/), {
    target: { value: '1 rue Asso' },
  });
  fireEvent.change(screen.getByLabelText(/^Ville/), {
    target: { value: 'Paris' },
  });
  fireEvent.change(screen.getByLabelText(/Région/), {
    target: { value: 'idf' },
  });
  fireEvent.change(screen.getByLabelText(/Nom prénom du contact/), {
    target: { value: 'Marie Curie' },
  });
  fireEvent.change(screen.getByLabelText(/Numéro de contact/), {
    target: { value: '0102030405' },
  });
  fireEvent.change(screen.getByLabelText(/Email\(s\) à prévenir/), {
    target: { value: 'contact@alpha.org' },
  });
  fireEvent.change(
    screen.getByLabelText(/Description pour le rapport d'impact/),
    { target: { value: DESCRIPTION_OK } },
  );
}

describe('M1.1 — Modale association (revue E2E)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('titre = « Nouvelle association » en création', () => {
    render(
      <AssociationModal
        open
        association={null}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByText('Nouvelle association'),
    ).toBeInTheDocument();
  });

  it('bloque la soumission si description < 30 caractères', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(
      <AssociationModal
        open
        association={null}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    fillRequiredFields();
    fireEvent.change(
      screen.getByLabelText(/Description pour le rapport d'impact/),
      { target: { value: 'Trop court' } },
    );
    fireEvent.click(
      screen.getByRole('button', { name: /Créer l.association/ }),
    );

    expect(
      await screen.findByText(/30 caractères minimum/),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('création → POST /associations + onSaved/onClose', async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'asso-1' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <AssociationModal
        open
        association={null}
        onClose={onClose}
        onSaved={onSaved}
      />,
    );

    fillRequiredFields();
    fireEvent.click(
      screen.getByRole('button', { name: /Créer l.association/ }),
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/admin/associations',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string) as {
      region: string;
      capacite_max_beneficiaires: number | null;
    };
    expect(body.region).toBe('idf');
    expect(body.capacite_max_beneficiaires).toBe(150);

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it('édition → PATCH /associations/{id} avec les champs modifiés', async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: EDIT_FIXTURE.id }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <AssociationModal
        open
        association={EDIT_FIXTURE}
        onClose={onClose}
        onSaved={onSaved}
      />,
    );

    // Champ prérempli puis modifié.
    fireEvent.change(screen.getByLabelText(/Nom de l'association/), {
      target: { value: 'Association Alpha 2' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Enregistrer/ }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/v1/admin/associations/${EDIT_FIXTURE.id}`,
        expect.objectContaining({ method: 'PATCH' }),
      ),
    );
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string) as { nom: string };
    expect(body.nom).toBe('Association Alpha 2');
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
      <AssociationModal
        open
        association={EDIT_FIXTURE}
        onClose={onClose}
        onSaved={onSaved}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Désactiver/ }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/v1/admin/associations/${EDIT_FIXTURE.id}`,
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
