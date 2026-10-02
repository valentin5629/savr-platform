/**
 * M2.3 — Page « Paramètres algorithme AG » (CDC §06.09 §7).
 * Vérifie que la saisie est convertie selon `type_valeur` avant le PATCH :
 * une liste `text[]` part en tableau JSON (jamais en chaîne — bug 2026-10-02,
 * scalaire en base ⇒ fn_calculer_algo_attribution_ag lève sur toutes les
 * collectes AG), et une saisie non conforme est refusée sans appel réseau.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import AlgoAgParamsPage from './page';
import { convertirSaisie } from '@/lib/parametres-algo/saisie';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}
let calls: FetchCall[] = [];

const PARAMS = [
  {
    cle: 'everest_codes_postaux',
    valeur: ['75', '92', '93'],
    type_valeur: 'text[]',
    description:
      'Codes postaux (2 premiers chiffres) couverts par le service vélo',
    updated_at: '2026-06-15T00:00:00Z',
  },
  {
    cle: 'regle_ag_seuil_pax_velo',
    valeur: 600,
    type_valeur: 'int',
    description: 'Seuil PAX',
    updated_at: '2026-06-15T00:00:00Z',
  },
  {
    cle: 'regle_ag_plage_velo_debut',
    valeur: '07:00',
    type_valeur: 'time',
    description: 'Début plage vélo',
    updated_at: '2026-06-15T00:00:00Z',
  },
];

function installFetch() {
  global.fetch = vi.fn((url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({
      url,
      method,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    const payload = method === 'GET' ? { data: PARAMS } : { data: PARAMS[0] };
    return Promise.resolve({
      ok: true,
      json: async () => payload,
    } as Response);
  }) as unknown as typeof fetch;
}

/** Saisit dans le champ du paramètre (par sa clé) puis clique SON bouton « Sauvegarder ». */
async function saisirEtSauvegarder(cle: string, valeur: string) {
  // Le champ porte l'id `param-<cle>` (FormField htmlFor) ; on le cible par la
  // clé plutôt que par son libellé pour rester neutre vis-à-vis du prestataire.
  const input = await waitFor(() => {
    const el = document.getElementById(`param-${cle}`);
    if (!el) throw new Error(`champ param-${cle} absent`);
    return el as HTMLInputElement;
  }, ATTENTE_UI);
  fireEvent.change(input, { target: { value: valeur } });
  // Remonte jusqu'à l'ancêtre (la carte du paramètre) qui contient le bouton.
  let carte: HTMLElement | null = input;
  while (carte && !carte.querySelector('button')) carte = carte.parentElement;
  const btn = carte?.querySelector('button');
  if (!btn) throw new Error('bouton Sauvegarder introuvable');
  fireEvent.click(btn);
}

describe('M2.3 / Paramètres algorithme AG — conversion de la saisie', () => {
  beforeEach(() => {
    calls = [];
    installFetch();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it(
    'text[] : la liste saisie part en TABLEAU JSON dans le PATCH, jamais en chaîne',
    async () => {
      render(<AlgoAgParamsPage />);
      await saisirEtSauvegarder(
        'everest_codes_postaux',
        '["75","92","93","94"]',
      );
      await waitFor(
        () => expect(calls.some((c) => c.method === 'PATCH')).toBe(true),
        ATTENTE_UI,
      );
      const patch = calls.find((c) => c.method === 'PATCH')!;
      expect(patch.body).toEqual({
        cle: 'everest_codes_postaux',
        valeur: ['75', '92', '93', '94'],
      });
    },
    ATTENTE_CAS_MS,
  );

  it(
    'text[] : une saisie qui n’est pas une liste JSON est refusée sans appel réseau',
    async () => {
      render(<AlgoAgParamsPage />);
      await saisirEtSauvegarder('everest_codes_postaux', '75, 92, 93');
      expect(
        await screen.findByText(/Liste JSON attendue/, undefined, ATTENTE_UI),
      ).toBeInTheDocument();
      expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'time : une heure hors HH:MM est refusée sans appel réseau',
    async () => {
      render(<AlgoAgParamsPage />);
      await saisirEtSauvegarder('regle_ag_plage_velo_debut', '7h');
      expect(
        await screen.findByText(/format HH:MM/, undefined, ATTENTE_UI),
      ).toBeInTheDocument();
      expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
    },
    ATTENTE_CAS_MS,
  );
});

describe('M2.3 / convertirSaisie — table de conversion par type', () => {
  it.each([
    ['bool', 'true', true],
    ['bool', 'false', false],
    ['int', '600', 600],
    ['decimal', '0.45', 0.45],
    ['decimal', '0,45', 0.45],
    ['time', '20:00', '20:00'],
    ['text[]', '["75","92"]', ['75', '92']],
    ['string', 'nb_collectes_6_mois_asc', 'nb_collectes_6_mois_asc'],
  ])('%s : %j → %j', (type, saisie, attendu) => {
    expect(convertirSaisie(type, saisie)).toEqual(attendu);
  });

  it.each([
    ['int', '600.5'],
    ['decimal', '0x10'],
    ['decimal', '1e3'],
    ['int', 'abc'],
    ['decimal', ''],
    ['time', '25:00'],
    ['time', '7:00'],
    ['text[]', '["75",92]'],
    ['text[]', '"75"'],
    ['text[]', '75,92'],
  ])('%s : %j est refusé', (type, saisie) => {
    expect(() => convertirSaisie(type, saisie)).toThrow();
  });
});
