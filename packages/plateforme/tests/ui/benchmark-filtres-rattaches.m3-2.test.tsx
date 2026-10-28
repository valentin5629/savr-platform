/**
 * M3.2 — Encart « Filtres benchmark » du gestionnaire de lieux (§06.05 Bloc 3 ZD,
 * décision Val 2026-10-06) : les listes Lieux / Traiteurs ne proposent que son
 * périmètre — sans rien cocher, le repère reste calculé sur tout le parc. La
 * case de tête s'appelle « Tous » comme ailleurs (Val 2026-10-28, remplace
 * « Tout le parc Savr »).
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
    'M3.2/GEST04_encart_case_tete_tous — case de tête « Tous » (Val 2026-10-28), cochée par défaut, décochée dès qu’un lieu est coché',
    async () => {
      const onChange = vi.fn();
      render(
        <BenchmarkFilterBar
          perimetre="rattache"
          onChange={onChange}
          initialOptions={rattachees}
        />,
      );
      // Sans sélection : les deux déclencheurs disent « Tous » (Val 2026-10-28).
      expect(screen.getByTestId('benchmark-filter-lieux')).toHaveTextContent(
        'Lieux' + 'Tous',
      );
      expect(
        screen.getByTestId('benchmark-filter-traiteurs'),
      ).toHaveTextContent('Traiteurs' + 'Tous');
      expect(onChange.mock.calls.at(-1)?.[0]).toMatchObject({
        lieu_ids: [],
        traiteur_ids: [],
      });

      const lieux = await ouvrir('benchmark-filter-lieux', 'Lieux');
      const tete = lieux.getByRole('checkbox', { name: 'Tous' });
      expect(tete).toBeChecked();
      expect(
        lieux.queryByRole('checkbox', { name: 'Tout le parc Savr' }),
      ).toBeNull();

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
        'Lieux' + 'Tous',
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/GEST04_encart_tous_mes_lieux_coches — cocher toutes les lignes reste une sélection explicite, jamais « Tous » (tout le parc)',
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
      expect(lieux.getByRole('checkbox', { name: 'Tous' })).not.toBeChecked();
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
    'M3.2/GEST04_encart_etat_mixte_lieu_coche_traiteurs_parc — un lieu coché laisse « Traiteurs Tous » : les deux listes sont indépendantes',
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
      ).toHaveTextContent('Traiteurs' + 'Tous');
      expect(onChange.mock.calls.at(-1)?.[0]).toMatchObject({
        lieu_ids: ['l1'],
        traiteur_ids: [],
      });
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/GEST04_encart_libelle_des_le_premier_rendu — « Tous » s’affiche avant la réponse de /filtres',
    async () => {
      // Réponse jamais rendue : on observe l'écran pendant le chargement.
      const fetchMock = vi.fn(() => new Promise<never>(() => undefined));
      vi.stubGlobal('fetch', fetchMock);
      render(<BenchmarkFilterBar perimetre="rattache" onChange={vi.fn()} />);
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/dashboards/benchmark/filtres',
      );
      expect(screen.getByTestId('benchmark-filter-lieux')).toHaveTextContent(
        'Lieux' + 'Tous',
      );
    },
    ATTENTE_CAS_MS,
  );
});

// Fiche collecte : même barre, montée par un composant partagé entre espaces.
const ZD_CLOTUREE = {
  statut: 'cloturee',
  taux_recyclage: 78.4,
  co2_evite_kg: 312,
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
    'M3.2/fiche_benchmark_lieux_tout_le_parc_gestionnaire — espace gestionnaire : pastille « Lieux » (Val 2026-10-28)',
    async () => {
      expect(await libelleLieuxDeLaFiche('gestionnaire')).toBe(
        'Lieux' + 'Lieux',
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/fiche_benchmark_lieux_tous_traiteur — espace traiteur : pastille « Lieux » (liste du parc entier, inchangée)',
    async () => {
      // Pastille (Val 2026-10-28) : sans sélection, elle affiche le nom du
      // filtre ; le titre « Lieux » reste lu par les lecteurs d'écran.
      expect(await libelleLieuxDeLaFiche('traiteur')).toBe('Lieux' + 'Lieux');
    },
    ATTENTE_CAS_MS,
  );
});

describe('M3.2 / filtres du repère en pastilles (Val 2026-10-28)', () => {
  it(
    'M3.2/pastilles_nom_du_filtre — Types / Tailles / Lieux / Traiteurs sans sélection ; « Tous » coché par défaut, décoché dès qu’une valeur est cochée',
    async () => {
      const onChange = vi.fn();
      render(
        <BenchmarkFilterBar
          disposition="pastilles"
          onChange={onChange}
          initialOptions={{ lieux: LIEUX, traiteurs: TRAITEURS, types: TYPES }}
        />,
      );
      const valeur = (testid: string) =>
        screen.getByTestId(testid).querySelector('span:nth-child(2)')
          ?.textContent;
      expect(valeur('benchmark-filter-type')).toBe('Types');
      expect(valeur('benchmark-filter-taille')).toBe('Tailles');
      expect(valeur('benchmark-filter-lieux')).toBe('Lieux');
      expect(valeur('benchmark-filter-traiteurs')).toBe('Traiteurs');

      const lieux = await ouvrir('benchmark-filter-lieux', 'Lieux');
      const tous = lieux.getByRole('checkbox', { name: 'Tous' });
      expect(tous).toBeChecked();
      fireEvent.click(lieux.getByRole('checkbox', { name: 'CNIT Forest' }));
      expect(tous).not.toBeChecked();
      expect(valeur('benchmark-filter-lieux')).toBe('CNIT Forest');
      expect(onChange.mock.calls.at(-1)?.[0]).toMatchObject({
        lieu_ids: ['l1'],
      });
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/pastilles_gestionnaire_tout_le_parc — gestionnaire : pastille « Lieux », case de tête « Tous » cochée par défaut (Val 2026-10-28)',
    async () => {
      render(
        <BenchmarkFilterBar
          disposition="pastilles"
          perimetre="rattache"
          onChange={vi.fn()}
          initialOptions={rattachees}
        />,
      );
      expect(screen.getByTestId('benchmark-filter-lieux')).toHaveTextContent(
        'Lieux' + 'Lieux',
      );
      const lieux = await ouvrir('benchmark-filter-lieux', 'Lieux');
      expect(lieux.getByRole('checkbox', { name: 'Tous' })).toBeChecked();
    },
    ATTENTE_CAS_MS,
  );
});
