/**
 * Jeux de données INVENTÉS pour les tests : même forme que les exports Bubble,
 * aucune valeur réelle (le dépôt est public). Identifiants, noms, adresses,
 * emails, téléphones et SIRET sont fabriqués.
 */
import type { Ligne } from '../src/csv';
import { construirePlan } from '../src/construire-plan';
import type { Contexte, Plan } from '../src/plan';
import { CATALOGUE, type Sources, type TypeSource } from '../src/sources';

export const JOUR = '2026-11-15';

let compteur = 0;
/** Identifiant de la forme Bubble (`<13 chiffres>x<18 chiffres>`), inventé. */
export function idBubble(): string {
  compteur++;
  return `1700000000000x${String(compteur).padStart(18, '0')}`;
}

function ligne(type: TypeSource, valeurs: Ligne): Ligne {
  return {
    ...Object.fromEntries(CATALOGUE[type].colonnes.map((c) => [c, ''])),
    'unique id': idBubble(),
    ...valeurs,
  };
}

export const entreprise = (v: Ligne = {}) =>
  ligne('entreprises', {
    'Raison sociale': 'Traiteur Alpha',
    'Email de contact': 'contact@traiteur-alpha.example',
    SIRET: '11111111100011',
    'Adresse du siège': '1 rue des Essais, 75011 Paris, France',
    Identifiant: 'ALP',
    'Creation Date': 'Jan 5, 2022 9:00 am',
    'Modified Date': 'Jan 6, 2022 9:00 am',
    ...v,
  });

export const agence = (v: Ligne = {}) =>
  ligne('agences', {
    Nom: 'Agence Gamma',
    'Creation Date': 'Feb 1, 2023 10:00 am',
    ...v,
  });

export const utilisateur = (v: Ligne = {}) =>
  ligne('utilisateurs', {
    email: 'camille@traiteur-alpha.example',
    Entreprise: 'Traiteur Alpha',
    ...v,
  });

export const lieu = (v: Ligne = {}) =>
  ligne('lieux', {
    adresse: '10 avenue des Tests, 75008 Paris, France',
    'Nom du lieu': 'Salon Delta',
    'instruction du lieu': 'Entrée par la cour',
    "besoin de la plaque d'immatriculation": 'non',
    Entreprise: 'Traiteur Alpha',
    'Creation Date': 'Mar 1, 2022 8:00 am',
    'Modified Date': 'Mar 2, 2022 8:00 am',
    ...v,
  });

export const pointDepot = (v: Ligne = {}) =>
  ligne('points_depot', {
    Nom: 'PARIS / Association Epsilon',
    Type: 'NOURRITURE',
    Adresse: '3 rue du Partage, 75019 Paris, France',
    mailing_list: 'accueil@asso-epsilon.example',
    'Creation Date': 'Apr 1, 2022 8:00 am',
    ...v,
  });

export const transporteur = (v: Ligne = {}) =>
  ligne('transporteurs', {
    Nom: 'IDF / Coursiers Zêta',
    'Véhicules utilisés': 'Vélo cargo',
    'Nom de contact': 'Dominique Essai',
    'Mail de contact': 'contact@coursiers-zeta.example',
    'Numéro de contact': '06 00 00 00 01',
    'Creation Date': 'Apr 2, 2022 8:00 am',
    ...v,
  });

export const contact = (v: Ligne = {}) =>
  ligne('contacts', {
    PrenomNom: 'Sacha Exemple',
    Numero: '0600000002',
    'Entreprise liée': 'Traiteur Alpha',
    'Creation Date': 'May 1, 2025 8:00 am',
    ...v,
  });

export const pack = (v: Ligne = {}) =>
  ligne('packs', {
    Type: '10',
    Status: 'Actif',
    User: 'camille@traiteur-alpha.example',
    'Creation Date': 'Jan 10, 2026 8:00 am',
    ...v,
  });

