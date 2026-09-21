/**
 * M3.2 — Détail événement gestionnaire, sous-bloc AG (§06.05 §3 « Bloc collectes
 * rattachées > Pour AG » : repas donnés, association avec ville ET distance).
 *
 * La distance est restituée depuis l'arbitrage Val 2026-09-21 (option b de
 * _Divergences/M3.2_20260918_detail-evenement-distance-association) : la route
 * la calcule à la volée (haversine, aucune colonne stockée) et la page l'affiche
 * en km entiers — « — » quand elle vaut null (association ou lieu non géocodé).
 * Sans cette sonde, une route qui calcule juste et une page qui n'affiche rien
 * passeraient inaperçues : c'était le cas de la ville, sélectionnée mais jamais
 * rendue.
 *
 * `use(params)` ne se résout jamais sous Suspense dans cet environnement de test
 * (jsdom + React 19 + RTL 16) : on passe une promesse DÉJÀ marquée résolue au
 * sens de React, que `use()` lit synchroniquement — même geste que
 * tests/ui/logo-organisation-proxy.test.tsx (aucun module React remplacé).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/gestionnaire/evenements/e1',
}));

import EvenementDetailPage from '@/app/(gestionnaire)/gestionnaire/evenements/[id]/page.js';
import { ATTENTE_UI } from '@/test-utils/attente-ui';

const params = (id: string) =>
  Object.assign(Promise.resolve({ id }), {
    status: 'fulfilled',
    value: { id },
  });

function detail(attributions: unknown[]) {
  return {
    data: {
      id: 'e1',
      nom_evenement: 'Gala',
      date_evenement: '2026-06-01',
      pax: 300,
      taille_bracket: 'S',
      dechets_labo_kg: null,
      lieux: { nom: 'Paris Expo', adresse_acces: null, ville: 'Paris' },
      organisations: { nom: 'Kaspia', logo_url: null },
      collectes: [
        {
          id: 'c-ag',
          type: 'anti_gaspi',
          statut: 'cloturee',
          statut_affiche: 'Réalisée',
          date_collecte: '2026-06-01',
          heure_collecte: null,
          taux_recyclage: null,
          collecte_flux: [],
          attributions_antgaspi: attributions,
          bordereaux_savr: [],
          rapports_rse: [],
          attestations_don: [],
        },
      ],
    },
  };
}

function stubFetch(payload: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(payload),
      } as Response),
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('M3.2 / détail événement — distance de l’association', () => {
  it('M3.2/detail_evenement_ag_distance_affichee_km — « 12 km » à côté de la ville de l’association', async () => {
    stubFetch(
      detail([
        {
          id: 'a1',
          volume_repas_realise: 88,
          distance_km: 12,
          associations: { nom: 'Les Restos', ville: 'Versailles' },
        },
      ]),
    );

    render(<EvenementDetailPage params={params('e1')} />);
    await screen.findByText('Les Restos', { exact: false }, ATTENTE_UI);

    const ligne = screen.getByText('Les Restos', { exact: false });
    expect(ligne.textContent).toContain('Versailles');
    expect(ligne.textContent).toContain('12 km');
    expect(ligne.textContent).toContain('88 repas');
  });

  it('M3.2/detail_evenement_ag_distance_absente_tiret — distance null : « — », jamais 0 km', async () => {
    stubFetch(
      detail([
        {
          id: 'a1',
          volume_repas_realise: 88,
          distance_km: null,
          associations: { nom: 'Asso non géocodée', ville: 'Paris' },
        },
      ]),
    );

    render(<EvenementDetailPage params={params('e1')} />);
    await screen.findByText('Asso non géocodée', { exact: false }, ATTENTE_UI);

    const ligne = screen.getByText('Asso non géocodée', { exact: false });
    expect(ligne.textContent).toContain('—');
    expect(ligne.textContent).not.toContain('0 km');
    expect(ligne.textContent).not.toContain('km');
  });
});

/**
 * Scénario P1 §06.05 §3 « Détail événement » — consultation pure.
 *
 * Il n'était porté par AUCUN test et absent du `scenarios[]` de
 * specs/manifests/M3.2.json : `check:coverage M3.2` ressortait vert sur un
 * scénario invisible. Trois exigences de l'en-tête (type d'événement, logo du
 * traiteur, client organisateur) étaient d'ailleurs renvoyées par la route mais
 * jamais rendues — c'est exactement ce que l'absence de sonde laissait passer.
 *
 * Deux choix de sonde, pour qu'elle ne puisse pas être verte à vide :
 * 1. la charge contient `email_principal` / `telephone` / `siret` sur le
 *    traiteur, que le CDC interdit d'afficher. Les asserter ABSENTS n'aurait
 *    aucune valeur si la charge ne les portait pas : ici, une page qui
 *    déverserait l'objet traiteur passerait au rouge ;
 * 2. les boutons interdits sont cherchés en ÉNUMÉRANT les <button>/<a> rendus,
 *    pas en interrogeant trois libellés devinés — un « Éditer » ajouté demain
 *    est attrapé.
 *
 * Libellé : le bouton du rapport de recyclage s'appelle « Rapport RSE » dans
 * toute l'app (espace organisateur, panneau Admin) ; « rapport de recyclage »
 * est le terme métier du CDC. Le document EST listé, seul son libellé diffère,
 * et il est aligné sur le reste des écrans.
 */
