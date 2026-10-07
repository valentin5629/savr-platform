/**
 * Logos d'organisation — câblage du `src` sur un proxy serveur.
 *
 * `organisations.logo_url` porte une CLÉ de stockage R2 (`<bucket>/logos/<uuid>.png|jpg`,
 * migration 20260919100000) et non une URL publique : posée telle quelle dans le `src`
 * d'une <img>, le navigateur la résout comme une URL RELATIVE et n'affiche rien
 * (mesuré sur savr-dev : `GET /admin/clients/savr-dev/logos/….jpg → 404`).
 * Cette sonde fige le câblage de la fiche organisation Admin ; côté gestionnaire, la
 * liste des traiteurs est couverte par M3.2/P2_traiteurs_logo_par_proxy et la fiche
 * traiteur (pop-up) par M3.2/logo_fiche_traiteur_gestionnaire_par_proxy
 * (tests/ui/fiche-traiteur-modale.m3-2.test.tsx).
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

import ClientFichePage from '@/app/(admin)/admin/clients/[id]/page.js';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

const CLE = 'savr-dev/logos/59358d91-38f5-4c73-8726-099deece78c5.jpg';

function reponse(obj: unknown): Promise<Response> {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(obj),
  } as Response);
}

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

describe('M1.1a / logo de la fiche organisation — proxy d’affichage', () => {
  it(
    'M1.1a/logo_fiche_client_admin_par_proxy — src = proxy staff, jamais la clé R2',
    async () => {
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

      // La page ne rend qu'une image : l'asserter rend l'échec explicite si une
      // autre <img> vient un jour s'intercaler avant le logo.
      const imgs = document.querySelectorAll('img');
      expect(imgs).toHaveLength(1);
      const img = imgs[0]!;
      expect(img.getAttribute('src')).toBe(
        `/api/v1/admin/uploads/logo?key=${encodeURIComponent(CLE)}`,
      );
      expect(img.getAttribute('src')).not.toBe(CLE);
    },
    ATTENTE_CAS_MS,
  );
});
