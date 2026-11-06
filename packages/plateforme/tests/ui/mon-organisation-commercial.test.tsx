/**
 * Mon organisation vue par le commercial traiteur (Val 2026-10-30).
 *
 * Lecture seule sur l'organisation (informations légales sans formulaire) ;
 * onglet Équipe visible mais réduit : liste sans changement de rôle ni
 * « Suspendre », invitation, et transfert de SES collectes (pas de champ
 * « Depuis »). Le pendant manager prouve que c'est bien le rôle qui réduit.
 * L'onglet Préférences est masqué pour tous.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));

import { ParametresTraiteurClient } from '@/app/(traiteur)/traiteur/parametres/parametres-client';
import { ATTENTE_UI, ATTENTE_CAS_MS } from '@/test-utils/attente-ui';

const PROFIL = {
  id: 'org-1',
  nom: 'Org',
  raison_sociale: 'Org SAS',
  siret: '12345678900011',
  adresse: '1 rue Neuve',
  email_principal: null,
  telephone: null,
  logo_url: null,
};

const EQUIPE = [
  {
    id: 'u1',
    prenom: 'Paul',
    nom: 'Commercial',
    email: 'paul@org.fr',
    poste: 'Chargé de clientèle',
    role: 'traiteur_commercial',
    actif: true,
    derniere_connexion: null,
  },
  {
    id: 'u2',
    prenom: 'Marie',
    nom: 'Manager',
    email: 'marie@org.fr',
    poste: null,
    role: 'traiteur_manager',
    actif: true,
    derniere_connexion: null,
  },
];

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      const data = url.includes('/profil')
        ? PROFIL
        : url.endsWith('/traiteur/equipe')
          ? EQUIPE
          : [];
      return Promise.resolve(
        new Response(JSON.stringify({ data }), { status: 200 }),
      );
    }),
  );
}

const nomsOnglets = (): string[] =>
  screen.getAllByRole('tab').map((t) => t.textContent ?? '');

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Mon organisation — commercial traiteur', () => {
  it('onglets : Membres visible, Préférences masqué', () => {
    stubFetch();
    render(<ParametresTraiteurClient isManager={false} userId="u1" />);
    expect(nomsOnglets()).toEqual(['Mon profil', 'Organisation', 'Membres']);
  });

  it(
    'informations légales en lecture seule, sans « Enregistrer »',
    async () => {
      stubFetch();
      render(<ParametresTraiteurClient isManager={false} userId="u1" />);
      fireEvent.mouseDown(screen.getByRole('tab', { name: 'Organisation' }));
      expect(await screen.findByText('Org SAS', {}, ATTENTE_UI)).toBeTruthy();
      expect(screen.getByText('12345678900011')).toBeTruthy();
      expect(screen.queryByLabelText('Raison sociale')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Enregistrer' })).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'équipe : ni rôle modifiable ni « Suspendre » ; transfert de ses collectes seules',
    async () => {
      stubFetch();
      render(<ParametresTraiteurClient isManager={false} userId="u1" />);
      fireEvent.mouseDown(screen.getByRole('tab', { name: 'Membres' }));

      expect(
        (await screen.findAllByText('marie@org.fr', {}, ATTENTE_UI)).length,
      ).toBeGreaterThan(0);
      expect(screen.queryByRole('button', { name: 'Suspendre' })).toBeNull();
      expect(screen.queryByLabelText('Rôle de Marie Manager')).toBeNull();
      expect(screen.getByText('Inviter un collaborateur')).toBeTruthy();
      expect(screen.getByText('Transférer mes collectes')).toBeTruthy();
      expect(screen.queryByText('Depuis')).toBeNull();
    },
    ATTENTE_CAS_MS,
  );

  it(
    'membres_poste_affiche — colonne « Poste », tiret quand il manque (Val 2026-11-01)',
    async () => {
      stubFetch();
      render(<ParametresTraiteurClient isManager={false} userId="u1" />);
      fireEvent.mouseDown(screen.getByRole('tab', { name: 'Membres' }));

      // La Data Table rend aussi la vue mobile : on lit la ligne du tableau.
      const ligne = (await screen.findAllByText('paul@org.fr', {}, ATTENTE_UI))
        .map((e) => e.closest('tr'))
        .find(Boolean)!;
      expect(screen.getByRole('columnheader', { name: /Poste/ })).toBeTruthy();
      expect(ligne.textContent).toContain('Chargé de clientèle');
      const ligneMarie = screen
        .getAllByText('marie@org.fr')
        .map((e) => e.closest('tr'))
        .find(Boolean)!;
      expect(ligneMarie.textContent).toContain('—');
    },
    ATTENTE_CAS_MS,
  );

  it(
    'pendant manager : rôle modifiable, « Suspendre » et champ « Depuis »',
    async () => {
      stubFetch();
      render(<ParametresTraiteurClient isManager userId="u2" />);
      fireEvent.mouseDown(screen.getByRole('tab', { name: 'Membres' }));

      expect(
        (await screen.findAllByText('paul@org.fr', {}, ATTENTE_UI)).length,
      ).toBeGreaterThan(0);
      expect(
        screen.getAllByRole('button', { name: 'Suspendre' }).length,
      ).toBeGreaterThan(0);
      expect(
        screen.getAllByLabelText('Rôle de Paul Commercial').length,
      ).toBeGreaterThan(0);
      expect(screen.getByText('Transférer les collectes')).toBeTruthy();
      expect(screen.getByText('Depuis')).toBeTruthy();
    },
    ATTENTE_CAS_MS,
  );
});
