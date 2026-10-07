/**
 * M3.2 — Encart « Filtres benchmark » du gestionnaire de lieux (§06.05 Bloc 3 ZD,
 * décision Val 2026-10-06) : les listes Lieux / Traiteurs ne proposent que son
 * périmètre, et la case de tête s'appelle « Tout le parc Savr » — sans rien
 * cocher, le repère reste calculé sur tout le parc.
 *
 * Le piège verrouillé ici : une liste de filtre ordinaire ramène « toutes les
 * lignes cochées » à « Tous ». Sur une liste bornée aux lieux du gestionnaire,
 * ce raccourci aurait remplacé « mes trois sites » par « tout le parc ».
 */
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ATTENTE_CAS_MS, ATTENTE_UI } from '@/test-utils/attente-ui';
import { BenchmarkFilterBar } from '@/components/dashboards/BenchmarkFilterBar';
import { FicheCollecteClientModal } from '@/components/collecte/fiche-collecte-client-modal.js';
import {
  ficheClient,
  stubFetchFiche,
} from '@/test-utils/fiche-collecte-client';
import type { EspaceClient } from '@/lib/collectes/fiche-client-types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/gestionnaire/collectes',
}));

const LIEUX = [
  { id: 'l1', nom: 'CNIT Forest' },
  { id: 'l2', nom: 'Espace Champerret' },
  { id: 'l3', nom: 'Palais des Congrès de Paris' },
];
const TRAITEURS = [
  { id: 't1', nom: 'Kaspia' },
  { id: 't2', nom: 'Grandchemin' },
];
const TYPES = [{ id: 'ty1', libelle: 'Gala' }];

const rattachees = { lieux: LIEUX, traiteurs: TRAITEURS, types: TYPES };