const FLUX_ZD: [string, number][] = [
  ['Biodéchets', 120],
  ['Emballages', 18],
  ['Carton', 42],
  ['Verre', 25],
  ['Déchet résiduel', 9],
];

function evenementComplet() {
  return {
    data: {
      id: 'e1',
      nom_evenement: 'Salon Auto',
      date_evenement: '2026-06-01',
      pax: 300,
      taille_bracket: 'S',
      dechets_labo_kg: 45,
      nom_client_organisateur: 'Agence WPM',
      lieux: { nom: 'Paris Expo', adresse_acces: null, ville: 'Paris' },
      // Champs que le §06.05 §3 interdit d'afficher : présents dans la charge
      // POUR que leur absence à l'écran soit une mesure, pas une tautologie.
      organisations: {
        id: 'tr1',
        nom: 'Kaspia',
        logo_url: 'savr-dev/logos/8f21-kaspia.jpg',
        email_principal: 'contact@kaspia.example',
        telephone: '0102030405',
        siret: '81234567800019',
      },
      types_evenements: { libelle: 'Salon professionnel' },
      collectes: [
        {
          id: 'c-zd',
          type: 'zero_dechet',
          statut: 'cloturee',
          statut_affiche: 'Réalisée',
          date_collecte: '2026-06-01',
          heure_collecte: '18:00',
          taux_recyclage: 72.5,
          collecte_flux: FLUX_ZD.map(([nom, kg]) => ({
            poids_reel_kg: kg,
            flux_dechets: { code: nom.toLowerCase(), nom },
          })),
          attributions_antgaspi: [],
          bordereaux_savr: [
            { id: 'b1', numero: 'BS-2026-0042', statut: 'emis' },
          ],
          rapports_rse: [{ id: 'r1', pdf_url: 'savr-dev/rapports/r1.pdf' }],
          attestations_don: [],
        },
        {
          id: 'c-ag',
          type: 'anti_gaspi',
          statut: 'realisee',
          statut_affiche: 'Réalisée',
          date_collecte: '2026-06-01',
          heure_collecte: '20:00',
          taux_recyclage: null,
          collecte_flux: [],
          attributions_antgaspi: [
            {
              id: 'a1',
              volume_repas_realise: 200,
              distance_km: 12,
              associations: { nom: 'Les Restos', ville: 'Versailles' },
            },
          ],
          bordereaux_savr: [],
          rapports_rse: [],
          attestations_don: [
            {
              id: 'at1',
              pdf_url: 'savr-dev/attestations/at1.pdf',
              associations: { nom: 'Les Restos' },
            },
          ],
        },
      ],
    },
  };
}

const normalise = (t: string | null | undefined) =>
  (t ?? '').replace(/\s+/g, ' ').trim();

