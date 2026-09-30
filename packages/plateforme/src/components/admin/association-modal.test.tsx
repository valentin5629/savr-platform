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
    expect(screen.getByRole('dialog')).toHaveAccessibleName(
      'Nouvelle association',
    );
    expect(
      screen.getByRole('heading', { level: 3, name: 'Nouvelle association' }),
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

      // La modale prend le focus à l'ouverture (minuteur) : l'attendre, comme
      // un utilisateur réel, sinon il écraserait le focus posé par l'échec.
      await waitFor(
        () => expect(screen.getByRole('dialog')).toHaveFocus(),
        ATTENTE_UI,
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

      // Focus sur l'onglet fautif : il devient l'onglet atteignable au clavier
      // (sinon Maj+Tab rouvrirait « Administratif » et cacherait les erreurs).
      expect(onglet(/Informations/)).toHaveFocus();
      expect(onglet(/Informations/)).toHaveAttribute('tabindex', '0');
      expect(onglet(/Administratif/)).toHaveAttribute('tabindex', '-1');

      // Un champ corrigé retire son erreur du compteur, sans nouvel envoi.
      fireEvent.change(screen.getByLabelText(/Nom de l'association/), {
        target: { value: 'Association Alpha' },
      });
      expect(onglet(/Informations/)).toHaveAccessibleName(
        'Informations (7 champs à corriger)',
      );
    },
    ATTENTE_CAS_MS,
  );

  it('réouverture → retour sur « Informations »', () => {
    const props = {
      association: EDIT_FIXTURE,
      onClose: vi.fn(),
      onSaved: vi.fn(),
    };
    const { rerender } = render(<AssociationModal open {...props} />);
    fireEvent.mouseDown(onglet(/Administratif/), { button: 0 });
    expect(onglet(/Administratif/)).toHaveAttribute('aria-selected', 'true');

    rerender(<AssociationModal open={false} {...props} />);
    rerender(<AssociationModal open {...props} />);
    expect(onglet(/Informations/)).toHaveAttribute('aria-selected', 'true');
  });

  it('en-tête : région, ville, capacité et statut de l’association enregistrée', () => {
    render(
      <AssociationModal
        open
        association={{ ...EDIT_FIXTURE, siren: '123456789' }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    expect(screen.getByRole('dialog')).toHaveAccessibleName(
      'Fiche association — Association Alpha',
    );
    const titre = screen.getByRole('heading', {
      level: 3,
      name: 'Association Alpha',
    });
    const enTete = titre.closest('header') as HTMLElement;
    expect(within(enTete).getByText('IDF')).toBeInTheDocument();
    expect(within(enTete).getByText('SIREN 123 456 789')).toBeInTheDocument();
    expect(within(enTete).getByText('Paris')).toBeInTheDocument();
    expect(within(enTete).getByText('150 repas')).toBeInTheDocument();
    expect(within(enTete).getByText('Active')).toBeInTheDocument();

    // L'en-tête décrit la fiche enregistrée : il ne suit pas la saisie.
    fireEvent.change(screen.getByLabelText(/Nom de l'association/), {
      target: { value: 'Association Beta' },
    });
    expect(
      screen.getByRole('heading', { level: 3, name: 'Association Alpha' }),
    ).toBeInTheDocument();
  });

  it('pas de colonne résumé : l’en-tête et les onglets seuls', () => {
    render(
      <AssociationModal
        open
        association={EDIT_FIXTURE}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    // Décision Val 2026-09-30 : colonne résumé supprimée, onglets seuls.
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(
      screen.getByRole('heading', { level: 3, name: 'Association Alpha' }),
    ).toBeInTheDocument();
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
  it('en-tête : association inactive', () => {
    render(
      <AssociationModal
        open
        association={{ ...EDIT_FIXTURE, actif: false }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    const enTete = screen
      .getByRole('heading', { level: 3, name: 'Association Alpha' })
      .closest('header') as HTMLElement;
    expect(within(enTete).getByText('Inactive')).toBeInTheDocument();
  });

  it('en-tête en création : « Nouvelle association », pas de statut', () => {
    render(
      <AssociationModal
        open
        association={null}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    const enTete = screen
      .getByRole('heading', { level: 3, name: 'Nouvelle association' })
      .closest('header') as HTMLElement;
    expect(within(enTete).queryByText(/Active|Inactive/)).toBeNull();
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('une saisie survit au changement d’onglet ; l’onglet inactif est masqué', () => {
    render(
      <AssociationModal
        open
        association={EDIT_FIXTURE}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    fireEvent.mouseDown(onglet(/Logistique/), { button: 0 });
    fireEvent.change(screen.getByLabelText(/Instructions d'accès/), {
      target: { value: 'Quai n°3, sonner à l’accueil' },
    });
    fireEvent.mouseDown(onglet(/Administratif/), { button: 0 });
    fireEvent.mouseDown(onglet(/Logistique/), { button: 0 });
    expect(
      (screen.getByLabelText(/Instructions d'accès/) as HTMLTextAreaElement)
        .value,
    ).toBe('Quai n°3, sonner à l’accueil');

    // Masquage : Radix marque le panneau inactif, la classe DS le cache
    // (jsdom ne charge pas le CSS, on vérifie le couple attribut + classe).
    const panneauInfos = screen.getByRole('tabpanel', {
      name: /Informations/,
      hidden: true,
    });
    expect(panneauInfos).toHaveAttribute('data-state', 'inactive');
    expect(panneauInfos.className).toContain('data-[state=inactive]:hidden');
  });

  it(
    'erreur serveur → message en tête de modale (role=alert), modale ouverte',
    async () => {
      const onClose = vi.fn();
      // scrollIntoView est un no-op posé par vitest.setup (jsdom ne l'a pas).
      const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Nom déjà utilisé' }),
      });
      vi.stubGlobal('fetch', fetchMock);
      render(
        <AssociationModal
          open
          association={EDIT_FIXTURE}
          onClose={onClose}
          onSaved={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /Enregistrer/ }));

      expect(
        await screen.findByRole('alert', undefined, ATTENTE_UI),
      ).toHaveTextContent('Nom déjà utilisé');
      expect(onClose).not.toHaveBeenCalled();
      // Ramenée à l'écran même si l'onglet ouvert a été défilé.
      await waitFor(
        () => expect(scrollIntoView).toHaveBeenCalled(),
        ATTENTE_UI,
      );
    },
    ATTENTE_CAS_MS,
  );
});