async function ouvrir(testid: string, liste: string) {
  fireEvent.click(screen.getByTestId(testid));
  return within(await screen.findByRole('list', { name: liste }, ATTENTE_UI));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('M3.2 / encart filtres benchmark — listes rattachées du gestionnaire', () => {
  it(
    'M3.2/GEST04_encart_tout_le_parc_savr — case de tête « Tout le parc Savr », cochée par défaut, décochée dès qu’un lieu est coché',
    async () => {
      const onChange = vi.fn();
      render(
        <BenchmarkFilterBar
          perimetre="rattache"
          onChange={onChange}
          initialOptions={rattachees}
        />,
      );
      // Sans sélection : les deux déclencheurs annoncent tout le parc, pas « Tous ».
      expect(screen.getByTestId('benchmark-filter-lieux')).toHaveTextContent(
        'Lieux' + 'Tout le parc Savr',
      );
      expect(
        screen.getByTestId('benchmark-filter-traiteurs'),
      ).toHaveTextContent('Traiteurs' + 'Tout le parc Savr');
      expect(onChange.mock.calls.at(-1)?.[0]).toMatchObject({
        lieu_ids: [],
        traiteur_ids: [],
      });

      const lieux = await ouvrir('benchmark-filter-lieux', 'Lieux');
      const tete = lieux.getByRole('checkbox', { name: 'Tout le parc Savr' });
      expect(tete).toBeChecked();
      expect(lieux.queryByRole('checkbox', { name: 'Tous' })).toBeNull();

      fireEvent.click(lieux.getByRole('checkbox', { name: 'CNIT Forest' }));
      expect(tete).not.toBeChecked();
      expect(onChange.mock.calls.at(-1)?.[0]).toMatchObject({
        lieu_ids: ['l1'],
      });
      expect(screen.getByTestId('benchmark-filter-lieux')).toHaveTextContent(
        'Lieux' + 'CNIT Forest',
      );

      // Recocher la case de tête vide la sélection : retour à tout le parc.
      fireEvent.click(tete);
      expect(onChange.mock.calls.at(-1)?.[0]).toMatchObject({ lieu_ids: [] });
      expect(screen.getByTestId('benchmark-filter-lieux')).toHaveTextContent(
        'Lieux' + 'Tout le parc Savr',
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/GEST04_encart_tous_mes_lieux_coches — cocher toutes les lignes reste une sélection explicite, jamais « tout le parc »',
    async () => {
      const onChange = vi.fn();
      render(
        <BenchmarkFilterBar
          perimetre="rattache"
          onChange={onChange}
          initialOptions={rattachees}
        />,
      );
      const lieux = await ouvrir('benchmark-filter-lieux', 'Lieux');
      for (const l of LIEUX)
        fireEvent.click(lieux.getByRole('checkbox', { name: l.nom }));

      expect(onChange.mock.calls.at(-1)?.[0]).toMatchObject({
        lieu_ids: ['l1', 'l2', 'l3'],
      });
      expect(
        lieux.getByRole('checkbox', { name: 'Tout le parc Savr' }),
      ).not.toBeChecked();
      expect(screen.getByTestId('benchmark-filter-lieux')).toHaveTextContent(
        'Lieux' + '3 sélectionnés',
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/GEST04_encart_listes_parc_tous_inchange — listes du parc entier : case « Tous », et toutes les lignes cochées valent « Tous »',
    async () => {
      const onChange = vi.fn();
      render(
        <BenchmarkFilterBar
          onChange={onChange}
          initialOptions={{ lieux: LIEUX, traiteurs: [], types: TYPES }}
        />,
      );
      expect(screen.getByTestId('benchmark-filter-lieux')).toHaveTextContent(
        'Lieux' + 'Tous',
      );
      const lieux = await ouvrir('benchmark-filter-lieux', 'Lieux');
      expect(
        lieux.queryByRole('checkbox', { name: 'Tout le parc Savr' }),
      ).toBeNull();
      for (const l of LIEUX)
        fireEvent.click(lieux.getByRole('checkbox', { name: l.nom }));
      // Les options couvrent tout le parc : tout cocher = aucun filtre.
      expect(onChange.mock.calls.at(-1)?.[0]).toMatchObject({ lieu_ids: [] });
      expect(lieux.getByRole('checkbox', { name: 'Tous' })).toBeChecked();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/GEST04_encart_etat_mixte_lieu_coche_traiteurs_parc — un lieu coché laisse « Traiteurs Tout le parc Savr » : les deux listes sont indépendantes',
    async () => {
      const onChange = vi.fn();
      render(
        <BenchmarkFilterBar
          perimetre="rattache"
          onChange={onChange}
          initialOptions={rattachees}
        />,
      );
      const lieux = await ouvrir('benchmark-filter-lieux', 'Lieux');
      fireEvent.click(lieux.getByRole('checkbox', { name: 'CNIT Forest' }));
      expect(screen.getByTestId('benchmark-filter-lieux')).toHaveTextContent(
        'Lieux' + 'CNIT Forest',
      );
      expect(
        screen.getByTestId('benchmark-filter-traiteurs'),
      ).toHaveTextContent('Traiteurs' + 'Tout le parc Savr');
      expect(onChange.mock.calls.at(-1)?.[0]).toMatchObject({
        lieu_ids: ['l1'],
        traiteur_ids: [],
      });
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/GEST04_encart_libelle_des_le_premier_rendu — « Tout le parc Savr » s’affiche avant la réponse de /filtres, jamais « Tous » entre-temps',
    async () => {
      // Réponse jamais rendue : on observe l'écran pendant le chargement.
      const fetchMock = vi.fn(() => new Promise<never>(() => undefined));
      vi.stubGlobal('fetch', fetchMock);
      render(<BenchmarkFilterBar perimetre="rattache" onChange={vi.fn()} />);
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/dashboards/benchmark/filtres',
      );
      expect(screen.getByTestId('benchmark-filter-lieux')).toHaveTextContent(
        'Lieux' + 'Tout le parc Savr',
      );
    },
    ATTENTE_CAS_MS,
  );
});

// Fiche collecte : même barre, montée par un composant partagé entre espaces.
const ZD_CLOTUREE = {
  statut: 'cloturee',
  taux_recyclage: 78.4,
  co2_net_kg: 312,
  bilan_flux: { biodechet: 420, emballage: 180 },
  actions: { modifier: 'absent', annuler: 'absent', annulation: null },
} as const;

async function libelleLieuxDeLaFiche(espace: EspaceClient): Promise<string> {
  stubFetchFiche(ficheClient(ZD_CLOTUREE));
  render(
    <FicheCollecteClientModal
      espace={espace}
      collecteId="c1"
      onClose={() => undefined}
    />,
  );
  fireEvent.mouseDown(
    await screen.findByRole('tab', { name: 'Bilan & documents' }, ATTENTE_UI),
  );
  const bloc = await screen.findByTestId('bloc-3-zd-fiche', {}, ATTENTE_UI);
  return within(bloc).getByTestId('benchmark-filter-lieux').textContent ?? '';
}

describe('M3.2 / fiche collecte — filtre Lieux du repère selon l’espace', () => {
  it(
    'M3.2/fiche_benchmark_lieux_tout_le_parc_gestionnaire — espace gestionnaire : « Tout le parc Savr »',
    async () => {
      expect(await libelleLieuxDeLaFiche('gestionnaire')).toBe(
        'Lieux' + 'Tout le parc Savr',
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/fiche_benchmark_lieux_tous_traiteur — espace traiteur : « Tous » (liste du parc entier, inchangée)',
    async () => {
      expect(await libelleLieuxDeLaFiche('traiteur')).toBe('Lieux' + 'Tous');
    },
    ATTENTE_CAS_MS,
  );
});
