/**
 * M1.1 — Fiche association Admin (revue E2E 2026-07-15) : refonte Design System
 * (PageHero + StatCardGrid + BlocHeader) + bandeau KPI. Encode la correction du
 * bug signalé par Val : la capacité max (bénéficiaires) doit rester VISIBLE même
 * quand elle est nulle (« — »), et le KPI « collectes réalisées (30 j) » est
 * affiché à partir de la valeur dérivée renvoyée par l'API.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'a1' }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));

import AssociationDetailPage from './page';

const baseAsso = {
  id: 'a1',
  nom: 'Association Alpha (fictif)',
  adresse: '12 Rue Alpha',
  ville: 'Paris',
  region: 'idf',
  contact_nom: 'Alice Alpha',
  contact_email: 'contact.alpha@savr-test.local',
  contact_telephone: '+33 6 99 99 00 21',
  habilitee_attestation_fiscale: true,
  date_expiration_habilitation: null,
  description_rapport_impact:
    'Association Alpha — redistribution alimentaire solidaire (seed).',
  capacite_max_beneficiaires: 150,
  types_aliments_acceptes: ['sec', 'frais'],
  horaires_ouverture: null,
  logo_url: null,
  instructions_acces: null,
  siren: null,
  commentaires_internes: null,
  id_point_collecte_mts1: null,
  actif: true,
  derniere_verification: null,
  collectes_realisees_30j: 4,
};

function mockFetch(asso: Record<string, unknown>) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => asso,
  }) as unknown as typeof fetch;
}

/**
 * Retrouve la tuile KPI (StatCard) portant un libellé donné. Le libellé peut
 * aussi exister ailleurs (ex. « Habilitation 2041-GE » dans le bloc Admin/Ops) :
 * on ne garde que l'occurrence à l'intérieur d'une StatCard (flex flex-col).
 */
function kpiTile(label: string): HTMLElement {
  for (const match of screen.getAllByText(label)) {
    const tile = match.closest('div.flex.flex-col');
    if (tile) return tile as HTMLElement;
  }
  throw new Error(`Tuile KPI introuvable : ${label}`);
}

describe('M1.1 — Fiche association Admin (Design System + KPIs)', () => {
  beforeEach(() => {
    mockFetch(baseAsso);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('affiche le bandeau KPI : capacité, collectes réalisées 30 j, habilitation', async () => {
    render(<AssociationDetailPage />);
    await waitFor(() =>
      expect(
        screen.getByText('Association Alpha (fictif)'),
      ).toBeInTheDocument(),
    );

    expect(
      within(kpiTile('Capacité max (bénéficiaires)')).getByText('150'),
    ).toBeInTheDocument();
    expect(
      within(kpiTile('Collectes réalisées (30 j)')).getByText('4'),
    ).toBeInTheDocument();
    expect(
      within(kpiTile('Habilitation 2041-GE')).getByText('Oui'),
    ).toBeInTheDocument();
  });

  it('garde la capacité max VISIBLE même nulle (« — ») — bug E2E corrigé', async () => {
    mockFetch({ ...baseAsso, capacite_max_beneficiaires: null });
    render(<AssociationDetailPage />);
    await waitFor(() =>
      expect(
        screen.getByText('Association Alpha (fictif)'),
      ).toBeInTheDocument(),
    );

    const tile = kpiTile('Capacité max (bénéficiaires)');
    expect(within(tile).getByText('—')).toBeInTheDocument();
  });

  it('rend les blocs au gabarit Design System (BlocHeader)', async () => {
    render(<AssociationDetailPage />);
    await waitFor(() =>
      expect(screen.getByText('Coordonnées')).toBeInTheDocument(),
    );
    expect(screen.getByText("Rapport d'impact")).toBeInTheDocument();
    expect(screen.getByText('Admin / Ops')).toBeInTheDocument();
    // Le bouton Modifier vit dans le bandeau (PageHero), plus en flottant bas-droite.
    expect(screen.getByText('Modifier')).toBeInTheDocument();
  });
});
