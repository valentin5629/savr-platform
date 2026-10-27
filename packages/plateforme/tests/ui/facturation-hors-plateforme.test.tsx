/**
 * Facturation hors plateforme au go-live (décision Val 2026-10-22), côté écrans
 * clients.
 *
 * Interrupteur éteint : le traiteur, l'agence et le gestionnaire de lieux ne
 * voient plus leurs factures (onglet, carte, ligne « Facture » de la fiche
 * collecte), et aucune requête de factures ne part. Restent visibles : la carte
 * « Entités de facturation » du traiteur (son SIRET vérifié est requis pour
 * l'attestation de don AG) et les autres onglets.
 *
 * Chaque cas « éteint » lit la vraie valeur de l'interrupteur ; le pendant
 * « allumé » de la fiche collecte force la valeur, pour prouver que c'est bien
 * l'interrupteur qui masque. Les onglets allumés restent prouvés par les tests
 * existants (factures-filtres.test.tsx, mon-organisation-gestionnaire.m3-2,
 * factures-filtres-bar.r-ui-4b), qui forcent l'interrupteur à « allumé ».
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

const interrupteur = vi.hoisted(() => ({ force: null as boolean | null }));
vi.mock('@/lib/facturation-plateforme', async (importOriginal) => {
  const reel =
    await importOriginal<typeof import('@/lib/facturation-plateforme')>();
  return {
    facturationPlateformeActive: () =>
      interrupteur.force ?? reel.facturationPlateformeActive(),
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));
vi.mock('@/lib/page-auth', () => ({
  requirePageSession: vi.fn(async () => ({})),
}));

import { MonOrganisationClient } from '@/app/(traiteur)/traiteur/mon-organisation/mon-organisation-client';
import MonOrganisationGestionnairePage from '@/app/(gestionnaire)/gestionnaire/mon-organisation/page';
import MonOrganisationAgencePage from '@/app/(agence)/agence/mon-organisation/page';
import { FicheCollecteClientModal } from '@/components/collecte/fiche-collecte-client-modal.js';
import {
  ficheClient,
  stubFetchFiche,
} from '@/test-utils/fiche-collecte-client';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

const PROFIL = {
  id: 'org-1',
  nom: 'Org',
  raison_sociale: 'Org SAS',
  siret: '12345678900011',
  adresse: null,
  email_principal: null,
  telephone: null,
  logo_url: null,
};

/** fetch simulé : profil sur `…/profil`, liste vide ailleurs ; URL journalisées. */
function stubFetchProfil(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL) =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          data: String(input).includes('/profil') ? PROFIL : [],
        }),
        { status: 200 },
      ),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function urls(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map((c) => String(c[0]));
}

const nomsOnglets = (): string[] =>
  screen.getAllByRole('tab').map((t) => t.textContent ?? '');

beforeEach(() => {
  interrupteur.force = null;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('facturation_hors_plateforme — Mon organisation', () => {
  it(
    'traiteur : plus d’onglet Facturation, la carte des entités (SIRET) reste',
    async () => {
      const fetchMock = stubFetchProfil();
      render(<MonOrganisationClient isManager userId="u1" />);

      expect(nomsOnglets()).toEqual([
        'Informations légales',
        'Équipe',
        'Préférences',
      ]);
      // Gardée : le SIRET vérifié de l'entité est requis pour l'attestation AG.
      expect(
        await screen.findByText('Entités de facturation', {}, ATTENTE_UI),
      ).toBeTruthy();
      expect(screen.queryByText('Paramètres de facturation')).toBeNull();
      expect(
        urls(fetchMock).some((u) => u.startsWith('/api/v1/traiteur/factures')),
      ).toBe(false);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'gestionnaire de lieux : plus d’onglet Factures, aucune requête de factures',
    async () => {
      const fetchMock = stubFetchProfil();
      render(<MonOrganisationGestionnairePage />);

      expect(nomsOnglets()).toEqual(['Profil', 'Membres']);
      await screen.findByDisplayValue('Org SAS', {}, ATTENTE_UI);
      fireEvent.mouseDown(screen.getByRole('tab', { name: 'Membres' }));
      await waitFor(
        () =>
          expect(urls(fetchMock).some((u) => u.endsWith('/users'))).toBe(true),
        ATTENTE_UI,
      );
      expect(urls(fetchMock).some((u) => u.endsWith('/factures'))).toBe(false);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'agence : plus de carte Facturation, les informations légales restent',
    async () => {
      const fetchMock = stubFetchProfil();
      render(await MonOrganisationAgencePage());

      expect(
        await screen.findByDisplayValue('Org SAS', {}, ATTENTE_UI),
      ).toBeTruthy();
      expect(screen.queryByText('Facturation')).toBeNull();
      expect(
        urls(fetchMock).some((u) => u.startsWith('/api/v1/agence/factures')),
      ).toBe(false);
    },
    ATTENTE_CAS_MS,
  );
});

describe('facturation_hors_plateforme — fiche collecte, Bilan & documents', () => {
  const FICHE_FACTUREE = ficheClient({
    statut: 'cloturee',
    rapport_rse_disponible: true,
    factures: [
      {
        id: 'f1',
        numero_facture: 'FZD-2026-0001',
        statut: 'emise',
        pdf_url_savr: 'savr-dev/factures/f1.pdf',
        pdf_url_pennylane: null,
      },
    ],
  });

  async function ouvrirBilan(): Promise<void> {
    stubFetchFiche(FICHE_FACTUREE);
    render(
      <FicheCollecteClientModal
        espace="traiteur"
        collecteId="c1"
        onClose={() => {}}
      />,
    );
    fireEvent.mouseDown(
      await screen.findByRole('tab', { name: 'Bilan & documents' }, ATTENTE_UI),
    );
    // Le rapport se télécharge depuis le pied de la fiche (Val 2026-10-27).
    await screen.findByTestId('action-telecharger-rapport', {}, ATTENTE_UI);
  }

  it(
    'éteint : la facture émise n’apparaît pas, le rapport reste',
    async () => {
      await ouvrirBilan();

      expect(screen.queryByTestId('document-facture')).toBeNull();
      expect(screen.queryByText(/FZD-2026-0001/)).toBeNull();
      expect(screen.queryByTestId('bloc-documents')).toBeNull();
      expect(screen.getByTestId('action-telecharger-rapport')).toBeTruthy();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'allumé : la même facture réapparaît',
    async () => {
      interrupteur.force = true;
      await ouvrirBilan();

      expect(
        await screen.findByTestId('document-facture', {}, ATTENTE_UI),
      ).toBeTruthy();
      expect(screen.getByTestId('document-facture').textContent).toContain(
        'Facture FZD-2026-0001',
      );
    },
    ATTENTE_CAS_MS,
  );
});