export const abonnement = (v: Ligne = {}) =>
  ligne('abonnements', {
    'Date début': 'Jun 1, 2023 12:00 am',
    'Date fin': 'May 31, 2024 12:00 am',
    en_cours: 'non',
    'Nombre de collectes': '30',
    User: 'camille@traiteur-alpha.example',
    ...v,
  });

export const poids = (v: Ligne = {}) => ligne('poids_zd', v);

export const collecte = (v: Ligne = {}) =>
  ligne(
    (v.Type ?? 'NOURRITURE') === 'DECHET' ? 'collectes_zd' : 'collectes_ag',
    {
      Type: 'NOURRITURE',
      Statut: 'Terminée',
      'Heure du pickup': 'Jun 14, 2026 11:30 pm',
      Lieu: '10 avenue des Tests, 75008 Paris, France',
      'Nom du lieu': 'Salon Delta',
      'Nom du client': 'Client Oméga',
      'User entreprise': 'Traiteur Alpha',
      User: 'camille@traiteur-alpha.example',
      'Contact 1': 'Alex Surplace',
      'Contact 2': 'Charlie Secours',
      'Nombre de convives': '120',
      "Pas d'excédents": 'non',
      Identifiant: '#1406ALP2330',
      'Creation Date': 'Jun 1, 2026 9:00 am',
      'Modified Date': 'Jun 15, 2026 9:00 am',
      ...v,
    },
  );

export function sources(lignes: Partial<Record<TypeSource, Ligne[]>>): Sources {
  return Object.fromEntries(
    (Object.keys(CATALOGUE) as TypeSource[]).map((type) => [
      type,
      {
        fichier: `export_${type}.csv`,
        colonnes: CATALOGUE[type].colonnes,
        lignes: lignes[type] ?? [],
        ecartes: [],
      },
    ]),
  ) as unknown as Sources;
}

export function contexte(v: Partial<Contexte> = {}): Contexte {
  return {
    jourReference: JOUR,
    instantImport: '2026-11-15 20:00:00+00',
    domainesExclus: new Set(['messagerie-publique.example', 'gosavr.io']),
    geocodes: new Map(),
    decisions: {
      lieux: new Map(),
      clients: new Map(),
      types: new Map(),
      exclusions: new Set(),
    },
    appliquerTypesProposes: false,
    typeEvenementAutreId: '00000000-0000-4000-8000-0000000000a0',
    fluxParCode: {
      biodechet: '00000000-0000-4000-8000-0000000000f1',
      carton: '00000000-0000-4000-8000-0000000000f2',
      dechet_residuel: '00000000-0000-4000-8000-0000000000f3',
      emballage: '00000000-0000-4000-8000-0000000000f4',
      verre: '00000000-0000-4000-8000-0000000000f5',
    },
    poidsParRepasKg: 0.45,
    organisationSavrId: null,
    ...v,
  };
}

/** Un petit monde cohérent : un traiteur, un lieu, une association, un transporteur. */
export function monde(
  lignes: Partial<Record<TypeSource, Ligne[]>> = {},
  ctx: Partial<Contexte> = {},
): Plan {
  return construirePlan(
    sources({
      entreprises: [entreprise()],
      utilisateurs: [utilisateur()],
      lieux: [lieu()],
      points_depot: [pointDepot()],
      ...lignes,
    }),
    contexte(ctx),
  );
}

/** Position inventée du lieu des fixtures : sans elle, toute collecte est « historique partiel ». */
export const LIEU_SITUE = new Map([
  [
    '10 avenue des tests, 75008 paris',
    {
      latitude: 48.87,
      longitude: 2.31,
      score: 0.9,
      precis: true,
      codePostal: '75008',
      ville: 'Paris',
    },
  ],
]);

export const seule = <T>(lignes: T[]): T => {
  if (lignes.length !== 1)
    throw new Error(`Une ligne attendue, ${lignes.length} trouvée(s).`);
  return lignes[0]!;
};
