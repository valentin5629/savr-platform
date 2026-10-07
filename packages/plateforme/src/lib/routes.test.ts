import { describe, expect, it } from 'vitest';
import {
  API_COLLECTES,
  ESPACE_PAR_ROLE,
  HOME_BY_ROLE,
  ROLE_PREFIXES,
  ROUTES,
} from './routes';
import { NAV_CONFIG } from './nav-config';
import { getRolesForPath } from '../middleware';

// Oracles = contenu LITTÉRAL des 4 tables avant leur dérivation (R-UI-2 J4).
const ANCIEN_HOME_BY_ROLE = {
  admin_savr: '/admin/dashboard',
  ops_savr: '/admin/dashboard',
  traiteur_manager: '/traiteur',
  traiteur_commercial: '/traiteur',
  agence: '/agence',
  gestionnaire_lieux: '/gestionnaire',
  client_organisateur: '/organisateur',
};

const ANCIEN_ROLE_PREFIXES = {
  '/admin': ['admin_savr', 'ops_savr'],
  '/traiteur': ['traiteur_manager', 'traiteur_commercial'],
  '/agence': ['agence'],
  '/gestionnaire': ['gestionnaire_lieux'],
  '/organisateur': ['client_organisateur'],
  '/registre': [
    'traiteur_manager',
    'traiteur_commercial',
    'gestionnaire_lieux',
    'client_organisateur',
  ],
  '/programmer': [
    'traiteur_commercial',
    'traiteur_manager',
    'agence',
    'gestionnaire_lieux',
    'admin_savr',
    'ops_savr',
  ],
  '/brouillons': [
    'traiteur_commercial',
    'traiteur_manager',
    'agence',
    'gestionnaire_lieux',
    'admin_savr',
    'ops_savr',
  ],
};

const ANCIEN_API_COLLECTES = {
  traiteur: '/api/v1/traiteur/collectes',
  agence: '/api/v1/agence/collectes',
};

const NAV_TRAITEUR = [
  ['Dashboard', '/traiteur'],
  ['Collectes', '/traiteur/collectes'],
  ['Mon organisation', '/traiteur/mon-organisation'],
  ['Mon profil', '/traiteur/mon-profil'],
];
const ANCIENNE_NAV: Record<string, string[][]> = {
  admin_savr: [
    ['Dashboard Admin', '/admin/dashboard'],
    ['Dashboard Client', '/admin/dashboard-client'],
    ['Collectes', '/admin/collectes'],
    ['Facturation', '/admin/factures'],
    ['Associations', '/admin/associations'],
    ['Transporteurs', '/admin/transporteurs'],
    ['Lieux', '/admin/lieux'],
    ['Clients', '/admin/clients'],
    ['Paramètres', '/admin/parametres'],
    ['Mon profil', '/admin/mon-profil'],
    ['Alertes', '/admin/alertes'],
    ['Santé système', '/admin/sante-systeme'],
  ],
  traiteur_manager: NAV_TRAITEUR,
  traiteur_commercial: NAV_TRAITEUR,
  agence: [
    ['Dashboard', '/agence'],
    ['Collectes', '/agence/collectes'],
    ['Mon organisation', '/agence/mon-organisation'],
    ['Mon profil', '/agence/mon-profil'],
  ],
  gestionnaire_lieux: [
    ['Dashboard', '/gestionnaire'],
    ['Mes lieux', '/gestionnaire/lieux'],
    ['Collectes', '/gestionnaire/collectes'],
    ['Registre réglementaire', '/registre'],
    ['Traiteurs', '/gestionnaire/traiteurs'],
    ['Mon pack AG', '/gestionnaire/mon-pack-ag'],
    ['Mon organisation', '/gestionnaire/mon-organisation'],
    ['Paramètres', '/gestionnaire/parametres'],
  ],
  client_organisateur: [
    ['Mes événements', '/organisateur'],
    ['Collectes', '/organisateur/collectes'],
    ['Documents', '/organisateur/documents'],
    ['Registre réglementaire', '/registre'],
    ['Mon organisation', '/organisateur/mon-organisation'],
    ['Mon profil', '/organisateur/mon-profil'],
  ],
};

