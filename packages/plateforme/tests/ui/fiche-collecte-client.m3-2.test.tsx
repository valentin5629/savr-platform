/**
 * M3.2 — Pop-up fiche collecte client, espace gestionnaire de lieux (§06.05 :
 * « la fiche collecte reprend le pop-up client §06.04 », refonte Val
 * 2026-09-29). Écarts propres au rôle : jamais d'annulation (§05), pas de bloc
 * Association bénéficiaire (Q7), radar masqué pour une collecte de traiteur
 * tiers (garde SQL non élargie).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/gestionnaire/collectes',
}));

import { FicheCollecteClientModal } from '@/components/collecte/fiche-collecte-client-modal.js';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';
import {
  ficheClient,
  stubFetchFiche,
  urlsAppelees,
} from '@/test-utils/fiche-collecte-client';

const fiche = () => (
  <FicheCollecteClientModal
    espace="gestionnaire"
    collecteId="c1"
    onClose={() => {}}
  />
);

async function ouvrirOnglet(nom: string): Promise<void> {
  fireEvent.mouseDown(
    await screen.findByRole('tab', { name: nom }, ATTENTE_UI),
  );
}

// Réponse gestionnaire : la clé `association` n'existe pas (Q7).
function ficheGestionnaire(over: Parameters<typeof ficheClient>[0] = {}) {
  const f = ficheClient({
    actions: { modifier: 'grise', annuler: 'absent', annulation: null },
    ...over,
  });
  delete f.association;
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('M3.2 / pop-up fiche collecte — espace gestionnaire', () => {
  it(
    'M3.2/fiche_popup_gestionnaire_sans_annulation — pas de bouton d’annulation, « Modifier » grisé hors de ses programmations',
    async () => {
      stubFetchFiche(ficheGestionnaire());
      render(fiche());

      const modifier = await screen.findByTestId(
        'action-modifier',
        {},
        ATTENTE_UI,
      );
      expect(modifier).toHaveProperty('disabled', true);
      expect(modifier.getAttribute('title')).toContain(
        'organisation qui a programmé',
      );
      expect(screen.queryByTestId('action-annuler')).toBeNull();
      expect(urlsAppelees()[0]?.url).toBe('/api/v1/gestionnaire/collectes/c1');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/fiche_popup_gestionnaire_sans_association — AG : aucun bloc Association bénéficiaire',
    async () => {
      stubFetchFiche(
        ficheGestionnaire({
          type: 'anti_gaspi',
          statut: 'cloturee',
          repas_donnes: 840,
          rapport_rse_disponible: true,
          actions: { modifier: 'absent', annuler: 'absent', annulation: null },
        }),
      );
      render(fiche());

      await ouvrirOnglet('Logistique');
      await screen.findByTestId('bloc-logistique', {}, ATTENTE_UI);
      expect(screen.queryByTestId('bloc-association')).toBeNull();
      await ouvrirOnglet('Bilan & documents');
      await screen.findByTestId('kpi-ag', {}, ATTENTE_UI);
      expect(screen.queryByTestId('bloc-association')).toBeNull();
      expect(screen.getByTestId('bloc-documents').textContent).toContain(
        'Rapport de don',
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/fiche_popup_gestionnaire_repas_non_communiques — AG d’un traiteur tiers : « Non communiqué » au lieu de « — »',
    async () => {
      stubFetchFiche(
        ficheGestionnaire({
          type: 'anti_gaspi',
          statut: 'cloturee',
          repas_donnes: null,
          repas_non_communiques: true,
          co2_evite_kg: 250,
          actions: { modifier: 'absent', annuler: 'absent', annulation: null },
        }),
      );
      render(fiche());
      await ouvrirOnglet('Bilan & documents');

      const kpi = await screen.findByTestId('kpi-ag', {}, ATTENTE_UI);
      expect(within(kpi).getAllByText('Non communiqué')).toHaveLength(2);
      expect(kpi.textContent).not.toContain('— repas');
      // Le CO₂ évité (lu sur la collecte) reste affiché.
      expect(kpi.textContent).toContain('250');
      expect(
        within(kpi).getAllByLabelText(
          'Le nombre de repas est communiqué à l’organisation qui a programmé la collecte.',
        ),
      ).toHaveLength(2);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/fiche_popup_gestionnaire_radar_masque_tiers — radar indisponible (traiteur tiers) : bloc masqué, KPI conservés',
    async () => {
      stubFetchFiche(
        ficheGestionnaire({
          statut: 'cloturee',
          bilan_flux: { biodechet: 420 },
          taux_recyclage: 70,
          co2_net_kg: 100,
          actions: { modifier: 'absent', annuler: 'absent', annulation: null },
        }),
        { benchmark: 'indisponible' },
      );
      render(fiche());
      await ouvrirOnglet('Bilan & documents');

      await screen.findByTestId('kpi-zd', {}, ATTENTE_UI);
      // Non-vacuité : la route radar a bien été interrogée…
      await waitFor(() => {
        expect(
          urlsAppelees().some((c) =>
            c.url.startsWith('/api/v1/gestionnaire/collectes/c1/benchmark?'),
          ),
        ).toBe(true);
      }, ATTENTE_UI);
      // …et sa réponse « pas de radar » retire le bloc.
      await waitFor(() => {
        expect(screen.queryByTestId('bloc-3-zd-fiche')).toBeNull();
      }, ATTENTE_UI);
      expect(screen.getByText('Répartition des tonnages')).toBeTruthy();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/fiche_popup_gestionnaire_marque_blanche — aucun « transporteur » ni « prestataire »',
    async () => {
      stubFetchFiche(ficheGestionnaire());
      render(fiche());
      await screen.findByTestId('bloc-evenement', {}, ATTENTE_UI);
      for (const nom of ['Logistique', 'Bilan & documents']) {
        await ouvrirOnglet(nom);
        await screen.findByRole('tabpanel', {}, ATTENTE_UI);
        expect(document.body.textContent).not.toMatch(
          /transporteur|prestataire/i,
        );
      }
    },
    ATTENTE_CAS_MS,
  );
});
