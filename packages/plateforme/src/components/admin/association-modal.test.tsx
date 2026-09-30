/**
 * E2E (revue-écran) — Modale création/édition association.
 * Ouverte depuis la liste /admin/associations (clic ligne ou « Nouvelle »).
 * Champs identité/adresse/contact/horaires/rapport/admin, POST/PATCH,
 * Désactiver = PATCH { actif:false }. Miroir de la modale transporteur.
 * Gabarit fiche collecte (2026-09-30) : colonne résumé + 4 onglets
 * (Informations / Logistique / Rapport client / Administratif). Les onglets
 * restent montés (forceMount), d'où des champs trouvables sans changer d'onglet.
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
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

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
  numero_rup: 'W751234567',
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
  // Combobox (DS règle 3) : ouvrir le déclencheur puis choisir l'option.
  fireEvent.click(screen.getByRole('combobox', { name: /Région/ }));
  fireEvent.click(screen.getByRole('option', { name: 'Île-de-France' }));
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

function onglet(nom: RegExp): HTMLElement {
  return screen.getByRole('tab', { name: nom });
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

  it(
    'bloque la soumission si description < 30 caractères',
    async () => {
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
        await screen.findByText(/30 caractères minimum/, undefined, ATTENTE_UI),
      ).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
      // Le message vit dans l'onglet Rapport client : la modale l'ouvre, sinon
      // l'erreur resterait invisible depuis Informations.
      expect(onglet(/Rapport client/)).toHaveAttribute('aria-selected', 'true');
      expect(onglet(/Rapport client/)).toHaveAccessibleName(
        'Rapport client (1 champ à corriger)',
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'bloque la soumission si SIREN ≠ 9 chiffres',
    async () => {
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
      // SIREN est optionnel mais, s'il est renseigné, doit faire 9 chiffres.
      fireEvent.change(screen.getByLabelText(/^SIREN/), {
        target: { value: '123' },
      });
      fireEvent.click(
        screen.getByRole('button', { name: /Créer l.association/ }),
      );

      expect(
        await screen.findByText(/SIREN : 9 chiffres/, undefined, ATTENTE_UI),
      ).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(onglet(/Administratif/)).toHaveAttribute('aria-selected', 'true');
    },
    ATTENTE_CAS_MS,
  );

  it('4 onglets, « Informations » ouvert par défaut', () => {
    render(
      <AssociationModal
        open
        association={EDIT_FIXTURE}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Informations',
      'Logistique',
      'Rapport client',
      'Administratif',
    ]);
    expect(onglet(/Informations/)).toHaveAttribute('aria-selected', 'true');
  });

  it('clic sur un onglet → il devient l’onglet actif', () => {
    render(
      <AssociationModal
        open
        association={EDIT_FIXTURE}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    // Radix active un onglet au mousedown (bouton gauche).
    fireEvent.mouseDown(onglet(/Logistique/), { button: 0 });
    expect(onglet(/Logistique/)).toHaveAttribute('aria-selected', 'true');
    expect(onglet(/Informations/)).toHaveAttribute('aria-selected', 'false');
  });

  it(
    'création vide → premier onglet fautif ouvert + compteur par onglet',
    async () => {
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

      // On part d'un autre onglet : l'échec doit ramener au premier fautif.
      fireEvent.mouseDown(onglet(/Administratif/), { button: 0 });
      fireEvent.click(
        screen.getByRole('button', { name: /Créer l.association/ }),
      );

      await waitFor(
        () =>
          expect(onglet(/Informations/)).toHaveAttribute(
            'aria-selected',
            'true',
          ),
        ATTENTE_UI,
      );
      // 8 obligatoires dans Informations, la description dans Rapport client,
      // rien dans Logistique ni Administratif (SIREN vide = facultatif).
      expect(onglet(/Informations/)).toHaveAccessibleName(
        'Informations (8 champs à corriger)',
      );
      expect(onglet(/Rapport client/)).toHaveAccessibleName(
        'Rapport client (1 champ à corriger)',
      );
      expect(onglet(/Logistique/)).toHaveAccessibleName('Logistique');
      expect(onglet(/Administratif/)).toHaveAccessibleName('Administratif');
      expect(fetchMock).not.toHaveBeenCalled();
    },
    ATTENTE_CAS_MS,
  );

  it('colonne résumé : reprend la fiche et suit la saisie', () => {
    render(
      <AssociationModal
        open
        association={EDIT_FIXTURE}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    const resume = screen.getByRole('complementary', {
      name: /Résumé de l'association/,
    });
    expect(within(resume).getByText('Association Alpha')).toBeInTheDocument();
    expect(within(resume).getByText('Active')).toBeInTheDocument();
    expect(within(resume).getByText('Paris')).toBeInTheDocument();
    expect(within(resume).getByText('Île-de-France')).toBeInTheDocument();
    expect(within(resume).getByText('150 repas')).toBeInTheDocument();
    expect(within(resume).getByText('Marie Curie')).toBeInTheDocument();
    expect(within(resume).getByText('Non')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Nom de l'association/), {
      target: { value: 'Association Beta' },
    });
    expect(within(resume).getByText('Association Beta')).toBeInTheDocument();
  });

  it(
    'création → POST /associations + onSaved/onClose',
    async () => {
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

      await waitFor(
        () =>
          expect(fetchMock).toHaveBeenCalledWith(
            '/api/v1/admin/associations',
            expect.objectContaining({ method: 'POST' }),
          ),
        ATTENTE_UI,
      );
      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string) as {
        region: string;
        capacite_max_beneficiaires: number | null;
      };
      expect(body.region).toBe('idf');
      expect(body.capacite_max_beneficiaires).toBe(150);

      await waitFor(() => expect(onSaved).toHaveBeenCalled(), ATTENTE_UI);
      expect(onClose).toHaveBeenCalled();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'édition → PATCH /associations/{id} avec les champs modifiés',
    async () => {
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

      await waitFor(
        () =>
          expect(fetchMock).toHaveBeenCalledWith(
            `/api/v1/admin/associations/${EDIT_FIXTURE.id}`,
            expect.objectContaining({ method: 'PATCH' }),
          ),
        ATTENTE_UI,
      );
      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string) as { nom: string };
      expect(body.nom).toBe('Association Alpha 2');
      await waitFor(() => expect(onSaved).toHaveBeenCalled(), ATTENTE_UI);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'Désactiver → PATCH { actif:false } + onSaved/onClose',
    async () => {
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

      await waitFor(
        () =>
          expect(fetchMock).toHaveBeenCalledWith(
            `/api/v1/admin/associations/${EDIT_FIXTURE.id}`,
            expect.objectContaining({ method: 'PATCH' }),
          ),
        ATTENTE_UI,
      );
      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string) as { actif: boolean };
      expect(body.actif).toBe(false);
      await waitFor(() => expect(onSaved).toHaveBeenCalled(), ATTENTE_UI);
      expect(onClose).toHaveBeenCalled();
    },
    ATTENTE_CAS_MS,
  );

  // §04 associations.numero_rup + §06.06 §5 « N° RUP » (arbitrage Val 2026-09-14) :
  // saisie dans la modale, facultative, source de l'instantané du Cerfa 2041-GE.
  it(
    'création → N° RUP saisi part dans le POST',
    async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'asso-1' }),
      });
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
      fireEvent.change(screen.getByLabelText(/N° RUP/), {
        target: { value: ' W751234567 ' },
      });
      fireEvent.click(
        screen.getByRole('button', { name: /Créer l.association/ }),
      );

      await waitFor(() => expect(fetchMock).toHaveBeenCalled(), ATTENTE_UI);
      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string) as {
        numero_rup: string | null;
      };
      expect(body.numero_rup).toBe('W751234567');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'création sans N° RUP → null dans le POST (champ facultatif)',
    async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'asso-1' }),
      });
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
      fireEvent.click(
        screen.getByRole('button', { name: /Créer l.association/ }),
      );

      await waitFor(() => expect(fetchMock).toHaveBeenCalled(), ATTENTE_UI);
      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string) as {
        numero_rup: string | null;
      };
      expect(body.numero_rup).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'édition → N° RUP prérempli depuis la fiche et renvoyé au PATCH',
    async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: EDIT_FIXTURE.id }),
      });
      vi.stubGlobal('fetch', fetchMock);
      render(
        <AssociationModal
          open
          association={EDIT_FIXTURE}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />,
      );

      const champ = screen.getByLabelText(/N° RUP/) as HTMLInputElement;
      expect(champ.value).toBe('W751234567');

      fireEvent.change(champ, { target: { value: 'W920000001' } });
      fireEvent.click(screen.getByRole('button', { name: /Enregistrer/ }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalled(), ATTENTE_UI);
      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string) as { numero_rup: string };
      expect(body.numero_rup).toBe('W920000001');
    },
    ATTENTE_CAS_MS,
  );
});