describe('lib/routes — équivalence des 4 tables rôle ↔ chemin', () => {
  it('HOME_BY_ROLE identique (clés, ordre, valeurs)', () => {
    expect(Object.entries(HOME_BY_ROLE)).toEqual(
      Object.entries(ANCIEN_HOME_BY_ROLE),
    );
  });

  it('ROLE_PREFIXES identique (préfixes dans le même ordre, rôles dans le même ordre)', () => {
    expect(Object.entries(ROLE_PREFIXES)).toEqual(
      Object.entries(ANCIEN_ROLE_PREFIXES),
    );
  });

  it('NAV_CONFIG : mêmes entrées (libellé + href) par rôle', () => {
    const actuelle = Object.fromEntries(
      Object.entries(NAV_CONFIG).map(([role, groupes]) => [
        role,
        groupes.flatMap((g) => g.items.map((i) => [i.label, i.href])),
      ]),
    );
    expect(actuelle).toEqual(ANCIENNE_NAV);
    expect(Object.keys(NAV_CONFIG)).toEqual(Object.keys(ANCIENNE_NAV));
  });

  it('NAV_CONFIG : le Dashboard de chaque rôle = son accueil', () => {
    for (const [role, groupes] of Object.entries(NAV_CONFIG)) {
      expect(groupes[0]?.items[0]?.href).toBe(
        HOME_BY_ROLE[role as keyof typeof HOME_BY_ROLE],
      );
    }
  });

  it('API_COLLECTES identique', () => {
    expect(API_COLLECTES).toEqual(ANCIEN_API_COLLECTES);
  });

  it('ESPACE_PAR_ROLE couvre les 7 rôles', () => {
    expect(Object.keys(ESPACE_PAR_ROLE).sort()).toEqual(
      Object.keys(ANCIEN_HOME_BY_ROLE).sort(),
    );
  });

  it('middleware : getRolesForPath lit la table dérivée', () => {
    expect(getRolesForPath('/admin/collectes')).toEqual([
      'admin_savr',
      'ops_savr',
    ]);
    expect(getRolesForPath('/programmer/nouveau')).toEqual(
      ANCIEN_ROLE_PREFIXES['/programmer'],
    );
    expect(getRolesForPath('/registre')).toEqual(
      ANCIEN_ROLE_PREFIXES['/registre'],
    );
    expect(getRolesForPath('/administration')).toBeNull();
    expect(getRolesForPath('/login')).toBeNull();
  });
});

describe('lib/routes — chemins', () => {
  it('chemins fixes', () => {
    expect(ROUTES.login).toBe('/login');
    expect(ROUTES.interdit).toBe('/403');
    expect(ROUTES.programmer.nouveau).toBe('/programmer/nouveau');
    expect(ROUTES.admin.collectes).toBe('/admin/collectes');
    expect(ROUTES.admin.parametres).toBe('/admin/parametres');
    expect(ROUTES.admin.parametresAlgoAg).toBe('/admin/parametres/algo-ag');
    expect(ROUTES.admin.settingsUsers).toBe('/admin/settings/users');
    expect(ROUTES.registreMethodologie).toBe('/registre/methodologie');
  });

  it("chemins paramétrés : id inséré tel quel (pas d'encodage, iso-comportement)", () => {
    expect(ROUTES.admin.collecte('abc')).toBe('/admin/collectes/abc');
    expect(ROUTES.admin.facture('f1')).toBe('/admin/factures/f1');
    expect(ROUTES.admin.client('c1')).toBe('/admin/clients/c1');
    expect(ROUTES.admin.organisation('o1')).toBe('/admin/organisations/o1');
    expect(ROUTES.admin.attributionAg('x')).toBe('/admin/attributions-ag/x');
    expect(ROUTES.traiteur.collecte('1')).toBe('/traiteur/collectes/1');
    expect(ROUTES.agence.collecte('1')).toBe('/agence/collectes/1');
    expect(ROUTES.gestionnaire.collecte('1')).toBe('/gestionnaire/collectes/1');
    expect(ROUTES.gestionnaire.lieu('1')).toBe('/gestionnaire/lieux/1');
    expect(ROUTES.gestionnaire.traiteur('1')).toBe('/gestionnaire/traiteurs/1');
    expect(ROUTES.programmer.brouillon('b')).toBe('/programmer/brouillon/b');
    expect(ROUTES.programmer.ajouterCollecte('e')).toBe(
      '/programmer/e/ajouter-collecte',
    );
    expect(ROUTES.registreCollecte('r')).toBe('/registre/r');
  });
});
