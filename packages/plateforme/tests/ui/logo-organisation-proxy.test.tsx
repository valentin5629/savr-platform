/**
 * Logos d'organisation — câblage du `src` sur un proxy serveur.
 *
 * `organisations.logo_url` porte une CLÉ de stockage R2 (`<bucket>/logos/<uuid>.png|jpg`,
 * migration 20260919100000) et non une URL publique : posée telle quelle dans le `src`
 * d'une <img>, le navigateur la résout comme une URL RELATIVE et n'affiche rien
 * (mesuré sur savr-dev : `GET /admin/clients/savr-dev/logos/….jpg → 404`).
 * Ces deux sondes figent le câblage des fiches de détail ; la liste des traiteurs est
 * couverte par M3.2/P2_traiteurs_logo_par_proxy.
 *
 * `use(params)` ne se résout jamais sous Suspense dans cet environnement de test
 * (jsdom + React 19 + RTL 16 : un composant minimal `use(Promise.resolve(x))` reste
 * suspendu jusqu'au timeout). On passe donc une promesse DÉJÀ marquée résolue au
 * sens de React (`status`/`value`), que `use()` lit synchroniquement : aucun module
 * de React n'est remplacé — un mock de `use` casserait silencieusement tout
 * `use(Context)` des composants enfants (DS, Radix).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));
vi.mock('@/lib/use-user-role', () => ({ useUserRole: () => 'admin_savr' }));

import TraiteurDetailPage from '@/app/(gestionnaire)/gestionnaire/traiteurs/[id]/page.js';
import ClientFichePage from '@/app/(admin)/admin/clients/[id]/page.js';
import { ATTENTE_UI } from '@/test-utils/attente-ui';

const CLE = 'savr-dev/logos/59358d91-38f5-4c73-8726-099deece78c5.jpg';

function reponse(obj: unknown): Promise<Response> {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(obj),
  } as Response);
}

// `params` est consommé par le `use` mocké : un objet nu suffit.
// Promesse DÉJÀ marquée résolue au sens de React 19 : `use()` la lit
// synchroniquement, sans suspendre. Aucun module de React n'est remplacé —
// un mock de `use` casserait silencieusement tout `use(Context)` des enfants.
const params = (id: string) =>
  Object.assign(Promise.resolve({ id }), {
    status: 'fulfilled',
    value: { id },
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('M3.2 / logo d’un traiteur tiers — proxy d’affichage', () => {
  it('M3.2/logo_fiche_traiteur_gestionnaire_par_proxy — src = proxy scopé, jamais la clé R2', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        reponse({
          data: {
            id: 'tr1',
            nom: 'Kaspia',
            logo_url: CLE,
            stats_12m: {
              nb_collectes_zd: 2,
              nb_collectes_ag: 1,
              tonnage_zd_kg: 900,
              taux_recyclage_moyen: 72.4,
              repas_donnes: 120,
            },
            historique_collectes: [],
          },
        }),
      ),
    );

    render(<TraiteurDetailPage params={params('tr1')} />);
    await screen.findByText('Kaspia', undefined, ATTENTE_UI);

    const img = document.querySelector('img')!;
    expect(img).toBeTruthy();
    // Le périmètre est porté par la route (vue v_traiteurs_gestionnaire) :
    // la page ne transmet JAMAIS la clé de stockage.
    expect(img.getAttribute('src')).toBe(
      '/api/v1/gestionnaire/traiteurs/tr1/logo',
    );
    expect(img.getAttribute('src')).not.toContain(CLE);
  });
});

describe('M1.1a / logo de la fiche organisation — proxy d’affichage', () => {
  it('M1.1a/logo_fiche_client_admin_par_proxy — src = proxy staff, jamais la clé R2', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        reponse({
          id: 'org-viparis',
          raison_sociale: 'Viparis SAS',
          type: 'gestionnaire_lieux',
          siret: null,
          email_principal: null,
          telephone: null,
          actif: true,
          logo_url: CLE,
          tarif_refacture_pax_zd: null,
          grille_tarifaire_zd_id: null,
          entites_facturation: [],
          organisations_domaines_email: [],
          users: [],
          packs_antgaspi: [],
          tarifs_negocie: [],
        }),
      ),
    );

    render(<ClientFichePage params={params('org-viparis')} />);
    await screen.findByText('Viparis SAS', undefined, ATTENTE_UI);

    const img = document.querySelector('img')!;
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe(
      `/api/v1/admin/uploads/logo?key=${encodeURIComponent(CLE)}`,
    );
    expect(img.getAttribute('src')).not.toBe(CLE);
  });
});
