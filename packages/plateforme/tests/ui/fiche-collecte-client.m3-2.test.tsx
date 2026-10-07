/**
 * M3.2 — Pop-up fiche collecte client, espace gestionnaire de lieux (§06.05 :
 * « la fiche collecte reprend le pop-up client §06.04 », refonte Val
 * 2026-09-29). Écarts propres au rôle : jamais d'annulation (§05), pas de bloc
 * Association bénéficiaire (Q7), radar masqué pour une collecte de traiteur
 * tiers (garde SQL non élargie).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

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

// Réponse gestionnaire : même fiche que le traiteur, actions du rôle en moins.
function ficheGestionnaire(over: Parameters<typeof ficheClient>[0] = {}) {
  return ficheClient({
    actions: { modifier: 'grise', annuler: 'absent', annulation: null },
    ...over,
  });
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

  // §06.05 l.85 : le masquage du bloc était une limite technique, levée par la
  // vue v_attributions_gestionnaire (§04).
  it(
    'M3.2/fiche_popup_gestionnaire_association_affichee — AG : bloc Association bénéficiaire sur Logistique et Bilan',
    async () => {
      stubFetchFiche(
        ficheGestionnaire({
          type: 'anti_gaspi',
          statut: 'cloturee',
          repas_donnes: 840,
          association: {
            nom: 'Les Restos du Cœur',
            ville: 'Paris',
            description: 'Aide alimentaire et accompagnement.',
          },
          rapport_rse_disponible: true,
          actions: { modifier: 'absent', annuler: 'absent', annulation: null },
        }),
      );
      render(fiche());

      await ouvrirOnglet('Logistique');
      const bloc = await screen.findByTestId(
        'bloc-association',
        {},
        ATTENTE_UI,
      );
      expect(bloc.textContent).toContain('Les Restos du Cœur');
      expect(bloc.textContent).toContain('Paris');
      expect(bloc.textContent).toContain('Aide alimentaire');
      await ouvrirOnglet('Bilan & documents');
      await screen.findByTestId('kpi-ag', {}, ATTENTE_UI);
      expect(screen.getByTestId('bloc-association').textContent).toContain(
        'Les Restos du Cœur',
      );
      expect(screen.getByTestId('bloc-documents').textContent).toContain(
        'Rapport de don',
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/fiche_popup_gestionnaire_sans_attribution — AG sans attribution rendue par la vue : aucun bloc Association',
    async () => {
      stubFetchFiche(
        ficheGestionnaire({
          type: 'anti_gaspi',
          statut: 'cloturee',
          repas_donnes: null,
          association: null,
          rapport_rse_disponible: true,
          actions: { modifier: 'absent', annuler: 'absent', annulation: null },
        }),
      );
      render(fiche());

      await ouvrirOnglet('Logistique');
      await screen.findByTestId('bloc-logistique', {}, ATTENTE_UI);
      expect(screen.queryByTestId('bloc-association')).toBeNull();
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
    'M3.2/fiche_popup_gestionnaire_contacts_tiers_masques — collecte d’un traiteur tiers : pas de bloc Contacts sur place',
    async () => {
      const base = ficheGestionnaire();
      stubFetchFiche({
        ...base,
        evenement: {
          ...base.evenement!,
          contacts_visibles: false,
          contact_principal_nom: null,
          contact_principal_telephone: null,
        },
      });
      render(fiche());

      // Non-vacuité : l'onglet Informations est rendu (le bloc Lieu est là)…
      await screen.findByTestId('bloc-lieu', {}, ATTENTE_UI);
      // …et le bloc Contacts n'existe pas (ni titre, ni ligne vide « — »).
      expect(screen.queryByTestId('bloc-contacts')).toBeNull();
      expect(document.body.textContent).not.toContain('Contacts sur place');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/fiche_popup_gestionnaire_contacts_propre_programmation — sa propre programmation : bloc Contacts sur place affiché',
    async () => {
      stubFetchFiche(
        ficheGestionnaire({
          actions: { modifier: 'actif', annuler: 'absent', annulation: null },
        }),
      );
      render(fiche());

      const contacts = await screen.findByTestId(
        'bloc-contacts',
        {},
        ATTENTE_UI,
      );
      expect(contacts.textContent).toContain('Paul Contact');
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
