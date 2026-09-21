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
  type PrestataireOption,
  type TransporteurRecord,
} from '@/components/admin/transporteur-modal';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

const EDIT_FIXTURE_ID = 'transp-42';

const EDIT_FIXTURE: TransporteurRecord = {
  id: EDIT_FIXTURE_ID,
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
  prestataire_logistique_id: null,
  actif: true,
};

const PRESTATAIRES: PrestataireOption[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    nom: 'A Toutes!',
    code: 'ATOUTES',
    statut: 'actif',
    transporteur_id: null,
    transporteur_nom: null,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    nom: 'Strike',
    code: 'STRIKE',
    statut: 'actif',
    transporteur_id: 'transp-autre',
    transporteur_nom: 'Strike Paris',
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    nom: 'Marathon',
    code: 'MARATHON',
    statut: 'actif',
    transporteur_id: EDIT_FIXTURE_ID,
    transporteur_nom: 'Strike Logistique',
  },
];

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

  it(
    'bloque la soumission si type_tms=mts1 sans code',
    async () => {
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
        await screen.findByText(
          /Code transporteur MTS-1 obligatoire/,
          undefined,
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'création (type_tms=autre) → POST + onSaved/onClose',
    async () => {
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

      await waitFor(
        () =>
          expect(fetchMock).toHaveBeenCalledWith(
            '/api/v1/admin/transporteurs',
            expect.objectContaining({ method: 'POST' }),
          ),
        ATTENTE_UI,
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

      await waitFor(() => expect(onSaved).toHaveBeenCalled(), ATTENTE_UI);
      expect(onClose).toHaveBeenCalled();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'édition → PATCH /transporteurs/{id} avec les champs modifiés',
    async () => {
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

      await waitFor(
        () =>
          expect(fetchMock).toHaveBeenCalledWith(
            `/api/v1/admin/transporteurs/${EDIT_FIXTURE.id}`,
            expect.objectContaining({ method: 'PATCH' }),
          ),
        ATTENTE_UI,
      );
      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string) as { nom: string };
      expect(body.nom).toBe('Strike Logistique 2');
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
        <TransporteurModal
          open
          transporteur={EDIT_FIXTURE}
          onClose={onClose}
          onSaved={onSaved}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: /Désactiver/ }));

      await waitFor(
        () =>
          expect(fetchMock).toHaveBeenCalledWith(
            `/api/v1/admin/transporteurs/${EDIT_FIXTURE.id}`,
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

  // ── Lien prestataire logistique ─────────────────────────────────────────────
  // Sans ce lien, un transporteur routé vers un adapter écarte toutes ses
  // tournées : 100 % de ses événements finissent en file d'erreur.

  it(
    'bloque la soumission si type_tms=a_toutes sans prestataire logistique',
    async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      render(
        <TransporteurModal
          open
          transporteur={null}
          onClose={vi.fn()}
          onSaved={vi.fn()}
          prestataires={PRESTATAIRES}
        />,
      );

      fillCommonFields();
      fireEvent.change(screen.getByLabelText(/Type de TMS/), {
        target: { value: 'a_toutes' },
      });
      fireEvent.click(
        screen.getByRole('button', { name: /Créer le transporteur/ }),
      );

      expect(
        await screen.findByText(
          /Prestataire logistique obligatoire/,
          undefined,
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'création a_toutes → POST porte le prestataire logistique choisi',
    async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'transp-1' }),
      });
      vi.stubGlobal('fetch', fetchMock);
      render(
        <TransporteurModal
          open
          transporteur={null}
          onClose={vi.fn()}
          onSaved={vi.fn()}
          prestataires={PRESTATAIRES}
        />,
      );

      fillCommonFields();
      fireEvent.change(screen.getByLabelText(/Type de TMS/), {
        target: { value: 'a_toutes' },
      });
      fireEvent.change(screen.getByLabelText(/Prestataire logistique/), {
        target: { value: PRESTATAIRES[0]!.id },
      });
      fireEvent.click(
        screen.getByRole('button', { name: /Créer le transporteur/ }),
      );

      await waitFor(() => expect(fetchMock).toHaveBeenCalled(), ATTENTE_UI);
      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string) as {
        prestataire_logistique_id: string | null;
      };
      expect(body.prestataire_logistique_id).toBe(PRESTATAIRES[0]!.id);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'type manuel sans prestataire → POST avec prestataire_logistique_id null (jamais chaîne vide)',
    async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'transp-1' }),
      });
      vi.stubGlobal('fetch', fetchMock);
      render(
        <TransporteurModal
          open
          transporteur={null}
          onClose={vi.fn()}
          onSaved={vi.fn()}
          prestataires={PRESTATAIRES}
        />,
      );

      fillCommonFields();
      fireEvent.change(screen.getByLabelText(/Type de TMS/), {
        target: { value: 'par_mail' },
      });
      fireEvent.click(
        screen.getByRole('button', { name: /Créer le transporteur/ }),
      );

      await waitFor(() => expect(fetchMock).toHaveBeenCalled(), ATTENTE_UI);
      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string) as {
        prestataire_logistique_id: string | null;
      };
      // '' serait refusé par la route (UUID invalide) : l'écran doit envoyer null.
      expect(body.prestataire_logistique_id).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it('création : grise les prestataires déjà rattachés à un transporteur', () => {
    render(
      <TransporteurModal
        open
        transporteur={null}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        prestataires={PRESTATAIRES}
      />,
    );

    expect(
      screen.getByRole('option', { name: 'A Toutes!' }),
    ).not.toBeDisabled();
    expect(
      screen.getByRole('option', {
        name: /Strike — déjà rattaché à Strike Paris/,
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole('option', {
        name: /Marathon — déjà rattaché à Strike Logistique/,
      }),
    ).toBeDisabled();
  });

  // ── Immuabilité (arbitrage Val 2026-09-16) ─────────────────────────────────
  // type_tms et prestataire_logistique_id sont posés à la création et jamais
  // modifiables : verrouillés à l'écran, jamais envoyés au PATCH (qui les refuse).

  it('édition : Type de TMS et Prestataire logistique verrouillés, affichant la valeur posée', () => {
    render(
      <TransporteurModal
        open
        transporteur={{
          ...EDIT_FIXTURE,
          type_tms: 'a_toutes',
          prestataire_logistique_id: PRESTATAIRES[2]!.id,
        }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        prestataires={PRESTATAIRES}
      />,
    );

    const typeTms = screen.getByLabelText(/Type de TMS/) as HTMLSelectElement;
    const presta = screen.getByLabelText(
      /Prestataire logistique/,
    ) as HTMLSelectElement;
    expect(typeTms).toBeDisabled();
    expect(typeTms.value).toBe('a_toutes');
    expect(presta).toBeDisabled();
    expect(presta.value).toBe(PRESTATAIRES[2]!.id);
    expect(
      screen.getAllByText(/créez un nouveau transporteur/).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it(
    "édition : le PATCH n'envoie ni type_tms ni prestataire_logistique_id, même sans lien posé",
    async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: EDIT_FIXTURE.id }),
      });
      vi.stubGlobal('fetch', fetchMock);
      render(
        <TransporteurModal
          open
          // a_toutes SANS lien : un transporteur antérieur au contrôle doit rester
          // éditable (l'obligation ne vaut qu'à la création).
          transporteur={{ ...EDIT_FIXTURE, type_tms: 'a_toutes' }}
          onClose={vi.fn()}
          onSaved={vi.fn()}
          prestataires={PRESTATAIRES}
        />,
      );

      fireEvent.change(screen.getByLabelText(/Nom du transporteur/), {
        target: { value: 'Renommé' },
      });
      fireEvent.click(screen.getByRole('button', { name: /Enregistrer/ }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalled(), ATTENTE_UI);
      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string) as Record<
        string,
        unknown
      >;
      expect(options.method).toBe('PATCH');
      expect(body.nom).toBe('Renommé');
      expect(body).not.toHaveProperty('type_tms');
      expect(body).not.toHaveProperty('prestataire_logistique_id');
    },
    ATTENTE_CAS_MS,
  );

  it("liste des prestataires non chargée : l'édition affiche quand même le lien posé, jamais « Aucun »", () => {
    render(
      <TransporteurModal
        open
        transporteur={{
          ...EDIT_FIXTURE,
          type_tms: 'a_toutes',
          prestataire_logistique_id: PRESTATAIRES[0]!.id,
        }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        prestataires={null}
      />,
    );

    const presta = screen.getByLabelText(
      /Prestataire logistique/,
    ) as HTMLSelectElement;
    expect(presta.value).toBe(PRESTATAIRES[0]!.id);
    expect(presta.selectedOptions[0]!.textContent).toMatch(
      /Prestataire rattaché/,
    );
  });

  it('liste des prestataires en échec : la création le dit, sans prétendre le référentiel vide', () => {
    render(
      <TransporteurModal
        open
        transporteur={null}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        prestataires={null}
      />,
    );

    expect(
      screen.getByText(/Liste des prestataires indisponible/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Aucun prestataire logistique enregistré/),
    ).not.toBeInTheDocument();
  });
});
