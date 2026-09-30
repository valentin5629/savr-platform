/**
 * M3.3 — Pop-up fiche collecte client, espace agence (§06.11 : « la fiche
 * collecte reprend le pop-up client §06.04 », refonte Val 2026-09-29). Seul
 * ajout propre à l'agence : le traiteur opérationnel (badge « Hors référentiel »
 * → complétion du SIRET, §06.11 F2).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/agence/collectes',
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
    espace="agence"
    collecteId="c1"
    onClose={() => {}}
  />
);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('M3.3 / pop-up fiche collecte — espace agence', () => {
  it(
    'M3.3/fiche_popup_agence_endpoints — la fiche lit et agit sur les routes agence',
    async () => {
      stubFetchFiche(ficheClient({ traiteur_operationnel: null }));
      render(fiche());

      await screen.findByTestId('badge-type-collecte', {}, ATTENTE_UI);
      expect(urlsAppelees()[0]?.url).toBe('/api/v1/agence/collectes/c1');
      // Même en-tête / onglets / pied que le traiteur.
      expect(screen.getByTestId('frise-statut-client')).toBeTruthy();
      expect(screen.getAllByRole('tab')).toHaveLength(3);
      expect(screen.getByTestId('action-annuler').textContent).toContain(
        'Demander l’annulation',
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.3/fiche_popup_agence_traiteur_operationnel_siret — badge « Hors référentiel » → SIRET enregistré',
    async () => {
      stubFetchFiche(
        ficheClient({
          traiteur_operationnel: {
            id: 'org-shadow',
            nom: 'Maison Bertrand',
            est_shadow: true,
            siret: null,
          },
        }),
      );
      render(fiche());

      const ligne = await screen.findByTestId(
        'traiteur-operationnel',
        {},
        ATTENTE_UI,
      );
      expect(ligne.textContent).toContain('Maison Bertrand');
      fireEvent.click(screen.getByTestId('badge-hors-referentiel'));
      const champ = await screen.findByRole(
        'textbox',
        { name: /^SIRET/ },
        ATTENTE_UI,
      );
      fireEvent.change(champ, { target: { value: '123 456 789 00012' } });
      fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

      await waitFor(() => {
        const patch = urlsAppelees().find((c) => c.method === 'PATCH');
        expect(patch?.url).toBe('/api/v1/agence/shadow/org-shadow/siret');
      }, ATTENTE_UI);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.3/fiche_popup_agence_marque_blanche — aucun « transporteur » ni « prestataire »',
    async () => {
      stubFetchFiche(ficheClient({ traiteur_operationnel: null }));
      render(fiche());
      await screen.findByTestId('bloc-evenement', {}, ATTENTE_UI);
      for (const nom of ['Logistique', 'Bilan & documents']) {
        fireEvent.mouseDown(
          await screen.findByRole('tab', { name: nom }, ATTENTE_UI),
        );
        await screen.findByRole('tabpanel', {}, ATTENTE_UI);
        expect(document.body.textContent).not.toMatch(
          /transporteur|prestataire/i,
        );
      }
    },
    ATTENTE_CAS_MS,
  );
});
