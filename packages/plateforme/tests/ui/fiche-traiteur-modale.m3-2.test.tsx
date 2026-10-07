/**
 * @vitest-environment jsdom
 *
 * M3.2 — Fiche traiteur du gestionnaire en pop-up sur la liste Traiteurs
 * (§06.05 §5, arbitrage Val 2026-10-07) : ouverture, adresse, onglet « Lieux
 * d'intervention » et onglet « Activité » (cartes KPI et graphique du dashboard,
 * Zéro Déchet ou Anti-Gaspi, filtrés sur le traiteur).
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  within,
} from '@testing-library/react';

const redirect = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/gestionnaire/traiteurs',
  redirect: (url: string) => redirect(url),
}));

import GestionnaireTraiteursPage from '@/app/(gestionnaire)/gestionnaire/traiteurs/page.js';
import FicheTraiteurGestionnaireRedirect from '@/app/(gestionnaire)/gestionnaire/traiteurs/[id]/page.js';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';
import { previousWindow } from '@/lib/dashboards/cockpit-derive';
import { periodeDerniers } from '@/lib/periodes-raccourcis';

const TRAITEUR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LISTE = '/gestionnaire/traiteurs';
const CLE_LOGO = 'savr-dev/logos/59358d91-38f5-4c73-8726-099deece78c5.jpg';

const LIEUX = [
  { id: 'l1', nom: 'Paris Expo Porte de Versailles', nb_collectes: 14 },
  { id: 'l2', nom: 'Espace Champerret', nb_collectes: 12 },
  { id: 'l3', nom: 'Palais des Congrès de Paris', nb_collectes: 11 },
];

const LIGNE = {
  id: TRAITEUR,
  nom: 'Fleurdemets',
  logo_url: null,
  nb_collectes_12m: 37,
  tonnage_12m_kg: 18362,
  taux_recyclage_moyen: 27.9,
  repas_donnes_12m: 693,
  lieux_intervention: LIEUX.map(({ id, nom }) => ({ id, nom })),
};

const FICHE = {
  id: TRAITEUR,
  nom: 'Fleurdemets',
  logo_url: null as string | null,
  lieux_intervention: LIEUX,
};

const KPI_ZD = {
  nb_collectes: 25,
  tonnage_kg: 18362,
  taux_recyclage_pondere: 27.9,
  kg_par_pax: 0.43,
};
const KPI_ZD_AVANT = {
  nb_collectes: 10,
  tonnage_kg: 9181,
  taux_recyclage_pondere: 31,
  kg_par_pax: 0.5,
};
const KPI_AG = {
  nb_collectes: 12,
  nb_repas_donnes: 693,
  pax_total: 8400,
  repas_par_pax: 0.08,
};

const SERIE_ZD = [
  {
    periode: '2026-04-01',
    biodechet: 1200,
    emballage: 400,
    carton: 600,
    verre: 300,
    dechet_residuel: 3187,
    tonnage_total: 5687,
    taux_recyclage: 44,
    nb_collectes: 9,
    pax: 12000,
  },
  {
    periode: '2026-09-01',
    biodechet: 1500,
    emballage: 500,
    carton: 700,
    verre: 400,
    dechet_residuel: 3304,
    tonnage_total: 6404,
    taux_recyclage: 48,
    nb_collectes: 16,
    pax: 15000,
  },
];
const SERIE_AG = [
  { periode: '2026-06-01', repas_donnes: 293, pax: 4000, ratio: 0.07 },
  { periode: '2026-09-01', repas_donnes: 400, pax: 4400, ratio: 0.09 },
];

type Reponse = { status?: number; body: unknown };
const ok = (data: unknown): Reponse => ({ body: { data } });

const PERIODE = periodeDerniers(12, 'mois')!;
const AVANT = previousWindow(PERIODE.from, PERIODE.to)!;

let fiche: Reponse;
// Réponse de la route KPI selon le type et la fenêtre demandés.
let kpis: (type: string, periodePrecedente: boolean) => Reponse;
let evolution: (type: string) => Reponse;
const appels: string[] = [];

const fetchMock = vi.fn((input: RequestInfo | URL) => {
  const url = String(input);
  appels.push(url);
  const usp = new URL(url, 'http://x').searchParams;
  const rep: Reponse = url.includes('/api/v1/dashboards/evolution')
    ? evolution(usp.get('type') ?? '')
    : url.includes('/api/v1/gestionnaire/dashboard')
      ? kpis(usp.get('type') ?? '', usp.get('from') === AVANT.from)
      : url.endsWith(`/gestionnaire/traiteurs/${TRAITEUR}`)
        ? fiche
        : ok([LIGNE]);
  const status = rep.status ?? 200;
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(rep.body),
  } as Response);
});

const appelsVers = (fragment: string) =>
  appels
    .filter((u) => u.includes(fragment))
    .map((u) => new URL(u, 'http://x').searchParams);

beforeEach(() => {
  cleanup();
  appels.length = 0;
  redirect.mockClear();
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  fiche = ok(FICHE);
  kpis = (type, precedente) =>
    ok({
      kpis: type === 'anti_gaspi' ? KPI_AG : precedente ? KPI_ZD_AVANT : KPI_ZD,
    });
  evolution = (type) =>
    ok({
      granularite: 'mois',
      series: type === 'anti_gaspi' ? SERIE_AG : SERIE_ZD,
    });
  window.history.replaceState(null, '', LISTE);
});

// Liste rendue, puis clic sur la ligne du traiteur → la fiche (dialogue) chargée.
async function ouvrirFiche() {
  render(<GestionnaireTraiteursPage />);
  const [cellule] = await screen.findAllByText(
    'Fleurdemets',
    undefined,
    ATTENTE_UI,
  );
  fireEvent.click(cellule!);
  const dialogue = await screen.findByRole(
    'dialog',
    { name: 'Fleurdemets' },
    ATTENTE_UI,
  );
  return within(dialogue);
}

async function ouvrirActivite() {
  const f = await ouvrirFiche();
  fireEvent.mouseDown(f.getByRole('tab', { name: 'Activité' }));
  return f;
}

// Carte KPI : le bloc qui porte le libellé et sa valeur. Bornée à la rangée des
// cartes — la légende du graphique reprend certains libellés.
const carte = (f: ReturnType<typeof within>, libelle: string) =>
  within(f.getByTestId('fiche-traiteur-kpis'))
    .getByText(libelle)
    .closest('div')!.parentElement!;

describe('M3.2 / fiche traiteur en pop-up', () => {
  it(
    'M3.2/fiche_traiteur_modale_ouverte_au_clic — la ligne ouvre la fiche sur la liste, l’adresse porte la fiche',
    async () => {
      const f = await ouvrirFiche();
      // Titre visible = grand en-tête de la fiche (le h2 du dialogue est réservé
      // aux lecteurs d'écran).
      expect(
        f.getByRole('heading', { name: 'Fleurdemets', level: 3 }),
      ).toBeTruthy();
      expect(window.location.pathname + window.location.search).toBe(
        `${LISTE}?traiteur=${TRAITEUR}`,
      );
      // La liste reste montée derrière la fiche (pas de changement de page).
      expect(
        screen.getByRole('heading', { name: 'Traiteurs' }),
      ).toBeInTheDocument();
      expect(f.getByTestId('fiche-traiteur-infos')).toHaveTextContent(
        '3 lieux d’intervention sur 24 mois',
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/fiche_traiteur_modale_lien_direct — ?traiteur=<id> ouvre la fiche à l’arrivée',
    async () => {
      // Un seul lieu : l'en-tête et l'onglet s'accordent au singulier.
      fiche = ok({ ...FICHE, lieux_intervention: LIEUX.slice(0, 1) });
      window.history.replaceState(null, '', `${LISTE}?traiteur=${TRAITEUR}`);
      render(<GestionnaireTraiteursPage />);
      const f = within(
        await screen.findByRole('dialog', { name: 'Fleurdemets' }, ATTENTE_UI),
      );
      expect(f.getByTestId('fiche-traiteur-infos')).toHaveTextContent(
        '1 lieu d’intervention sur 24 mois',
      );
      expect(
        f.getByRole('tab', { name: 'Lieux d’intervention (1)' }),
      ).toBeTruthy();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/fiche_traiteur_modale_fermeture_nettoie_l_adresse — fermer rend la liste et son adresse',
    async () => {
      const f = await ouvrirFiche();
      fireEvent.click(f.getByRole('button', { name: 'Fermer' }));
      await waitFor(
        () => expect(screen.queryByRole('dialog')).toBeNull(),
        ATTENTE_UI,
      );
      expect(window.location.pathname + window.location.search).toBe(LISTE);
    },
    ATTENTE_CAS_MS,
  );

  it('M3.2/fiche_traiteur_ancienne_route_redirige — /gestionnaire/traiteurs/<id> renvoie vers la liste, fiche ouverte', async () => {
    await FicheTraiteurGestionnaireRedirect({
      params: Promise.resolve({ id: TRAITEUR }),
    });
    expect(redirect).toHaveBeenCalledWith(`${LISTE}?traiteur=${TRAITEUR}`);
  });

  it(
    'M3.2/fiche_traiteur_modale_onglet_lieux — lieux d’intervention avec leur nombre de collectes sur 24 mois, onglet ouvert par défaut',
    async () => {
      const f = await ouvrirFiche();
      expect(
        f.getByRole('tab', { name: 'Lieux d’intervention (3)' }),
      ).toHaveAttribute('aria-selected', 'true');
      expect(
        f.getByText(
          'Collectes clôturées de ce traiteur sur vos lieux, au cours des 24 derniers mois.',
        ),
      ).toBeTruthy();
      // DataTable rend le tableau ET les cartes mobiles : on borne au tableau.
      const tableau = within(f.getByRole('table'));
      expect(
        tableau.getAllByRole('columnheader').map((c) => c.textContent),
      ).toEqual(['Lieu', 'Collectes 24 m']);
      expect(
        tableau
          .getAllByRole('row')
          .slice(1)
          .map((l) => l.textContent),
      ).toEqual([
        'Paris Expo Porte de Versailles14',
        'Espace Champerret12',
        'Palais des Congrès de Paris11',
      ]);
      // Rien de l'onglet Activité n'est chargé tant qu'il n'est pas ouvert.
      expect(appelsVers('/dashboards/evolution')).toHaveLength(0);
      expect(appelsVers('/gestionnaire/dashboard')).toHaveLength(0);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/fiche_traiteur_modale_onglet_lieux_vide — aucune collecte clôturée sur 24 mois : l’onglet reste présent et le dit',
    async () => {
      fiche = ok({ ...FICHE, lieux_intervention: [] });
      const f = await ouvrirFiche();
      expect(f.getByRole('tab', { name: 'Lieux d’intervention' })).toBeTruthy();
      expect(
        f.getByText(
          'Aucune collecte clôturée sur vos lieux au cours des 24 derniers mois.',
        ),
      ).toBeTruthy();
      expect(f.queryByRole('table')).toBeNull();
      expect(f.getByTestId('fiche-traiteur-infos')).toHaveTextContent(
        'Aucune intervention sur 24 mois',
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/fiche_traiteur_modale_lecture_seule — aucune saisie, aucune action, plus d’historique des collectes',
    async () => {
      const f = await ouvrirFiche();
      expect(f.queryAllByRole('textbox')).toHaveLength(0);
      expect(f.queryAllByRole('combobox')).toHaveLength(0);
      expect(f.queryAllByRole('checkbox')).toHaveLength(0);
      // Onglet Lieux : le seul bouton de la fiche est sa croix de fermeture.
      expect(
        f
          .getAllByRole('button')
          .map((b) => b.getAttribute('aria-label') ?? b.textContent),
      ).toEqual(['Fermer']);
      expect(f.queryByText(/Historique des collectes/)).toBeNull();

      fireEvent.mouseDown(f.getByRole('tab', { name: 'Activité' }));
      await f.findByText('Nombre de collectes', undefined, ATTENTE_UI);
      expect(f.queryAllByRole('textbox')).toHaveLength(0);
      expect(f.queryByText(/Historique des collectes/)).toBeNull();
      expect(f.queryByRole('button', { name: /Enregistrer|Modifier/ })).toBe(
        null,
      );
    },
    ATTENTE_CAS_MS,
  );

  // `organisations.logo_url` porte une CLÉ R2 (20260919100000) : la poser dans
  // src n'affiche rien. La vignette passe par le proxy scopé.
  it(
    'M3.2/logo_fiche_traiteur_gestionnaire_par_proxy — src = proxy scopé, jamais la clé R2',
    async () => {
      fiche = ok({ ...FICHE, logo_url: CLE_LOGO });
      const f = await ouvrirFiche();
      const dialogue = screen.getByRole('dialog', { name: 'Fleurdemets' });
      // La fiche ne rend qu'une image : l'asserter rend l'échec explicite si une
      // autre <img> vient un jour s'intercaler avant le logo.
      const imgs = dialogue.querySelectorAll('img');
      expect(imgs).toHaveLength(1);
      // Le périmètre est porté par la route (vue v_traiteurs_gestionnaire) :
      // la fiche ne transmet JAMAIS la clé de stockage.
      expect(imgs[0]!.getAttribute('src')).toBe(
        `/api/v1/gestionnaire/traiteurs/${TRAITEUR}/logo`,
      );
      expect(imgs[0]!.getAttribute('src')).not.toContain(CLE_LOGO);

      // Logo que le proxy ne rend pas : le nom seul, pas de vignette cassée.
      fireEvent.error(imgs[0]!);
      expect(dialogue.querySelectorAll('img')).toHaveLength(0);
      expect(
        f.getByRole('heading', { name: 'Fleurdemets', level: 3 }),
      ).toBeTruthy();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/fiche_traiteur_modale_erreur_chargement — un échec n’est pas un traiteur vide, « Réessayer » relance',
    async () => {
      fiche = { status: 500, body: {} };
      render(<GestionnaireTraiteursPage />);
      const [cellule] = await screen.findAllByText(
        'Fleurdemets',
        undefined,
        ATTENTE_UI,
      );
      fireEvent.click(cellule!);
      const alerte = await screen.findByRole('alert', {}, ATTENTE_UI);
      expect(alerte).toHaveTextContent('Impossible de charger ce traiteur');
      expect(screen.queryByRole('tab')).toBeNull();

      fiche = ok(FICHE);
      fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
      expect(
        await screen.findByRole('dialog', { name: 'Fleurdemets' }, ATTENTE_UI),
      ).toBeTruthy();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/fiche_traiteur_modale_introuvable — 404 : message dédié, pas d’onglet',
    async () => {
      fiche = { status: 404, body: { error: 'Traiteur non trouvé' } };
      window.history.replaceState(null, '', `${LISTE}?traiteur=${TRAITEUR}`);
      render(<GestionnaireTraiteursPage />);
      expect(
        await screen.findByText('Traiteur non trouvé', undefined, ATTENTE_UI),
      ).toBeTruthy();
      expect(screen.queryByRole('tab')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );
});

describe('M3.2 / fiche traiteur — onglet Activité', () => {
  it(
    'M3.2/fiche_traiteur_modale_activite_zd — 4 cartes KPI et histogramme du dashboard, filtrés sur le traiteur, 12 derniers mois',
    async () => {
      const f = await ouvrirActivite();
      expect(
        await f.findByText(
          'Évolution mensuelle Zéro Déchet',
          undefined,
          ATTENTE_UI,
        ),
      ).toBeTruthy();
      // Zéro Déchet sélectionné à l'ouverture.
      expect(f.getByRole('radio', { name: 'Zéro Déchet' })).toBeChecked();

      // Les 4 cartes du dashboard gestionnaire, mêmes libellés et formats.
      expect(carte(f, 'Nombre de collectes')).toHaveTextContent('25');
      expect(carte(f, 'Tonnage collecté')).toHaveTextContent(/18,4\s*t/);
      expect(carte(f, 'Taux de recyclage')).toHaveTextContent(/27,9\s*%/);
      expect(carte(f, 'kg/pax moyen')).toHaveTextContent(/0,43\s*kg\/pax/);
      // Variation vs la période précédente équivalente : 25 collectes contre 10.
      expect(carte(f, 'Nombre de collectes')).toHaveTextContent(/▲ 150,0\s%/);
      // kg/pax : pas de variation (« plus bas = mieux »).
      expect(carte(f, 'kg/pax moyen')).not.toHaveTextContent(/[▲▼]/);
      // Légende du graphique du dashboard : flux et taux de recyclage.
      expect(f.getByRole('button', { name: /Biodéchets/ })).toBeTruthy();
      expect(f.getByRole('button', { name: /Taux de recyclage/ })).toBeTruthy();

      // Mêmes routes que le dashboard : ZD, ce traiteur seul, 12 derniers mois.
      const evo = appelsVers('/dashboards/evolution');
      expect(evo).toHaveLength(1);
      expect(evo[0]!.get('type')).toBe('zero_dechet');
      expect(evo[0]!.getAll('traiteur_ids[]')).toEqual([TRAITEUR]);
      expect(evo[0]!.getAll('lieu_ids[]')).toEqual([]);
      expect(evo[0]!.get('from')).toBe(PERIODE.from);
      expect(evo[0]!.get('to')).toBe(PERIODE.to);

      const kpi = appelsVers('/gestionnaire/dashboard');
      expect(
        kpi.map((p) => [
          p.get('type'),
          p.get('from'),
          p.get('to'),
          p.getAll('traiteur_ids[]'),
        ]),
      ).toEqual([
        ['zero_dechet', PERIODE.from, PERIODE.to, [TRAITEUR]],
        ['zero_dechet', AVANT.from, AVANT.to, [TRAITEUR]],
      ]);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/fiche_traiteur_modale_activite_ag — bascule Anti-Gaspi : 4 cartes AG et graphique des repas donnés',
    async () => {
      const f = await ouvrirActivite();
      await f.findByText('Nombre de collectes', undefined, ATTENTE_UI);
      fireEvent.click(f.getByRole('radio', { name: 'Anti-Gaspi' }));

      expect(
        await f.findByText('Évolution Anti-Gaspi', undefined, ATTENTE_UI),
      ).toBeTruthy();
      expect(carte(f, 'Nombre de collectes')).toHaveTextContent('12');
      expect(carte(f, 'Repas donnés')).toHaveTextContent('693');
      expect(carte(f, 'Pax cumulés')).toHaveTextContent(/8\s400/);
      expect(carte(f, 'Repas/pax moyen')).toHaveTextContent('0,08');
      // Les cartes et le graphique ZD ont laissé la place.
      expect(f.queryByText('Tonnage collecté')).toBeNull();
      expect(f.queryByText('Évolution mensuelle Zéro Déchet')).toBeNull();

      const evo = appelsVers('/dashboards/evolution').filter(
        (p) => p.get('type') === 'anti_gaspi',
      );
      expect(evo).toHaveLength(1);
      expect(evo[0]!.getAll('traiteur_ids[]')).toEqual([TRAITEUR]);
      expect(evo[0]!.get('from')).toBe(PERIODE.from);
      const kpi = appelsVers('/gestionnaire/dashboard').filter(
        (p) => p.get('type') === 'anti_gaspi',
      );
      expect(kpi.map((p) => p.get('from'))).toEqual([PERIODE.from, AVANT.from]);
      expect(kpi.every((p) => p.getAll('traiteur_ids[]')[0] === TRAITEUR)).toBe(
        true,
      );
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/fiche_traiteur_modale_activite_sans_collecte — aucune collecte du type sur 12 mois : état vide, ni cartes à zéro ni graphique',
    async () => {
      kpis = () => ok({ kpis: { ...KPI_ZD, nb_collectes: 0, tonnage_kg: 0 } });
      evolution = () => ok({ granularite: 'mois', series: [] });
      const f = await ouvrirActivite();
      expect(
        await f.findByText(
          'Aucune collecte Zéro Déchet clôturée sur vos lieux au cours des 12 derniers mois.',
          undefined,
          ATTENTE_UI,
        ),
      ).toBeTruthy();
      expect(f.queryByText('Nombre de collectes')).toBeNull();
      expect(f.queryByText('Évolution mensuelle Zéro Déchet')).toBeNull();
      // Le sélecteur reste disponible : l'autre type peut avoir des collectes.
      fireEvent.click(f.getByRole('radio', { name: 'Anti-Gaspi' }));
      expect(
        await f.findByText(
          'Aucune collecte Anti-Gaspi clôturée sur vos lieux au cours des 12 derniers mois.',
          undefined,
          ATTENTE_UI,
        ),
      ).toBeTruthy();
      expect(f.queryByText('Évolution Anti-Gaspi')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/fiche_traiteur_modale_activite_erreur — un chargement en échec n’est pas rendu comme « aucune collecte », « Réessayer » relance',
    async () => {
      kpis = () => ({ status: 500, body: { error: 'Erreur serveur' } });
      const f = await ouvrirActivite();
      const alerte = await f.findByRole('alert', {}, ATTENTE_UI);
      expect(alerte).toHaveTextContent(
        "Impossible de charger l'activité de ce traiteur",
      );
      expect(f.queryByText(/Aucune collecte Zéro Déchet/)).toBeNull();
      expect(f.queryByText('Nombre de collectes')).toBeNull();

      kpis = () => ok({ kpis: KPI_ZD });
      fireEvent.click(f.getByRole('button', { name: 'Réessayer' }));
      expect(
        await f.findByText('Nombre de collectes', undefined, ATTENTE_UI),
      ).toBeTruthy();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/fiche_traiteur_modale_activite_graphique_en_echec — l’histogramme en échec affiche l’erreur, pas des cartes sans graphique',
    async () => {
      evolution = () => ({ status: 500, body: { error: 'Erreur serveur' } });
      const f = await ouvrirActivite();
      const alerte = await f.findByRole('alert', {}, ATTENTE_UI);
      expect(alerte).toHaveTextContent(
        "Impossible de charger l'activité de ce traiteur",
      );
      expect(f.queryByText('Nombre de collectes')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'M3.2/fiche_traiteur_modale_activite_periode_precedente_en_echec — la période précédente illisible ne masque que les variations',
    async () => {
      kpis = (_type, precedente) =>
        precedente ? { status: 500, body: {} } : ok({ kpis: KPI_ZD });
      const f = await ouvrirActivite();
      await f.findByText('Nombre de collectes', undefined, ATTENTE_UI);
      expect(carte(f, 'Nombre de collectes')).toHaveTextContent('25');
      expect(f.getByTestId('fiche-traiteur-kpis')).not.toHaveTextContent(
        /[▲▼]/,
      );
      expect(f.queryByRole('alert')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );
});
