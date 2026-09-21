/**
 * M0.6 — Fiche organisation : onglets câblés (BL-P1-BOA-08, §06.06 §8).
 * Vérifie que les onglets rendent leurs données (collectes, factures, grille ZD,
 * tarif refacturé, coefficient perte labo) et que le gating read-only ops
 * (bandeau « Lecture seule » + actions désactivées) suit le droit `canEdit`
 * (dérivé du claim `user_role` côté page).
 *
 * NB : DataTable rend desktop (table) + mobile (cards) → libellés en double,
 * assertions en getAllBy*.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, back: vi.fn(), refresh: vi.fn() }),
}));

import {
  OngletCollectes,
  OngletFactures,
  OngletGrilleZd,
  OngletTarifRefacture,
  OngletCoefficients,
  OngletRemises,
  PackAjustementsHistorique,
} from './onglets';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

// ── Fixtures ────────────────────────────────────────────────────────────────

const collecte = {
  id: 'col-1',
  type: 'zero_dechet',
  statut: 'cloturee',
  date_collecte: '2026-05-02',
  evenements: {
    nom_evenement: 'Gala ZD',
    pax: 120,
    lieux: { nom: 'Salle Wagram', ville: 'Paris' },
  },
};

const facture = {
  id: 'fac-1',
  numero_facture: 'ZD-2026-0005',
  type: null,
  statut: 'payee',
  montant_ttc: 5760,
  date_emission: '2025-06-28',
};

const grille = {
  id: 'g1',
  nom: 'Grille standard V1',
  description: null,
  est_defaut: true,
  tarifs_zero_dechet: [
    {
      id: 't1',
      pax_min: 1,
      pax_max: 250,
      prix_base_ht: 450,
      prix_par_couvert_ht: 0,
    },
  ],
};

const coefficient = {
  id: 'c1',
  annee_reference: 2025,
  annee_application: 2026, // calculé serveur (CDC §9bis.1)
  coefficient_kg_couvert: 0.18,
  source_commentaire: 'Estimation labo',
  saisi_par: 'u-ops',
  saisi_le: '2026-06-19T16:33:22Z',
  saisi_par_user: { prenom: 'Ops', nom: 'Un' },
};

interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}
let calls: FetchCall[] = [];

function mockFetch(routes: Record<string, unknown>) {
  global.fetch = vi.fn(
    (url: string, init?: { method?: string; body?: string }) => {
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(init.body) : undefined,
      });
      const key = Object.keys(routes).find((k) => url.startsWith(k));
      const payload = key ? routes[key] : { data: [] };
      return Promise.resolve({
        ok: true,
        json: async () => payload,
      }) as unknown as Promise<Response>;
    },
  ) as unknown as typeof fetch;
}

beforeEach(() => {
  calls = [];
  mockPush.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ── Collectes ───────────────────────────────────────────────────────────────

describe('M0.6 — onglet Collectes', () => {
  it(
    'rend la liste des collectes de l’organisation',
    async () => {
      mockFetch({ '/api/v1/admin/collectes': { data: [collecte] } });
      render(<OngletCollectes organisationId="org-1" />);
      await waitFor(
        () => expect(screen.getAllByText('Gala ZD').length).toBeGreaterThan(0),
        ATTENTE_UI,
      );
      // Filtre serveur par organisation appliqué.
      expect(
        calls.some((c) =>
          c.url.includes('/api/v1/admin/collectes?organisation_id=org-1'),
        ),
      ).toBe(true);
      expect(screen.getAllByText(/Salle Wagram/).length).toBeGreaterThan(0);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'clic sur une ligne → navigue vers la fiche collecte',
    async () => {
      mockFetch({ '/api/v1/admin/collectes': { data: [collecte] } });
      render(<OngletCollectes organisationId="org-1" />);
      await waitFor(
        () => expect(screen.getAllByText('Gala ZD').length).toBeGreaterThan(0),
        ATTENTE_UI,
      );
      fireEvent.click(screen.getAllByText('Gala ZD')[0] as HTMLElement);
      expect(mockPush).toHaveBeenCalledWith('/admin/collectes/col-1');
    },
    ATTENTE_CAS_MS,
  );
});

// ── Factures ────────────────────────────────────────────────────────────────

describe('M0.6 — onglet Factures', () => {
  it(
    'rend la liste des factures de l’organisation',
    async () => {
      mockFetch({ '/api/v1/admin/factures': { data: [facture] } });
      render(<OngletFactures organisationId="org-1" />);
      await waitFor(
        () =>
          expect(screen.getAllByText('ZD-2026-0005').length).toBeGreaterThan(0),
        ATTENTE_UI,
      );
      expect(
        calls.some((c) =>
          c.url.includes('/api/v1/admin/factures?organisation_id=org-1'),
        ),
      ).toBe(true);
      expect(screen.getAllByText('Payée').length).toBeGreaterThan(0);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'clic sur une ligne → navigue vers la fiche facture',
    async () => {
      mockFetch({ '/api/v1/admin/factures': { data: [facture] } });
      render(<OngletFactures organisationId="org-1" />);
      await waitFor(
        () =>
          expect(screen.getAllByText('ZD-2026-0005').length).toBeGreaterThan(0),
        ATTENTE_UI,
      );
      fireEvent.click(screen.getAllByText('ZD-2026-0005')[0] as HTMLElement);
      expect(mockPush).toHaveBeenCalledWith('/admin/factures/fac-1');
    },
    ATTENTE_CAS_MS,
  );
});

// ── Grille ZD ───────────────────────────────────────────────────────────────

describe('M0.6 — onglet Grille tarifaire ZD', () => {
  it(
    'admin : sélecteur de grille + paliers, pas de bandeau read-only',
    async () => {
      mockFetch({ '/api/v1/admin/grilles-tarifaires-zd': { data: [grille] } });
      render(
        <OngletGrilleZd
          organisationId="org-1"
          grilleId={null}
          canEdit={true}
          onUpdated={() => {}}
        />,
      );
      await waitFor(
        () =>
          expect(
            screen.getByLabelText('Grille tarifaire ZD'),
          ).toBeInTheDocument(),
        ATTENTE_UI,
      );
      expect(screen.queryByText(/Lecture seule/)).not.toBeInTheDocument();
      expect(screen.getByText(/450/)).toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'ops : bandeau read-only + pas de sélecteur',
    async () => {
      mockFetch({ '/api/v1/admin/grilles-tarifaires-zd': { data: [grille] } });
      render(
        <OngletGrilleZd
          organisationId="org-1"
          grilleId={null}
          canEdit={false}
          onUpdated={() => {}}
        />,
      );
      await waitFor(
        () => expect(screen.getByText(/Lecture seule/)).toBeInTheDocument(),
        ATTENTE_UI,
      );
      expect(
        screen.queryByLabelText('Grille tarifaire ZD'),
      ).not.toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );
});

// ── Tarif refacturé ─────────────────────────────────────────────────────────

describe('M0.6 — onglet Tarif refacturé', () => {
  it(
    'admin : bouton Modifier → PATCH tarif_refacture_pax_zd',
    async () => {
      mockFetch({ '/api/v1/admin/organisations/org-1': { id: 'org-1' } });
      const onUpdated = vi.fn();
      render(
        <OngletTarifRefacture
          organisationId="org-1"
          value={1.5}
          canEdit={true}
          onUpdated={onUpdated}
        />,
      );
      expect(screen.queryByText(/Lecture seule/)).not.toBeInTheDocument();
      fireEvent.click(screen.getByText('Modifier'));
      const input = screen.getByLabelText('Tarif refacturé (€/pax)');
      fireEvent.change(input, { target: { value: '2.25' } });
      fireEvent.click(screen.getByText('Enregistrer'));
      await waitFor(() => expect(onUpdated).toHaveBeenCalled(), ATTENTE_UI);
      const patch = calls.find((c) => c.method === 'PATCH');
      expect(patch?.body).toMatchObject({ tarif_refacture_pax_zd: 2.25 });
    },
    ATTENTE_CAS_MS,
  );

  it('ops : bandeau read-only + pas de bouton Modifier', () => {
    mockFetch({});
    render(
      <OngletTarifRefacture
        organisationId="org-1"
        value={1.5}
        canEdit={false}
        onUpdated={() => {}}
      />,
    );
    expect(screen.getByText(/Lecture seule/)).toBeInTheDocument();
    expect(screen.queryByText('Modifier')).not.toBeInTheDocument();
  });
});

// ── Coefficient perte labo ──────────────────────────────────────────────────

describe('M0.6 — onglet Coefficient de perte labo', () => {
  it(
    'rend les coefficients + année d’application = année réf + 1',
    async () => {
      mockFetch({
        '/api/v1/admin/organisations/org-1/coefficients-perte-labo': {
          data: [coefficient],
        },
      });
      render(<OngletCoefficients organisationId="org-1" canEdit={true} />);
      await waitFor(
        () => expect(screen.getByText('2025')).toBeInTheDocument(),
        ATTENTE_UI,
      );
      // « Appliqué aux événements de » = 2026 (année réf + 1).
      expect(screen.getByText('2026')).toBeInTheDocument();
      expect(screen.getByText('Estimation labo')).toBeInTheDocument();
      // Colonne « Saisi par » = auteur résolu (§06.06 §8 tableau coefficients).
      expect(screen.getByText('Ops Un')).toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'admin : Ajouter → POST coefficient',
    async () => {
      mockFetch({
        '/api/v1/admin/organisations/org-1/coefficients-perte-labo': {
          data: [],
        },
      });
      render(<OngletCoefficients organisationId="org-1" canEdit={true} />);
      await waitFor(
        () =>
          expect(
            screen.getByText('Aucun coefficient communiqué'),
          ).toBeInTheDocument(),
        ATTENTE_UI,
      );
      fireEvent.click(screen.getByText('Ajouter un coefficient'));
      fireEvent.change(
        screen.getByLabelText('Coefficient (kg/couvert)', {
          selector: 'input',
        }),
        {
          target: { value: '0.17' },
        },
      );
      fireEvent.click(screen.getByText('Enregistrer'));
      await waitFor(() => {
        const post = calls.find(
          (c) =>
            c.method === 'POST' &&
            c.url ===
              '/api/v1/admin/organisations/org-1/coefficients-perte-labo',
        );
        // Organisation portée par le PATH, plus dans le body (BL-P2-32).
        expect(post?.body).toMatchObject({ coefficient_kg_couvert: 0.17 });
        expect(post?.body).not.toHaveProperty('organisation_id');
      }, ATTENTE_UI);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'ops : bandeau read-only + pas de bouton Ajouter',
    async () => {
      mockFetch({
        '/api/v1/admin/organisations/org-1/coefficients-perte-labo': {
          data: [coefficient],
        },
      });
      render(<OngletCoefficients organisationId="org-1" canEdit={false} />);
      await waitFor(
        () => expect(screen.getByText(/Lecture seule/)).toBeInTheDocument(),
        ATTENTE_UI,
      );
      expect(
        screen.queryByText('Ajouter un coefficient'),
      ).not.toBeInTheDocument();
      expect(screen.queryByText('Éditer')).not.toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );
});

// ── Remises négociées ────────────────────────────────────────────────────────

const remise = {
  id: 'rem-1',
  activite: 'zd',
  remise_pct: 0.15, // fraction → doit s'afficher « 15 % »
  valide_du: '2025-01-01',
  valide_jusqu_au: null,
  scope: 'organisation',
  commentaires: 'Geste commercial',
};

describe('M0.6 — onglet Remises négociées', () => {
  it('affiche la remise en pourcentage (fraction ×100)', () => {
    mockFetch({});
    render(
      <OngletRemises
        organisationType="traiteur"
        lieuxGestionnaire={[]}
        organisationId="org-1"
        remises={[remise]}
        canEdit={true}
        onUpdated={() => {}}
      />,
    );
    // 0.15 → « 15 % » (et pas « 0.15 % »).
    expect(screen.getByText(/^15\s*%$/)).toBeInTheDocument();
    expect(screen.getByText('Geste commercial')).toBeInTheDocument();
  });

  it(
    'admin : Créer une remise → POST avec remise_pct en fraction',
    async () => {
      mockFetch({ '/api/v1/admin/tarifs-negocie': { id: 'new' } });
      const onUpdated = vi.fn();
      render(
        <OngletRemises
          organisationType="traiteur"
          lieuxGestionnaire={[]}
          organisationId="org-1"
          remises={[]}
          canEdit={true}
          onUpdated={onUpdated}
        />,
      );
      fireEvent.click(screen.getByText('Créer une remise'));
      fireEvent.change(screen.getByLabelText('Remise (%)'), {
        target: { value: '10' },
      });
      fireEvent.change(screen.getByLabelText('Valide du'), {
        target: { value: '2026-01-01' },
      });
      fireEvent.click(screen.getByText('Créer'));
      await waitFor(() => expect(onUpdated).toHaveBeenCalled(), ATTENTE_UI);
      const post = calls.find(
        (c) => c.method === 'POST' && c.url === '/api/v1/admin/tarifs-negocie',
      );
      expect(post?.body).toMatchObject({
        scope: 'organisation',
        organisation_id: 'org-1',
        activite: 'zd',
        remise_pct: 0.1, // 10 % → 0.1
        valide_du: '2026-01-01',
      });
    },
    ATTENTE_CAS_MS,
  );

  it(
    'fiche gestionnaire de lieux : plusieurs lieux cochés → POST scope gestionnaire + lieu_ids',
    async () => {
      mockFetch({ '/api/v1/admin/tarifs-negocie': { id: 'new' } });
      const onUpdated = vi.fn();
      render(
        <OngletRemises
          organisationType="gestionnaire_lieux"
          lieuxGestionnaire={[
            { id: 'lieu-pv', nom: 'Paris Expo Porte de Versailles' },
            { id: 'lieu-pn', nom: 'Paris Nord Villepinte' },
            { id: 'lieu-lb', nom: 'Paris Le Bourget' },
          ]}
          organisationId="org-viparis"
          remises={[]}
          canEdit={true}
          onUpdated={onUpdated}
        />,
      );
      fireEvent.click(screen.getByText('Créer une remise'));
      const tous = screen.getByRole('checkbox', {
        name: 'Tous les lieux du gestionnaire',
      });
      expect(tous).toBeChecked();
      fireEvent.click(
        screen.getByRole('checkbox', { name: 'Paris Nord Villepinte' }),
      );
      fireEvent.click(
        screen.getByRole('checkbox', { name: 'Paris Le Bourget' }),
      );
      expect(tous).not.toBeChecked();
      expect(
        screen.getByText(/Une remise sera enregistrée par lieu \(2\)/),
      ).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('Remise (%)'), {
        target: { value: '10' },
      });
      fireEvent.change(screen.getByLabelText('Valide du'), {
        target: { value: '2026-09-17' },
      });
      fireEvent.click(screen.getByText('Créer'));
      await waitFor(() => expect(onUpdated).toHaveBeenCalled(), ATTENTE_UI);
      const post = calls.find(
        (c) => c.method === 'POST' && c.url === '/api/v1/admin/tarifs-negocie',
      );
      expect(post?.body).toMatchObject({
        scope: 'gestionnaire',
        gestionnaire_organisation_id: 'org-viparis',
        lieu_ids: ['lieu-pn', 'lieu-lb'],
        activite: 'zd',
        remise_pct: 0.1,
        valide_du: '2026-09-17',
      });
      expect(post?.body).not.toHaveProperty('organisation_id');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'fiche gestionnaire de lieux : « Tous les lieux » par défaut → lieu_ids vide ; portée affichée par ligne',
    async () => {
      mockFetch({ '/api/v1/admin/tarifs-negocie': { id: 'new' } });
      const onUpdated = vi.fn();
      render(
        <OngletRemises
          organisationType="gestionnaire_lieux"
          lieuxGestionnaire={[{ id: 'lieu-pv', nom: 'Paris Expo' }]}
          organisationId="org-viparis"
          remises={[
            {
              ...remise,
              id: 'g-1',
              scope: 'gestionnaire',
              lieu_id: null,
              lieux: null,
            },
            {
              ...remise,
              id: 'g-2',
              scope: 'gestionnaire',
              lieu_id: 'lieu-pv',
              lieux: { nom: 'Paris Expo' },
            },
            { ...remise, id: 'o-1' },
          ]}
          canEdit={true}
          onUpdated={onUpdated}
        />,
      );
      expect(screen.getByText('Tous ses lieux')).toBeInTheDocument();
      expect(screen.getByText('Paris Expo')).toBeInTheDocument();
      expect(screen.getByText('Organisation (en direct)')).toBeInTheDocument();

      fireEvent.click(screen.getByText('Créer une remise'));
      fireEvent.change(screen.getByLabelText('Remise (%)'), {
        target: { value: '10' },
      });
      fireEvent.change(screen.getByLabelText('Valide du'), {
        target: { value: '2026-09-17' },
      });
      fireEvent.click(screen.getByText('Créer'));
      await waitFor(() => expect(onUpdated).toHaveBeenCalled(), ATTENTE_UI);
      const post = calls.find(
        (c) => c.method === 'POST' && c.url === '/api/v1/admin/tarifs-negocie',
      );
      expect(post?.body).toMatchObject({
        scope: 'gestionnaire',
        gestionnaire_organisation_id: 'org-viparis',
        lieu_ids: [],
      });
    },
    ATTENTE_CAS_MS,
  );

  it(
    'admin : clic sur une remise active → modale pré-remplie → POST modifier (fermeture + nouvelle ligne côté serveur)',
    async () => {
      mockFetch({ '/api/v1/admin/tarifs-negocie/g-1/modifier': { id: 'g-2' } });
      const onUpdated = vi.fn();
      render(
        <OngletRemises
          organisationType="gestionnaire_lieux"
          lieuxGestionnaire={[{ id: 'lieu-pv', nom: 'Paris Expo' }]}
          organisationId="org-viparis"
          remises={[
            {
              ...remise,
              id: 'g-1',
              scope: 'gestionnaire',
              remise_pct: 0.05,
              lieu_id: null,
              lieux: null,
              commentaires: 'Accord 2025',
            },
          ]}
          canEdit={true}
          onUpdated={onUpdated}
        />,
      );
      fireEvent.click(screen.getByText('Tous ses lieux'));
      expect(screen.getByText('Modifier la remise')).toBeInTheDocument();
      // Pré-remplissage : 0.05 → « 5 », commentaire repris, activité figée.
      expect(screen.getByLabelText('Remise (%)')).toHaveValue(5);
      expect(screen.getByLabelText('Activité')).toBeDisabled();
      expect(screen.getByDisplayValue('Accord 2025')).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText('Remise (%)'), {
        target: { value: '10' },
      });
      fireEvent.click(screen.getByRole('checkbox', { name: 'Paris Expo' }));
      fireEvent.change(screen.getByLabelText('À partir du'), {
        target: { value: '2099-01-01' },
      });
      fireEvent.click(screen.getByText('Enregistrer'));
      await waitFor(() => expect(onUpdated).toHaveBeenCalled(), ATTENTE_UI);
      const post = calls.find(
        (c) =>
          c.method === 'POST' &&
          c.url === '/api/v1/admin/tarifs-negocie/g-1/modifier',
      );
      expect(post?.body).toEqual({
        lieu_ids: ['lieu-pv'],
        remise_pct: 0.1,
        valide_du: '2099-01-01',
        commentaires: 'Accord 2025',
      });
      // Pas de création parallèle d'une remise supplémentaire.
      expect(
        calls.some(
          (c) =>
            c.method === 'POST' && c.url === '/api/v1/admin/tarifs-negocie',
        ),
      ).toBe(false);
    },
    ATTENTE_CAS_MS,
  );

  it('remise fermée ou ops : ligne non cliquable (pas de modale)', () => {
    mockFetch({});
    const { rerender } = render(
      <OngletRemises
        organisationType="traiteur"
        lieuxGestionnaire={[]}
        organisationId="org-1"
        remises={[{ ...remise, valide_jusqu_au: '2026-01-01' }]}
        canEdit={true}
        onUpdated={() => {}}
      />,
    );
    fireEvent.click(screen.getByText('Geste commercial'));
    expect(screen.queryByText('Modifier la remise')).not.toBeInTheDocument();
    rerender(
      <OngletRemises
        organisationType="traiteur"
        lieuxGestionnaire={[]}
        organisationId="org-1"
        remises={[remise]}
        canEdit={false}
        onUpdated={() => {}}
      />,
    );
    fireEvent.click(screen.getByText('Geste commercial'));
    expect(screen.queryByText('Modifier la remise')).not.toBeInTheDocument();
  });

  it(
    'admin : Fermer → POST fermer',
    async () => {
      mockFetch({
        '/api/v1/admin/tarifs-negocie/rem-1/fermer': { id: 'rem-1' },
      });
      const onUpdated = vi.fn();
      render(
        <OngletRemises
          organisationType="traiteur"
          lieuxGestionnaire={[]}
          organisationId="org-1"
          remises={[remise]}
          canEdit={true}
          onUpdated={onUpdated}
        />,
      );
      fireEvent.click(screen.getByText('Fermer'));
      await waitFor(() => expect(onUpdated).toHaveBeenCalled(), ATTENTE_UI);
      expect(screen.queryByText('Modifier la remise')).not.toBeInTheDocument();
      expect(
        calls.some(
          (c) =>
            c.method === 'POST' &&
            c.url === '/api/v1/admin/tarifs-negocie/rem-1/fermer',
        ),
      ).toBe(true);
    },
    ATTENTE_CAS_MS,
  );

  it('ops : bandeau read-only + pas de Créer/Fermer', () => {
    mockFetch({});
    render(
      <OngletRemises
        organisationType="traiteur"
        lieuxGestionnaire={[]}
        organisationId="org-1"
        remises={[remise]}
        canEdit={false}
        onUpdated={() => {}}
      />,
    );
    expect(screen.getByText(/Lecture seule/)).toBeInTheDocument();
    expect(screen.queryByText('Créer une remise')).not.toBeInTheDocument();
    expect(screen.queryByText('Fermer')).not.toBeInTheDocument();
  });

  it('filtre « Actives uniquement » masque les remises fermées', () => {
    mockFetch({});
    const fermee = {
      ...remise,
      id: 'rem-2',
      activite: 'ag',
      valide_jusqu_au: '2026-06-30',
      commentaires: 'Ancienne remise',
    };
    render(
      <OngletRemises
        organisationType="traiteur"
        lieuxGestionnaire={[]}
        organisationId="org-1"
        remises={[remise, fermee]}
        canEdit={true}
        onUpdated={() => {}}
      />,
    );
    // Les deux visibles au départ.
    expect(screen.getByText('Ancienne remise')).toBeInTheDocument();
    expect(screen.getByText('Geste commercial')).toBeInTheDocument();
    // Activer le filtre → la remise fermée disparaît.
    fireEvent.click(screen.getByLabelText('Actives uniquement'));
    expect(screen.queryByText('Ancienne remise')).not.toBeInTheDocument();
    expect(screen.getByText('Geste commercial')).toBeInTheDocument();
  });
});

// ── Historique ajustements pack ──────────────────────────────────────────────

const packAudit = {
  id: 'aud-1',
  action: 'pack_ajuste_manuel',
  old_values: { credits_initiaux: 20 },
  new_values: { credits_initiaux: 15 },
  motif: 'Correction erreur de saisie',
  created_at: '2026-07-03T12:00:00Z',
  auteur: { prenom: 'Admin', nom: 'Savr' },
};

describe('M0.6 — historique ajustements pack', () => {
  it(
    'affiche les ajustements (ancien → nouveau, motif, auteur)',
    async () => {
      mockFetch({
        '/api/v1/admin/packs-antgaspi/historique': { data: [packAudit] },
      });
      render(<PackAjustementsHistorique organisationId="org-1" />);
      await waitFor(
        () =>
          expect(
            screen.getByText('Historique des ajustements de crédits'),
          ).toBeInTheDocument(),
        ATTENTE_UI,
      );
      expect(screen.getByText('20 → 15')).toBeInTheDocument();
      expect(
        screen.getByText('Correction erreur de saisie'),
      ).toBeInTheDocument();
      expect(screen.getByText('Admin Savr')).toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'rend l’action « Annulation du pack » (crédits —)',
    async () => {
      // Réaliste : la route PATCH `annuler` range le motif dans new_values.motif
      // (pas la colonne motif). Le composant doit le retrouver via fallback.
      const annulation = {
        id: 'aud-2',
        action: 'annulation_pack',
        old_values: { statut: 'actif' },
        new_values: { statut: 'annule', motif: 'Doublon de pack' },
        motif: null,
        created_at: '2026-07-02T09:00:00Z',
        auteur: { prenom: 'Ops', nom: 'Un' },
      };
      mockFetch({
        '/api/v1/admin/packs-antgaspi/historique': { data: [annulation] },
      });
      render(<PackAjustementsHistorique organisationId="org-1" />);
      await waitFor(
        () =>
          expect(screen.getByText('Annulation du pack')).toBeInTheDocument(),
        ATTENTE_UI,
      );
      expect(screen.getByText('Doublon de pack')).toBeInTheDocument();
      expect(screen.getByText('Ops Un')).toBeInTheDocument();
      // Pas de crédits avant/après sur une annulation → « — ».
      expect(screen.queryByText(/→/)).not.toBeInTheDocument();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'ne rend rien si aucun ajustement',
    async () => {
      mockFetch({ '/api/v1/admin/packs-antgaspi/historique': { data: [] } });
      const { container } = render(
        <PackAjustementsHistorique organisationId="org-1" />,
      );
      await waitFor(
        () =>
          expect(
            calls.some((c) => c.url.includes('packs-antgaspi/historique')),
          ).toBe(true),
        ATTENTE_UI,
      );
      expect(
        screen.queryByText('Historique des ajustements de crédits'),
      ).not.toBeInTheDocument();
      expect(container).toBeEmptyDOMElement();
    },
    ATTENTE_CAS_MS,
  );
});
