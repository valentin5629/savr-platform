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