describe('M3.2 / détail événement — consultation en lecture seule', () => {
  it('M3.2/detail_evenement_consultation_lecture_seule — en-tête, sous-blocs ZD et AG, documents, aucune action', async () => {
    stubFetch(evenementComplet());

    render(<EvenementDetailPage params={params('e1')} />);
    await screen.findByText('Salon Auto', undefined, ATTENTE_UI);

    const page = normalise(document.body.textContent);

    // ── En-tête : nom, date, lieu, pax, type, taille bracket, traiteur ──
    expect(screen.getByRole('heading', { name: 'Salon Auto' })).toBeVisible();
    expect(page).toContain('2026-06-01');
    expect(page).toContain('Paris Expo');
    expect(page).toContain('300');
    expect(page).toContain('Salon professionnel');
    expect(screen.getByText('S')).toBeVisible(); // badge taille bracket
    expect(page).toContain('Kaspia');
    expect(page).toContain('Agence WPM');

    // Déchets labo estimés : affichés avec leur tooltip explicatif (§06.05 §3).
    // Le coefficient brut du traiteur (0.15) ne doit jamais apparaître.
    const labo = screen.getByText(/Est\. labo/);
    expect(normalise(labo.textContent)).toBe('Est. labo : 45.0 kg');
    expect(labo.getAttribute('title')).toContain('Estimation amont');

    // Logo traiteur : servi par le proxy scopé, jamais la clé R2 (#367).
    const logos = document.querySelectorAll('img');
    expect(logos).toHaveLength(1);
    expect(logos[0]!.getAttribute('src')).toBe(
      '/api/v1/gestionnaire/traiteurs/tr1/logo',
    );
    expect(logos[0]!.getAttribute('src')).not.toContain('savr-dev/logos');

    // …mais ni email, ni téléphone, ni SIRET (§06.05 §3).
    expect(page).not.toContain('contact@kaspia.example');
    expect(page).not.toContain('0102030405');
    expect(page).not.toContain('81234567800019');

    // ── Sous-blocs : type, date + heure de début, statut affiché ──
    expect(page).toMatch(
      /Collecte Zéro Déchet\s*2026-06-01 · 18:00\s*Réalisée/,
    );
    expect(page).toMatch(/Collecte Anti-Gaspi\s*2026-06-01 · 20:00\s*Réalisée/);

    // ── Sous-bloc ZD : les 5 flux avec leurs kg + le taux de recyclage ──
    for (const [nom, kg] of FLUX_ZD) {
      expect(page).toContain(`${nom} : ${kg} kg`);
    }
    expect(page).toContain('Taux de recyclage');
    expect(page).toContain('72.5 %');

    // ── Sous-bloc AG : repas donnés + association avec ville ET distance ──
    expect(page).toContain('Les Restos · Versailles · 12 km — 200 repas');

    // ── Bloc documents : bordereau ZD, rapport de recyclage, attestation ──
    expect(
      screen.getByRole('button', { name: /Bordereau BS-2026-0042/ }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Rapport RSE' })).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Attestation don' }),
    ).toBeVisible();

    // ── Consultation pure : aucune action de modification ──
    const actions = [
      ...document.querySelectorAll('button'),
      ...document.querySelectorAll('a'),
    ].map((el) => normalise(el.textContent));
    const interdit = /modifi|dupliqu|annul|supprim|édit|nouvelle collecte/i;
    expect(actions.filter((t) => interdit.test(t))).toEqual([]);
  });

  it('M3.2/detail_evenement_consultation_lecture_seule — client organisateur non renseigné : cellule absente, et déchets labo à « — »', async () => {
    // Deux cas-limites du §06.05 §3 que le cas nominal ne peut pas mesurer :
    // « Client Organisateur SI renseigné » (sinon rien) et « — si le traiteur
    // n'a pas communiqué de coefficient » (et non la ligne qui disparaît, ce
    // qui rendrait les deux situations indistinguables à l'écran).
    const charge = evenementComplet();
    charge.data.nom_client_organisateur = null as unknown as string;
    charge.data.dechets_labo_kg = null as unknown as number;
    stubFetch(charge);

    render(<EvenementDetailPage params={params('e1')} />);
    await screen.findByText('Salon Auto', undefined, ATTENTE_UI);

    expect(screen.queryByText('Client organisateur')).toBeNull();

    const labo = screen.getByText(/Est\. labo/);
    expect(normalise(labo.textContent)).toBe('Est. labo : —');
    expect(normalise(labo.textContent)).not.toContain('kg');
  });
});
