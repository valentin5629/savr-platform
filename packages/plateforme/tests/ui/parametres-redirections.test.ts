/**
 * « Mon organisation » et « Mon profil » sont des onglets de « Paramètres »
 * (décision Val 2026-10-31) : les anciennes adresses y renvoient, sur le bon
 * onglet, pour que les favoris et anciens liens restent valides.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const redirectMock = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ redirect: redirectMock }));

import MonOrganisationTraiteur from '@/app/(traiteur)/traiteur/mon-organisation/page';
import MonProfilTraiteur from '@/app/(traiteur)/traiteur/mon-profil/page';
import MonOrganisationAgence from '@/app/(agence)/agence/mon-organisation/page';
import MonProfilAgence from '@/app/(agence)/agence/mon-profil/page';
import MonOrganisationGestionnaire from '@/app/(gestionnaire)/gestionnaire/mon-organisation/page';
import MonOrganisationOrganisateur from '@/app/(client-organisateur)/organisateur/mon-organisation/page';
import MonProfilOrganisateur from '@/app/(client-organisateur)/organisateur/mon-profil/page';

describe('Paramètres — anciennes adresses redirigées', () => {
  beforeEach(() => redirectMock.mockClear());

  it.each([
    [
      'traiteur/mon-organisation',
      MonOrganisationTraiteur,
      '/traiteur/parametres',
    ],
    [
      'traiteur/mon-profil',
      MonProfilTraiteur,
      '/traiteur/parametres?onglet=profil',
    ],
    ['agence/mon-organisation', MonOrganisationAgence, '/agence/parametres'],
    ['agence/mon-profil', MonProfilAgence, '/agence/parametres?onglet=profil'],
    [
      'gestionnaire/mon-organisation',
      MonOrganisationGestionnaire,
      '/gestionnaire/parametres',
    ],
    [
      'organisateur/mon-organisation',
      MonOrganisationOrganisateur,
      '/organisateur/parametres',
    ],
    [
      'organisateur/mon-profil',
      MonProfilOrganisateur,
      '/organisateur/parametres?onglet=profil',
    ],
  ] as const)('parametres_redirection — /%s → %s', (_nom, page, cible) => {
    page();
    expect(redirectMock).toHaveBeenCalledWith(cible);
  });
});
