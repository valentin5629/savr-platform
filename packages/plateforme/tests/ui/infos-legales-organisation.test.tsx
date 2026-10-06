/**
 * Carte « Informations légales » partagée (agence, client organisateur,
 * traiteur, gestionnaire) — décision Val 2026-09-28 : modifiable par tous les rôles.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { createRoot } from 'react-dom/client';

import {
  InfosLegalesCard,
  InfosLegalesOrganisation,
} from '@/components/organisation/infos-legales-card.js';
import { RgpdComptePanel } from '@/components/compte/rgpd-compte-panel.js';
import { NAV_CONFIG } from '@/lib/nav-config.js';
import { messageDeRole } from '@/test-utils/message-role';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';
import { renderAvecToasts } from '@/test-utils/toasts';

const URL_PROFIL = '/api/v1/agence/mon-organisation/profil';
const PROFIL = {
  id: 'org-arep',
  nom: 'Agence AREP',
  raison_sociale: 'AREP SARL',
  siret: null,
  adresse: null,
  email_principal: 'contact@arep.test',
  telephone: null,
  logo_url: null,
};

function reponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Informations légales — carte partagée', () => {
  it(
    'affiche les valeurs de l’organisation et les champs en lecture seule',
    async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(reponse(200, { data: PROFIL }))),
      );
      render(<InfosLegalesOrganisation urlProfil={URL_PROFIL} />);
      expect(
        await screen.findByDisplayValue('AREP SARL', {}, ATTENTE_UI),
      ).toBeTruthy();
      expect(screen.getByText('Agence AREP')).toBeTruthy();
      expect(screen.getByText('contact@arep.test')).toBeTruthy();
      // Rien à enregistrer tant qu'aucun champ n'a changé.
      expect(
        (
          screen.getByRole('button', {
            name: 'Enregistrer',
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'n’envoie que le champ modifié et confirme l’enregistrement',
    async () => {
      const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
        Promise.resolve(
          init?.method === 'PATCH'
            ? reponse(200, { data: { ...PROFIL, siret: '12345678900011' } })
            : reponse(200, { data: PROFIL }),
        ),
      );
      vi.stubGlobal('fetch', fetchMock);
      // Succès = toast (R-UI-1 H1) : rendu sous ToastProvider.
      renderAvecToasts(<InfosLegalesOrganisation urlProfil={URL_PROFIL} />);
      const champ = await screen.findByLabelText('SIRET', {}, ATTENTE_UI);
      fireEvent.change(champ, { target: { value: '12345678900011' } });
      fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
      // Toast de succès (R-UI-1 H1).
      expect(
        await screen.findByText(
          'Informations enregistrées.',
          undefined,
          ATTENTE_UI,
        ),
      ).toBeInTheDocument();
      const patch = fetchMock.mock.calls.find(([, i]) => i?.method === 'PATCH');
      expect(patch?.[0]).toBe(URL_PROFIL);
      expect(JSON.parse(String(patch?.[1]?.body))).toEqual({
        siret: '12345678900011',
      });
    },
    ATTENTE_CAS_MS,
  );

  it(
    'affiche l’erreur renvoyée par le serveur',
    async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn((_url: string, init?: RequestInit) =>
          Promise.resolve(
            init?.method === 'PATCH'
              ? reponse(422, {
                  error: 'Adresse : 500 caractères maximum',
                })
              : reponse(200, { data: PROFIL }),
          ),
        ),
      );
      render(<InfosLegalesOrganisation urlProfil={URL_PROFIL} />);
      const champ = await screen.findByLabelText('Adresse', {}, ATTENTE_UI);
      fireEvent.change(champ, { target: { value: '1 rue Neuve' } });
      fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
      expect(
        (await messageDeRole('alert', /Adresse : 500 caractères maximum/))
          .textContent,
      ).toMatch(/Adresse : 500 caractères maximum/);
    },
    ATTENTE_CAS_MS,
  );

  it(
    'chargement en échec : message d’erreur, pas de formulaire vide',
    async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(reponse(500, { error: 'x' }))),
      );
      render(<InfosLegalesOrganisation urlProfil={URL_PROFIL} />);
      expect(
        (await messageDeRole('alert', /Impossible de charger/)).textContent,
      ).toMatch(/Impossible de charger/);
      expect(screen.queryByRole('textbox')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );
});

describe('Informations légales — robustesse de la saisie', () => {
  it('un nouveau profil aux mêmes valeurs légales (ex. après envoi du logo) n’écrase pas la saisie', () => {
    const { rerender } = render(
      <InfosLegalesCard
        profil={PROFIL}
        urlProfil={URL_PROFIL}
        onSaved={() => {}}
      />,
    );
    const champ = screen.getByLabelText('Adresse') as HTMLInputElement;
    fireEvent.change(champ, { target: { value: '9 rue en cours' } });
    rerender(
      <InfosLegalesCard
        profil={{ ...PROFIL, logo_url: 'savr-dev/logos/x.png' }}
        urlProfil={URL_PROFIL}
        onSaved={() => {}}
      />,
    );
    expect((screen.getByLabelText('Adresse') as HTMLInputElement).value).toBe(
      '9 rue en cours',
    );
  });
});

describe('Informations personnelles — chargement en échec', () => {
  it(
    'bloque le formulaire (l’enregistrer vide effacerait le téléphone)',
    async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(reponse(500, { error: 'x' }))),
      );
      render(<RgpdComptePanel />);
      expect(
        (await messageDeRole('alert', /Impossible de charger vos informations/))
          .textContent,
      ).toMatch(/Impossible de charger vos informations/);
      expect(
        (screen.getByLabelText('Téléphone') as HTMLInputElement).disabled,
      ).toBe(true);
      const boutons = screen.getAllByRole('button', { name: 'Enregistrer' });
      expect((boutons[0] as HTMLButtonElement).disabled).toBe(true);
    },
    ATTENTE_CAS_MS,
  );
});

describe('Suppression de compte — absente du profil staff', () => {
  it(
    'masquée avec avecSuppression={false}, présente par défaut',
    async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve(
            reponse(200, { data: { prenom: 'A', nom: 'B', telephone: null } }),
          ),
        ),
      );
      const { unmount } = render(<RgpdComptePanel avecSuppression={false} />);
      await screen.findByDisplayValue('A', {}, ATTENTE_UI);
      expect(
        screen.queryByRole('button', {
          name: 'Demander la suppression de mon compte',
        }),
      ).toBeNull();
      unmount();
      render(<RgpdComptePanel />);
      await screen.findByDisplayValue('A', {}, ATTENTE_UI);
      expect(
        screen.getByRole('button', {
          name: 'Demander la suppression de mon compte',
        }),
      ).toBeTruthy();
    },
    ATTENTE_CAS_MS,
  );
});

describe('Navigation — accès à ses informations pour tous les rôles', () => {
  it.each([
    ['client_organisateur', '/organisateur/mon-organisation'],
    ['client_organisateur', '/organisateur/mon-profil'],
    ['admin_savr', '/admin/mon-profil'],
  ] as const)('%s → %s', (role, href) => {
    const hrefs = NAV_CONFIG[role].flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).toContain(href);
  });
});

// Course mesurée en CI sous charge : l'effet qui recopie le profil dans le
// formulaire s'exécutait APRÈS une première frappe et l'écrasait (saisie perdue,
// « Enregistrer » inactif). Reproduite ici sans dépendre de la charge : la carte
// est montée HORS `act`, et la frappe part dès que le champ est dans le DOM —
// avant que le planificateur de React n'exécute les effets passifs du montage.
describe('Informations légales — saisie immédiate après montage', () => {
  it('une frappe avant les effets de montage n’est pas écrasée', async () => {
    const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const avant = g.IS_REACT_ACT_ENVIRONMENT;
    g.IS_REACT_ACT_ENVIRONMENT = false;
    const conteneur = document.createElement('div');
    document.body.appendChild(conteneur);
    const racine = createRoot(conteneur);
    try {
      racine.render(
        <InfosLegalesCard
          profil={PROFIL}
          urlProfil={URL_PROFIL}
          onSaved={() => {}}
        />,
      );
      const champ = await new Promise<HTMLInputElement>((ok) => {
        const obs = new MutationObserver(() => {
          const el = conteneur.querySelector<HTMLInputElement>('#org-siret');
          if (el) {
            obs.disconnect();
            ok(el);
          }
        });
        obs.observe(conteneur, { childList: true, subtree: true });
      });
      fireEvent.change(champ, { target: { value: '12345678900011' } });
      await new Promise((r) => setTimeout(r, 50));
      expect(champ.value).toBe('12345678900011');
    } finally {
      racine.unmount();
      conteneur.remove();
      g.IS_REACT_ACT_ENVIRONMENT = avant;
    }
  });
});
