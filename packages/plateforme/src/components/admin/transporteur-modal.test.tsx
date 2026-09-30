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

// Combobox (DS règle 3) : ouvrir le déclencheur puis choisir l'option (portail).
function choisirOption(libelle: RegExp, option: string) {
  fireEvent.click(screen.getByRole('combobox', { name: libelle }));
  fireEvent.click(screen.getByRole('option', { name: option }));
}

// Radix Tabs réagit au mousedown (pas au click) sous jsdom.
function ouvrirOnglet(nom: RegExp) {
  fireEvent.mouseDown(screen.getByRole('tab', { name: nom }));
}

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

// Onglet « Identité & contact » (ouvert par défaut).
function remplirIdentite() {
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
}

function fillCommonFields() {
  remplirIdentite();
  ouvrirOnglet(/Capacités/);
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
    ouvrirOnglet(/Connexion logistique/);
    expect(
      screen.queryByLabelText(/Code transporteur MTS-1/),
    ).not.toBeInTheDocument();

    choisirOption(/Type de TMS/, 'MTS-1 (Strike / Marathon)');
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
      ouvrirOnglet(/Connexion logistique/);
      choisirOption(/Type de TMS/, 'MTS-1 (Strike / Marathon)');
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
      ouvrirOnglet(/Connexion logistique/);
      choisirOption(/Type de TMS/, 'Autre (province — email/téléphone)');
      ouvrirOnglet(/Capacités/);
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
      // Désactiver n'écrit QUE actif (geste Ops libre, §6 immuabilité).
      expect(JSON.parse(options.body as string)).toEqual({ actif: false });
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
      ouvrirOnglet(/Connexion logistique/);
      choisirOption(/Type de TMS/, 'A Toutes! (vélo cargo)');
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
      ouvrirOnglet(/Connexion logistique/);
      choisirOption(/Type de TMS/, 'A Toutes! (vélo cargo)');
      choisirOption(/Prestataire logistique/, PRESTATAIRES[0]!.nom);
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
      ouvrirOnglet(/Connexion logistique/);
      choisirOption(/Type de TMS/, 'Par mail (validation Admin manuelle)');
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

    // Combobox : options portées dans le portail à l'ouverture ; une option
    // grisée porte aria-disabled (cmdk), pas l'attribut disabled natif.
    ouvrirOnglet(/Connexion logistique/);
    fireEvent.click(
      screen.getByRole('combobox', { name: /Prestataire logistique/ }),
    );
    expect(
      screen.getByRole('option', { name: 'A Toutes!' }),
    ).not.toHaveAttribute('aria-disabled', 'true');
    expect(
      screen.getByRole('option', {
        name: /Strike — déjà rattaché à Strike Paris/,
      }),
    ).toHaveAttribute('aria-disabled', 'true');
    expect(
      screen.getByRole('option', {
        name: /Marathon — déjà rattaché à Strike Logistique/,
      }),
    ).toHaveAttribute('aria-disabled', 'true');
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

    ouvrirOnglet(/Connexion logistique/);
    const typeTms = screen.getByRole('combobox', { name: /Type de TMS/ });
    const presta = screen.getByRole('combobox', {
      name: /Prestataire logistique/,
    });
    expect(typeTms).toBeDisabled();
    expect(typeTms).toHaveTextContent(/^A Toutes! \(vélo cargo\)$/);
    expect(presta).toBeDisabled();
    // PRESTATAIRES[2] = Marathon, rattaché à CE transporteur (donc non grisé).
    expect(presta).toHaveTextContent(/^Marathon$/);
    expect(screen.getByTestId('bandeau-immuabilite')).toHaveTextContent(
      /fixés à la création\. Pour en changer, créez un nouveau transporteur/,
    );
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

    ouvrirOnglet(/Connexion logistique/);
    const presta = screen.getByRole('combobox', {
      name: /Prestataire logistique/,
    });
    expect(presta).toHaveTextContent(/Prestataire rattaché/);
    expect(presta).not.toHaveTextContent(/^Aucun$/);
    // Le Combobox n'affiche ce libellé que si la valeur courante est l'id de
    // l'option « lien hors liste » (= prestataire_logistique_id posé).
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

    ouvrirOnglet(/Connexion logistique/);
    expect(
      screen.getByText(/Liste des prestataires indisponible/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Aucun prestataire logistique enregistré/),
    ).not.toBeInTheDocument();
  });

  // ── Fiche en onglets, format du pop-up collecte (décision Val 2026-09-30) ──

  it('3 onglets, « Identité & contact » ouvert par défaut, chaque champ dans son onglet', () => {
    render(
      <TransporteurModal
        open
        transporteur={null}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    expect(screen.getAllByRole('tab').map((o) => o.textContent)).toEqual([
      'Identité & contact',
      'Capacités',
      'Connexion logistique',
    ]);
    expect(
      screen.getByRole('tab', { name: 'Identité & contact' }),
    ).toHaveAttribute('aria-selected', 'true');
    for (const champ of [
      /Nom du transporteur/,
      /SIREN/,
      /Nom du contact/,
      /Téléphone/,
      /Mail de contact/,
      /^Adresse/,
      /Code postal/,
      /Ville/,
    ]) {
      expect(screen.getByLabelText(champ)).toBeInTheDocument();
    }
    expect(
      screen.queryByRole('group', { name: 'Type(s) de véhicule' }),
    ).not.toBeInTheDocument();

    ouvrirOnglet(/Capacités/);
    expect(
      screen.getByRole('group', { name: 'Type(s) de véhicule' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'Type(s) de collecte' }),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Description du process de collecte/),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText(/Nom du transporteur/),
    ).not.toBeInTheDocument();

    ouvrirOnglet(/Connexion logistique/);
    expect(
      screen.getByRole('combobox', { name: /Type de TMS/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('combobox', { name: /Prestataire logistique/ }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('bandeau-immuabilite')).toHaveTextContent(
      /ne pourront plus être modifiés après la création/,
    );
  });

  it(
    'erreur dans un onglet caché : la fiche y bascule et marque les onglets à corriger',
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

      // La modale prend le focus à l'ouverture (minuteur) : l'attendre, sinon
      // il écraserait le focus posé par l'échec de validation.
      await waitFor(
        () => expect(screen.getByRole('dialog')).toHaveFocus(),
        ATTENTE_UI,
      );
      // Identité complète, validation lancée depuis Connexion : manquent le
      // véhicule (Capacités) et le type de TMS (Connexion).
      remplirIdentite();
      ouvrirOnglet(/Connexion logistique/);
      fireEvent.click(
        screen.getByRole('button', { name: /Créer le transporteur/ }),
      );

      // Premier onglet en erreur dans l'ordre d'affichage.
      await waitFor(
        () =>
          expect(
            screen.getByRole('tab', { name: /^Capacités/ }),
          ).toHaveAttribute('aria-selected', 'true'),
        ATTENTE_UI,
      );
      expect(
        screen.getByText('Au moins un type de véhicule'),
      ).toBeInTheDocument();
      // Focus sur l'onglet fautif (même comportement que lieu et association).
      expect(
        screen.getByRole('tab', { name: 'Capacités (1 champ à corriger)' }),
      ).toHaveFocus();
      expect(
        screen.getByRole('tab', {
          name: 'Connexion logistique (1 champ à corriger)',
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('tab', { name: 'Identité & contact' }),
      ).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    },
    ATTENTE_CAS_MS,
  );

  it('en-tête : type de TMS, SIREN, ville, véhicules, téléphone et statut du transporteur enregistré', () => {
    render(
      <TransporteurModal
        open
        transporteur={{
          ...EDIT_FIXTURE,
          types_vehicules: ['velo_cargo', 'camionnette'],
        }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    expect(screen.getByTestId('badge-type-tms')).toHaveTextContent(/^Autre$/);
    expect(screen.getByText('SIREN 123 456 789')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Strike Logistique' }),
    ).toBeInTheDocument();
    const sousLigne = screen.getByTestId('fiche-transporteur-sous-ligne');
    expect(sousLigne).toHaveTextContent('Paris 75012');
    expect(sousLigne).toHaveTextContent('Vélo cargo, Camionnette');
    expect(sousLigne).toHaveTextContent('0102030405');
    expect(screen.getByText('Actif')).toBeInTheDocument();

    // L'en-tête décrit la fiche enregistrée : il ne suit pas la saisie.
    fireEvent.change(screen.getByLabelText(/Nom du transporteur/), {
      target: { value: 'Renommé' },
    });
    expect(
      screen.getByRole('heading', { name: 'Strike Logistique' }),
    ).toBeInTheDocument();
  });

  it(
    'Réactiver → PATCH { actif:true } seul + onSaved/onClose',
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
          transporteur={{ ...EDIT_FIXTURE, actif: false }}
          onClose={onClose}
          onSaved={onSaved}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Réactiver' }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalled(), ATTENTE_UI);
      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`/api/v1/admin/transporteurs/${EDIT_FIXTURE.id}`);
      expect(options.method).toBe('PATCH');
      expect(JSON.parse(options.body as string)).toEqual({ actif: true });
      await waitFor(() => expect(onSaved).toHaveBeenCalled(), ATTENTE_UI);
      expect(onClose).toHaveBeenCalled();
    },
    ATTENTE_CAS_MS,
  );

  it.each(['12345678', '1234567890', '12345678A'])(
    'SIREN « %s » refusé (9 chiffres exactement), rien n’est envoyé',
    async (siren) => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      render(
        <TransporteurModal
          open
          transporteur={EDIT_FIXTURE}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />,
      );

      fireEvent.change(screen.getByLabelText(/SIREN/), {
        target: { value: siren },
      });
      fireEvent.click(screen.getByRole('button', { name: /Enregistrer/ }));

      expect(
        await screen.findByText('SIREN : 9 chiffres', undefined, ATTENTE_UI),
      ).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    },
    ATTENTE_CAS_MS,
  );

  it('transporteur inactif : badge « Inactif » et bouton « Réactiver »', () => {
    render(
      <TransporteurModal
        open
        transporteur={{ ...EDIT_FIXTURE, actif: false }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    expect(screen.getByText('Inactif')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Réactiver' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Désactiver' }),
    ).not.toBeInTheDocument();
  });

  it(
    "erreur serveur affichée dans le pied, visible quel que soit l'onglet",
    async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          json: async () => ({ error: 'SIREN déjà utilisé' }),
        }),
      );
      render(
        <TransporteurModal
          open
          transporteur={EDIT_FIXTURE}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />,
      );

      ouvrirOnglet(/Connexion logistique/);
      fireEvent.click(screen.getByRole('button', { name: /Enregistrer/ }));
      expect(
        await screen.findByRole('alert', undefined, ATTENTE_UI),
      ).toHaveTextContent('SIREN déjà utilisé');

      ouvrirOnglet(/Capacités/);
      expect(screen.getByRole('alert')).toHaveTextContent('SIREN déjà utilisé');
    },
    ATTENTE_CAS_MS,
  );

  it('coordonnées du transporteur ignorées par les gestionnaires de mots de passe (Bitwarden)', () => {
    render(
      <TransporteurModal
        open
        transporteur={null}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    for (const champ of [
      /Nom du transporteur/,
      /Nom du contact/,
      /Téléphone/,
      /Mail de contact/,
      /^Adresse/,
      /Code postal/,
      /Ville/,
    ]) {
      const input = screen.getByLabelText(champ);
      expect(input).toHaveAttribute('data-bwignore', 'true');
      expect(input).toHaveAttribute('autocomplete', 'off');
    }
  });
});
