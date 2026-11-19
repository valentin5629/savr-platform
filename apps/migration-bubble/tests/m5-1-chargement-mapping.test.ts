/**
 * M5.1 — chargement des exports Bubble, règles de lecture, rapprochement et
 * mapping des référentiels. Fixtures inventées (cf. fixtures.ts).
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ecrireCsv, lireCsv } from '../src/csv';
import { lireReponse, situerAdresses } from '../src/geocodage';
import { ESPACE_MIGRATION, identifiantCible } from '../src/identifiants';
import { exigerAucunBlocage, lireDecisions } from '../src/importer';
import {
  codePostalVille,
  horodatageParis,
  lireDateBubble,
  lireDecimal,
  lireEmails,
  lireEntier,
  lireOuiNon,
  lireSiren,
  lireSiret,
  normaliserAdresse,
  regionDuCodePostal,
  telephoneE164,
  texteBorne,
} from '../src/normalisation';
import {
  appliquerDecisions,
  decisionsEnBoucle,
  decisionsSansObjet,
  distanceMetres,
  ressemblanceNoms,
} from '../src/rapprochement';
import {
  TMS_BUBBLE_CAMION,
  TMS_BUBBLE_VELO,
  TYPE_TMS_CAMION,
  TYPE_TMS_VELO,
} from '../src/referentiel-tms';
import {
  CATALOGUE,
  ExportInattendu,
  choisirExport,
  garderColonnesUtiles,
} from '../src/sources';
import {
  EMAIL_A_COMPLETER,
  SIREN_A_COMPLETER,
  plageHoraire,
  typesVehicules,
} from '../src/transformations/referentiels';
import {
  EMAIL_COMPTE_SYSTEME,
  NOM_ORGANISATION_SANS_CLIENT,
} from '../src/transformations/organisations';
import {
  agence,
  collecte,
  contact,
  entreprise,
  lieu,
  monde,
  pointDepot,
  seule,
  transporteur,
  utilisateur,
} from './fixtures';

describe('M5.1 / exports — lecture et contrôle du format', () => {
  it('lit un CSV avec BOM, guillemets doublés et retour à la ligne dans une cellule', () => {
    const { colonnes, lignes } = lireCsv(
      '﻿Nom,Note\r\n"Salon ""Delta""","ligne 1\nligne 2"\r\n,\r\nSeul,\r\n',
    );
    expect(colonnes).toEqual(['Nom', 'Note']);
    expect(lignes).toEqual([
      { Nom: 'Salon "Delta"', Note: 'ligne 1\nligne 2' },
      { Nom: 'Seul', Note: '' },
    ]);
  });

  it('écrit un CSV relisible à l’identique', () => {
    const lignes = [{ a: 'x, "y"', b: 'deux\nlignes' }];
    expect(lireCsv(ecrireCsv(['a', 'b'], lignes)).lignes).toEqual(lignes);
  });

  it('retient, parmi les exports complets, le plus récent ; écarte les vues réduites en nommant les colonnes manquantes', () => {
    const colonnes = CATALOGUE.agences.colonnes;
    const { retenu, ecartes } = choisirExport('agences', [
      { fichier: 'export_All-Agences_2026-06-07_18-00-00.csv', colonnes },
      {
        fichier: 'export_All-Agences-modified_2026-06-07_19-46-06.csv',
        colonnes,
      },
      {
        fichier: 'export_All-Agences_2026-06-08_09-00-00.csv',
        colonnes: ['Nom'],
      },
    ]);
    expect(retenu).toBe('export_All-Agences-modified_2026-06-07_19-46-06.csv');
    expect(ecartes).toEqual([
      {
        fichier: 'export_All-Agences_2026-06-08_09-00-00.csv',
        motif: 'colonnes manquantes : Creation Date, unique id',
      },
      {
        fichier: 'export_All-Agences_2026-06-07_18-00-00.csv',
        motif: 'complet mais plus ancien',
      },
    ]);
  });

  it('s’arrête avec un message clair quand aucun export n’a le format attendu', () => {
    expect(() =>
      choisirExport('packs', [
        {
          fichier: 'export_All-Packs_2026-06-07_18-56-12.csv',
          colonnes: ['Type', 'Status'],
        },
      ]),
    ).toThrow(ExportInattendu);
    expect(() =>
      choisirExport('packs', [
        {
          fichier: 'export_All-Packs_2026-06-07_18-56-12.csv',
          colonnes: ['Type', 'Status'],
        },
      ]),
    ).toThrow(
      /colonnes manquantes : Collectes liées, User, Creation Date, unique id/,
    );
    expect(() => choisirExport('packs', [])).toThrow(
      /aucun fichier de ce type/,
    );
  });
});

describe('M5.1 / exports — seules les colonnes utiles sont gardées', () => {
  it('une ligne chargée ne porte que les colonnes du catalogue : ni journal Bubble, ni chauffeur, ni téléphone personnel', () => {
    const [u] = garderColonnesUtiles('utilisateurs', [
      {
        email: 'camille@traiteur-alpha.example',
        Entreprise: 'Traiteur Alpha',
        'unique id': '1700000000000x1',
        'telephone perso': '0600000099',
        Nom: 'Exemple',
        prenom: 'Camille',
      },
    ]);
    expect(u).toEqual({
      email: 'camille@traiteur-alpha.example',
      Entreprise: 'Traiteur Alpha',
      'unique id': '1700000000000x1',
    });
    const [c] = garderColonnesUtiles('collectes_ag', [
      {
        'unique id': '1700000000000x2',
        History: 'journal',
        Chauffeur: 'x',
        Photos: 'y',
        Lieu: 'adresse',
      },
    ]);
    expect(Object.keys(c!).sort()).toEqual(
      [...CATALOGUE.collectes_ag.colonnes].sort(),
    );
    expect(c).not.toHaveProperty('History');
    expect(c).not.toHaveProperty('Chauffeur');
    expect(c!.Lieu).toBe('adresse');
  });
});

describe('M5.1 / règles de lecture des valeurs Bubble', () => {
  it('identifiant cible déterministe : même source, même UUID v5 ; genre ou source différents, UUID différent', () => {
    const a = identifiantCible('collecte', '1700000000000x1');
    expect(a).toBe(identifiantCible('collecte', '1700000000000x1'));
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(a).not.toBe(identifiantCible('evenement', '1700000000000x1'));
    expect(a).not.toBe(identifiantCible('collecte', '1700000000000x2'));
    expect(ESPACE_MIGRATION).toBe('a3b1c5d7-0000-4000-8000-5a7600000001');
  });

  it('date Bubble : heure murale de Paris, midi et minuit compris ; illisible → null', () => {
    expect(lireDateBubble('Oct 14, 2021 12:00 pm')).toEqual({
      jour: '2021-10-14',
      heure: '12:00',
    });
    expect(lireDateBubble('Jun 1, 2023 12:00 am')).toEqual({
      jour: '2023-06-01',
      heure: '00:00',
    });
    expect(lireDateBubble('Sep 2, 2025 2:11 pm')).toEqual({
      jour: '2025-09-02',
      heure: '14:11',
    });
    expect(lireDateBubble('14/10/2021')).toBeNull();
    expect(lireDateBubble('')).toBeNull();
    expect(horodatageParis({ jour: '2021-10-14', heure: '12:00' })).toBe(
      '2021-10-14 12:00:00 Europe/Paris',
    );
  });

  it('nombres : virgule décimale, vide → null (jamais 0 en silence)', () => {
    expect(lireDecimal('31,2')).toBe(31.2);
    expect(lireDecimal(' 12 ')).toBe(12);
    expect(lireDecimal('')).toBeNull();
    expect(lireDecimal('douze')).toBeNull();
    expect(lireEntier('120')).toBe(120);
    expect(lireEntier('12,5')).toBeNull();
    expect(lireOuiNon('oui')).toBe(true);
    expect(lireOuiNon('non')).toBe(false);
    expect(lireOuiNon('')).toBeNull();
  });

  it('téléphone E.164 : premier numéro d’un champ multiple ; illisible → null', () => {
    expect(telephoneE164('06 00 00 00 01')).toBe('+33600000001');
    expect(telephoneE164('0600000001 / 06 00 00 00 09')).toBe('+33600000001');
    expect(telephoneE164('33600000001')).toBe('+33600000001');
    expect(telephoneE164('600000001')).toBe('+33600000001');
    expect(telephoneE164('camion blanc')).toBeNull();
    expect(telephoneE164('0600')).toBeNull();
  });

  it('emails : minuscules, plusieurs adresses séparées, forme invalide écartée', () => {
    expect(lireEmails('A@Asso.example , b@asso.example')).toEqual([
      'a@asso.example',
      'b@asso.example',
    ]);
    expect(lireEmails('pas un email')).toEqual([]);
  });

  it('SIRET 14 chiffres après nettoyage, sinon null ; SIREN 9 chiffres, ou les 9 premiers d’un SIRET', () => {
    expect(lireSiret('111 111 111 00011')).toBe('11111111100011');
    expect(lireSiret('\t11111111100011')).toBe('11111111100011');
    expect(lireSiret('111111111')).toBeNull();
    expect(lireSiret('0')).toBeNull();
    expect(lireSiren('111 111 111')).toBe('111111111');
    expect(lireSiren('11111111100011')).toBe('111111111');
    expect(lireSiren('0')).toBeNull();
  });

  it('adresses : clé de dédoublonnage, code postal et ville, région par département', () => {
    expect(
      normaliserAdresse(' 10 Avenue des Tests,  75008 PARIS, France '),
    ).toBe('10 avenue des tests, 75008 paris');
    expect(normaliserAdresse('Château d’Été, 78000 Versailles.')).toBe(
      'chateau d’ete, 78000 versailles',
    );
    expect(codePostalVille('10 avenue des Tests, 75008 Paris, France')).toEqual(
      {
        codePostal: '75008',
        ville: 'Paris',
      },
    );
    expect(codePostalVille('Paris, France')).toBeNull();
    expect(regionDuCodePostal('93100')).toBe('idf');
    expect(regionDuCodePostal('69002')).toBe('province');
    expect(regionDuCodePostal(null)).toBeNull();
  });

  it('texte borné : longueur tenue, caractères de contrôle retirés, vide → null', () => {
    expect(texteBorne('  Alex\tSurplace\n ', 120)).toBe('Alex Surplace');
    expect(texteBorne('x'.repeat(200), 120)).toHaveLength(120);
    expect(texteBorne('ligne 1\nligne 2', 1000, true)).toBe('ligne 1\nligne 2');
    expect(texteBorne(' \n ', 120)).toBeNull();
  });
});

describe('M5.1 / clients — organisations, entités, domaines', () => {
  it('aucun compte utilisateur migré : seul le compte système existe, sans connexion possible', () => {
    const plan = monde({
      utilisateurs: [
        utilisateur(),
        utilisateur({ email: 'b@traiteur-alpha.example' }),
      ],
    });
    const compte = seule(plan.tables.users);
    expect(compte).toMatchObject({
      email: EMAIL_COMPTE_SYSTEME,
      role: 'admin_savr',
      actif: false,
    });
  });

  it('toute entreprise est importée « traiteur » ; le type proposé par règle n’est appliqué que validé par Val, ou en répétition', () => {
    const lignes = {
      entreprises: [
        entreprise(),
        entreprise({
          'Raison sociale': 'Salon Delta',
          SIRET: '22222222200022',
          'Email de contact': 'x@salon-delta.example',
        }),
      ],
      agences: [agence()],
    };
    const types = (plan: ReturnType<typeof monde>) =>
      Object.fromEntries(plan.tables.organisations.map((o) => [o.nom, o.type]));
    expect(types(monde(lignes))).toMatchObject({
      'Traiteur Alpha': 'traiteur',
      'Salon Delta': 'traiteur',
      'Agence Gamma': 'traiteur',
    });
    const repetition = monde(lignes, { appliquerTypesProposes: true });
    expect(types(repetition)).toMatchObject({
      'Traiteur Alpha': 'traiteur',
      'Salon Delta': 'gestionnaire_lieux',
      'Agence Gamma': 'agence',
    });
    expect(
      repetition.aValider.types.map((t) => [t.nom, t.type_propose, t.regle]),
    ).toEqual(
      expect.arrayContaining([
        ['Traiteur Alpha', 'traiteur', 'défaut'],
        ['Salon Delta', 'gestionnaire_lieux', 'nom identique à un lieu'],
        ['Agence Gamma', 'agence', 'agence Bubble'],
      ]),
    );
    const salon = lignes.entreprises[1]!['unique id']!;
    const decide = monde(lignes, {
      decisions: {
        lieux: new Map(),
        clients: new Map(),
        exclusions: new Map(),
        types: new Map([[salon, 'client_organisateur']]),
      },
    });
    expect(types(decide)['Salon Delta']).toBe('client_organisateur');
  });

  it('une entité de facturation par défaut par entreprise ; SIRET illisible ou déjà pris → vide et listé, jamais de faux numéro', () => {
    const plan = monde({
      entreprises: [
        entreprise(),
        entreprise({
          'Raison sociale': 'Maison Bêta',
          SIRET: '0',
          'Email de contact': 'a@maison-beta.example',
          'Adresse du siège': '',
        }),
        entreprise({
          'Raison sociale': 'Cuisine Thêta',
          SIRET: '111 111 111 00011',
          'Email de contact': 'a@cuisine-theta.example',
          'Creation Date': 'Jan 9, 2023 9:00 am',
        }),
      ],
      agences: [agence()],
    });
    const parNom = Object.fromEntries(
      plan.tables.entites_facturation.map((e) => [e.raison_sociale, e]),
    );
    expect(Object.keys(parNom).sort()).toEqual([
      'Cuisine Thêta',
      'Maison Bêta',
      'Traiteur Alpha',
    ]);
    expect(parNom['Traiteur Alpha']).toMatchObject({
      siret: '11111111100011',
      code_postal: '75011',
      ville: 'Paris',
      pays: 'FR',
      entite_par_defaut: true,
      conditions_paiement_jours: 30,
    });
    expect(parNom['Maison Bêta']).toMatchObject({
      siret: '',
      adresse_facturation: 'À compléter',
      code_postal: '00000',
    });
    expect(parNom['Cuisine Thêta']!.siret).toBe('');
    expect(plan.listings['entites-a-completer']!.map((l) => l.motif)).toEqual([
      'SIRET absent ou illisible',
      'SIRET déjà porté par une autre organisation',
    ]);
  });

  it('domaines email importés comme vérifiés ; domaines publics et Savr exclus ; domaine porté par deux organisations → aucune ligne, listé', () => {
    const plan = monde({
      entreprises: [
        entreprise(),
        entreprise({
          'Raison sociale': 'Maison Bêta',
          SIRET: '22222222200022',
          'Email de contact': 'direction@messagerie-publique.example',
        }),
      ],
      utilisateurs: [
        utilisateur(),
        utilisateur({ email: 'equipe@gosavr.io' }),
        utilisateur({ email: 'chef@groupe-commun.example' }),
        utilisateur({
          email: 'chef2@groupe-commun.example',
          Entreprise: 'Maison Bêta',
        }),
      ],
    });
    const domaine = seule(plan.tables.organisations_domaines_email);
    expect(domaine).toMatchObject({
      domaine: 'traiteur-alpha.example',
      verifie_at: '2026-11-15 20:00:00+00',
    });
    expect(plan.listings['domaines-en-conflit']).toEqual([
      {
        domaine: 'groupe-commun.example',
        organisations: 'Traiteur Alpha | Maison Bêta',
      },
    ]);
  });

  it('rapprochement des clients en trois niveaux : même SIRET et nom proche = auto, même domaine = à revoir, sinon distinct ; la décision de Val prime', () => {
    const alpha = entreprise();
    const alphaBis = entreprise({
      'Raison sociale': 'TRAITEUR ALPHA ',
      'Creation Date': 'Jan 5, 2024 9:00 am',
    });
    const cousin = entreprise({
      'Raison sociale': 'Alpha Réceptions',
      SIRET: '33333333300033',
      'Creation Date': 'Feb 5, 2024 9:00 am',
    });
    const beta = entreprise({
      'Raison sociale': 'Maison Bêta',
      SIRET: '22222222200022',
      'Email de contact': 'a@maison-beta.example',
    });
    const lignes = { entreprises: [alpha, alphaBis, cousin, beta] };
    const plan = monde(lignes);
    const niveaux = Object.fromEntries(
      plan.aValider.clients.map((c) => [
        c.bubble_id,
        [c.niveau, c.groupe_propose],
      ]),
    );
    expect(niveaux[alphaBis['unique id']!]).toEqual([
      'auto',
      alpha['unique id'],
    ]);
    expect(niveaux[cousin['unique id']!]).toEqual([
      'a_revoir',
      alpha['unique id'],
    ]);
    expect(niveaux[beta['unique id']!]).toEqual([
      'distinct',
      beta['unique id'],
    ]);
    expect(plan.tables.organisations.map((o) => o.nom).sort()).toEqual([
      'Alpha Réceptions',
      'Maison Bêta',
      'Savr',
      'Traiteur Alpha',
    ]);
    expect(
      plan.correspondances
        .filter((c) => c.sourceType === 'entreprise' && c.fusionne)
        .map((c) => c.bubbleId),
    ).toEqual([alphaBis['unique id']]);

    const decide = monde(lignes, {
      decisions: {
        lieux: new Map(),
        types: new Map(),
        exclusions: new Map(),
        clients: new Map([
          [cousin['unique id']!, alpha['unique id']!],
          [alphaBis['unique id']!, 'distinct'],
        ]),
      },
    });
    expect(decide.tables.organisations.map((o) => o.nom).sort()).toEqual([
      'Maison Bêta',
      'Savr',
      'TRAITEUR ALPHA',
      'Traiteur Alpha',
    ]);
  });

  it('agences : même nom = une seule organisation, inactive, sans entité de facturation', () => {
    const plan = monde({
      agences: [
        agence(),
        agence({
          Nom: 'agence gamma',
          'Creation Date': 'Feb 2, 2024 10:00 am',
        }),
      ],
    });
    const gamma = seule(
      plan.tables.organisations.filter((o) => o.nom === 'Agence Gamma'),
    );
    expect(gamma).toMatchObject({
      actif: false,
      est_shadow: false,
      raison_sociale: null,
    });
    expect(
      plan.tables.entites_facturation.some(
        (e) => e.organisation_id === gamma.id,
      ),
    ).toBe(false);
  });

  it('organisation active si elle a une collecte dans les 24 derniers mois', () => {
    const lignes = {
      entreprises: [
        entreprise(),
        entreprise({
          'Raison sociale': 'Maison Bêta',
          SIRET: '22222222200022',
          'Email de contact': 'a@maison-beta.example',
        }),
      ],
      collectes_ag: [
        collecte(),
        collecte({
          'User entreprise': 'Maison Bêta',
          'Heure du pickup': 'Nov 14, 2024 11:00 am',
        }),
      ],
    };
    const actif = Object.fromEntries(
      monde(lignes).tables.organisations.map((o) => [o.nom, o.actif]),
    );
    expect(actif).toMatchObject({
      'Traiteur Alpha': true,
      'Maison Bêta': false,
      Savr: true,
    });
  });

  it('données de test : proposées à Val, écartées seulement sur sa décision, collectes du client comprises', () => {
    const test = entreprise({
      'Raison sociale': 'Test Démo',
      SIRET: '44444444400044',
      'Email de contact': 'a@test-demo.example',
    });
    const lignes = {
      entreprises: [entreprise(), test],
      collectes_ag: [collecte({ 'User entreprise': 'Test Démo' })],
    };
    const sans = monde(lignes);
    expect(
      sans.aValider.exclusions.map((e) => [e.source, e.nom, e.exclure]),
    ).toEqual([['entreprise', 'Test Démo', '']]);
    expect(sans.tables.collectes).toHaveLength(1);
    const avec = monde(lignes, {
      decisions: {
        lieux: new Map(),
        clients: new Map(),
        types: new Map(),
        exclusions: new Map([[test['unique id']!, 'oui']]),
      },
    });
    expect(avec.tables.organisations.map((o) => o.nom)).not.toContain(
      'Test Démo',
    );
    expect(avec.tables.collectes).toHaveLength(0);
    expect(avec.rejets.map((r) => [r.sourceType, r.motif])).toEqual([
      ['entreprise', 'écartée par décision (donnée de test)'],
      ['collecte', 'écartée par décision (donnée de test)'],
    ]);
  });

  it('collecte sans client retrouvé : rattachée à une organisation d’accueil inactive, et listée', () => {
    const plan = monde({
      collectes_ag: [
        collecte({
          'User entreprise': 'Inconnu',
          User: 'personne@ailleurs.example',
        }),
      ],
    });
    const accueil = seule(
      plan.tables.organisations.filter(
        (o) => o.nom === NOM_ORGANISATION_SANS_CLIENT,
      ),
    );
    expect(accueil.actif).toBe(false);
    expect(seule(plan.tables.evenements).organisation_id).toBe(accueil.id);
    expect(plan.listings['collectes-sans-client']).toHaveLength(1);
  });
});

describe('M5.1 / références ambiguës — jamais résolues au hasard', () => {
  it('une raison sociale portée par deux organisations non regroupées bloque l’import', () => {
    const plan = monde({
      entreprises: [
        entreprise(),
        entreprise({
          SIRET: '22222222200022',
          'Email de contact': 'a@autre-alpha.example',
        }),
      ],
    });
    expect(plan.aValider.clients.map((c) => c.motif)).toEqual([
      'même nom, SIRET différents',
      'même nom, SIRET différents',
    ]);
    expect(plan.blocages).toEqual([
      '1 raison(s) sociale(s) portée(s) par plusieurs organisations non regroupées : trancher dans clients-a-valider.csv',
    ]);
    expect(monde().blocages).toEqual([]);
  });

  it('un email d’utilisateur rattaché à deux organisations, ou deux associations du même nom, bloquent', () => {
    const plan = monde({
      entreprises: [
        entreprise(),
        entreprise({
          'Raison sociale': 'Maison Bêta',
          SIRET: '22222222200022',
          'Email de contact': 'a@maison-beta.example',
        }),
      ],
      utilisateurs: [utilisateur(), utilisateur({ Entreprise: 'Maison Bêta' })],
      points_depot: [pointDepot(), pointDepot()],
    });
    expect(plan.blocages).toEqual([
      "1 email(s) d'utilisateur Bubble rattaché(s) à plusieurs organisations",
      '1 nom(s) de point de dépôt porté(s) par plusieurs associations',
    ]);
  });

  it('une décision de Val qui désigne une fiche inconnue, ou un type inconnu, bloque au lieu d’être ignorée', () => {
    const alpha = entreprise();
    const plan = monde(
      { entreprises: [alpha] },
      {
        decisions: {
          exclusions: new Map(),
          lieux: new Map([['adresse inconnue', 'distinct']]),
          clients: new Map([[alpha['unique id']!, 'identifiant-mal-recopie']]),
          types: new Map([[alpha['unique id']!, 'traiteurs']]),
        },
      },
    );
    expect(plan.blocages).toEqual([
      `clients-a-valider.csv : 1 décision(s) désignent une fiche inconnue (colonne groupe_decide) : ${alpha['unique id']}`,
      'type_overrides.csv : 1 type(s) validé(s) inconnu(s) (attendu : traiteur, agence, gestionnaire_lieux, client_organisateur)',
      'lieux-a-valider.csv : 1 décision(s) désignent une fiche inconnue (colonne groupe_decide) : adresse inconnue',
    ]);
    expect(
      decisionsSansObjet(
        [{ cle: 'a', niveau: 'distinct', groupePropose: 'a', motif: '' }],
        new Map([
          ['a', 'distinct'],
          ['b', 'a'],
        ]),
      ),
    ).toEqual(['b']);
  });

  it('l’import s’arrête avant toute écriture tant qu’un point reste à trancher', () => {
    const plan = monde();
    expect(() => exigerAucunBlocage(plan)).not.toThrow();
    plan.blocages.push('un point', 'un autre');
    expect(() => exigerAucunBlocage(plan)).toThrow(
      'Import arrêté avant toute écriture — 2 point(s) à trancher :\n  - un point\n  - un autre',
    );
  });
});

describe('M5.1 / décisions de Val — jamais perdues en silence', () => {
  const dossierDecisions = (fichiers: Record<string, string>) => {
    const dossier = mkdtempSync(join(tmpdir(), 'decisions-'));
    for (const [nom, texte] of Object.entries(fichiers))
      writeFileSync(join(dossier, nom), texte);
    return dossier;
  };
  /** Trois clients rapprochés (Alpha et sa copie auto, un cousin à revoir), un client seul. */
  const clientsRapproches = () => {
    const alpha = entreprise();
    const alphaBis = entreprise({
      'Raison sociale': 'TRAITEUR ALPHA ',
      'Creation Date': 'Jan 5, 2024 9:00 am',
    });
    const cousin = entreprise({
      'Raison sociale': 'Alpha Réceptions',
      SIRET: '33333333300033',
      'Creation Date': 'Feb 5, 2024 9:00 am',
    });
    const beta = entreprise({
      'Raison sociale': 'Maison Bêta',
      SIRET: '22222222200022',
      'Email de contact': 'a@maison-beta.example',
    });
    return { alpha, alphaBis, cousin, beta };
  };
  const decisions = (d: {
    clients?: [string, string][];
    types?: [string, string][];
    exclusions?: [string, string][];
  }) => ({
    decisions: {
      lieux: new Map<string, string>(),
      clients: new Map(d.clients ?? []),
      types: new Map(d.types ?? []),
      exclusions: new Map(d.exclusions ?? []),
    },
  });

  it('lit un fichier de décision à points-virgules (Excel en français) comme à virgules', () => {
    const virgule =
      'bubble_id,nom,type_valide\nb-1,"Maison, Bêta",agence\nb-2,Autre,\n';
    const pointVirgule =
      '\ufeffbubble_id;nom;type_valide\r\nb-1;"Maison; Bêta";agence\r\nb-2;Autre;\r\n';
    for (const texte of [virgule, pointVirgule]) {
      const blocages: string[] = [];
      expect(
        lireDecisions(
          dossierDecisions({ 'type_overrides.csv': texte }),
          'type_overrides.csv',
          'bubble_id',
          'type_valide',
          blocages,
        ),
      ).toEqual(new Map([['b-1', 'agence']]));
      expect(blocages).toEqual([]);
    }
  });

  it('colonne de clé ou de décision introuvable, décisions contradictoires, valeur inattendue : blocage qui nomme le fichier, jamais zéro décision en silence', () => {
    const blocages: string[] = [];
    const dossier = dossierDecisions({
      'clients-a-valider.csv': 'bubble_id;groupe decide\nb-1;distinct\n',
      'type_overrides.csv': 'id,type_valide\nb-1,agence\n',
      'lieux-a-valider.csv': 'cle,groupe_decide\nl-1,distinct\nl-1,l-2\nl-3,\n',
      'exclusions.csv': 'bubble_id,exclure\nb-1,Oui\nb-2,non\nb-3,x\n',
    });
    const lire = (f: string, c: string, v: string, permises?: string[]) =>
      lireDecisions(dossier, f, c, v, blocages, permises);
    expect(
      lire('clients-a-valider.csv', 'bubble_id', 'groupe_decide').size,
    ).toBe(0);
    expect(lire('type_overrides.csv', 'bubble_id', 'type_valide').size).toBe(0);
    lire('lieux-a-valider.csv', 'cle', 'groupe_decide');
    expect(
      lire('exclusions.csv', 'bubble_id', 'exclure', ['oui', 'non']),
    ).toEqual(
      new Map([
        ['b-1', 'oui'],
        ['b-2', 'non'],
        ['b-3', 'x'],
      ]),
    );
    // Fichier absent (premier passage) : aucune décision, aucun blocage.
    expect(lire('absent.csv', 'cle', 'groupe_decide').size).toBe(0);
    expect(blocages).toEqual([
      "clients-a-valider.csv : colonne(s) groupe_decide introuvable(s) dans la ligne d'en-tête, aucune décision lue",
      "type_overrides.csv : colonne(s) bubble_id introuvable(s) dans la ligne d'en-tête, aucune décision lue",
      'lieux-a-valider.csv : fiche(s) portant deux décisions différentes (colonne groupe_decide) : l-1',
      'exclusions.csv : valeur(s) inattendue(s) dans exclure (attendu : oui ou non) : b-3',
    ]);
    // Rejoints aux blocages du plan : l'import s'arrête avant toute écriture.
    const plan = monde({}, { blocagesDecisions: blocages });
    expect(plan.blocages).toEqual(blocages);
    expect(() => exigerAucunBlocage(plan)).toThrow(/clients-a-valider\.csv/);
  });

  it('un type validé posé sur une fiche regroupée dans une autre, ou sur une fiche inconnue, bloque en nommant la ligne', () => {
    const { alpha, alphaBis, cousin, beta } = clientsRapproches();
    const id = (l: Record<string, string>) => l['unique id']!;
    const plan = monde(
      { entreprises: [alpha, alphaBis, cousin, beta] },
      decisions({
        types: [
          [id(alpha), 'agence'],
          [id(alphaBis), 'gestionnaire_lieux'],
          ['identifiant-mal-recopie', 'agence'],
        ],
      }),
    );
    expect(plan.blocages).toEqual([
      `type_overrides.csv : 2 type(s) posé(s) ailleurs que sur la fiche qui reçoit le regroupement, à reporter sur celle-ci : ${id(alphaBis)} (regroupée dans ${id(alpha)}), identifiant-mal-recopie (fiche inconnue)`,
    ]);
    // Gardés dans le fichier régénéré, marqués à reporter.
    expect(
      plan.aValider.types
        .filter((t) => t.regle !== 'défaut')
        .map((t) => [t.bubble_id, t.regle, t.type_valide]),
    ).toEqual([
      [
        id(alphaBis),
        `regroupée dans ${id(alpha)} : type à reporter`,
        'gestionnaire_lieux',
      ],
      ['identifiant-mal-recopie', 'fiche inconnue : type à reporter', 'agence'],
    ]);
    // Sur la tête du groupe, le type s'applique sans blocage.
    const juste = monde(
      { entreprises: [alpha, alphaBis, cousin, beta] },
      decisions({ types: [[id(alpha), 'agence']] }),
    );
    expect(juste.blocages).toEqual([]);
    expect(
      juste.tables.organisations.find((o) => o.nom === 'Traiteur Alpha')?.type,
    ).toBe('agence');
  });

  it('deux fiches qui se désignent l’une l’autre, ou une chaîne qui revient sur elle-même, bloquent ; une fiche qui se désigne elle-même reste seule', () => {
    const { alpha, alphaBis, cousin, beta } = clientsRapproches();
    const id = (l: Record<string, string>) => l['unique id']!;
    const entreprises = [alpha, alphaBis, cousin, beta];
    const boucle = monde(
      { entreprises },
      decisions({
        clients: [
          [id(alpha), id(cousin)],
          [id(cousin), id(alpha)],
        ],
      }),
    );
    expect(boucle.blocages).toEqual([
      `clients-a-valider.csv : 1 boucle(s) de fiches qui se désignent l'une l'autre (colonne groupe_decide), aucune ne serait regroupée : ${id(alpha)} → ${id(cousin)}`,
    ]);
    const seuleAlpha = monde(
      { entreprises },
      decisions({ clients: [[id(alpha), id(alpha)]] }),
    );
    expect(seuleAlpha.blocages).toEqual([]);
    expect(
      seuleAlpha.correspondances
        .filter((c) => c.sourceType === 'entreprise' && c.fusionne)
        .map((c) => c.bubbleId),
    ).toEqual([id(alphaBis)]);

    const p = (
      cle: string,
      niveau: 'auto' | 'a_revoir' | 'distinct',
      groupePropose = cle,
    ) => ({
      cle,
      niveau,
      groupePropose,
      motif: '',
    });
    // Chaîne de trois décisions qui revient au départ.
    expect(
      decisionsEnBoucle(
        [p('a', 'a_revoir', 'b'), p('b', 'a_revoir', 'a'), p('c', 'distinct')],
        new Map([
          ['a', 'b'],
          ['b', 'c'],
          ['c', 'a'],
        ]),
      ),
    ).toEqual([['a', 'b', 'c']]);
    // Une décision qui renvoie une fiche vers celle qui la rejoint d'office.
    expect(
      decisionsEnBoucle(
        [p('a', 'auto', 'b'), p('b', 'a_revoir', 'a')],
        new Map([['b', 'a']]),
      ),
    ).toEqual([['a', 'b']]);
    expect(
      decisionsEnBoucle(
        [p('a', 'auto', 'b'), p('b', 'a_revoir', 'a')],
        new Map([['a', 'a']]),
      ),
    ).toEqual([]);
  });

  it('fichiers à valider rangés par dossier : D001…, fiches du dossier, ce qu’il y a à faire, à décider d’abord puis par nom sans accents', () => {
    const { alpha, alphaBis, cousin, beta } = clientsRapproches();
    const etoile = entreprise({
      'Raison sociale': 'Étoile Nord',
      SIRET: '55555555500055',
      'Email de contact': 'a@etoile-nord.example',
    });
    const plan = monde({
      entreprises: [beta, etoile, alpha, alphaBis, cousin],
      agences: [agence(), agence({ Nom: 'agence gamma' })],
    });
    expect(Object.keys(plan.aValider.clients[0]!).slice(0, 4)).toEqual([
      'dossier',
      'fiches_dossier',
      'a_faire',
      'bubble_id',
    ]);
    expect(
      plan.aValider.clients.map((c) => [
        c.dossier,
        c.fiches_dossier,
        c.a_faire,
        c.nom,
        c.niveau,
      ]),
    ).toEqual([
      ['D001', 3, 'à décider', 'Alpha Réceptions', 'a_revoir'],
      ['D001', 3, 'à décider', 'Traiteur Alpha', 'a_revoir'],
      ['D001', 3, 'à décider', 'TRAITEUR ALPHA', 'auto'],
      ['D002', 2, 'fusion d’office, à vérifier', 'Agence Gamma', 'distinct'],
      ['D002', 2, 'fusion d’office, à vérifier', 'agence gamma', 'auto'],
      ['D003', 1, 'rien à faire', 'Étoile Nord', 'distinct'],
      ['D004', 1, 'rien à faire', 'Maison Bêta', 'distinct'],
    ]);
    // Même forme pour les lieux.
    expect(Object.keys(plan.aValider.lieux[0]!).slice(0, 4)).toEqual([
      'dossier',
      'fiches_dossier',
      'a_faire',
      'cle',
    ]);
  });

  it('une relance reporte les décisions déjà lues dans les fichiers régénérés, même celles qui bloquent', () => {
    const { alpha, alphaBis, cousin, beta } = clientsRapproches();
    const test = entreprise({
      'Raison sociale': 'Test Démo',
      SIRET: '44444444400044',
      'Email de contact': 'a@test-demo.example',
    });
    const id = (l: Record<string, string>) => l['unique id']!;
    const plan = monde(
      {
        entreprises: [alpha, alphaBis, cousin, beta, test],
        collectes_ag: [collecte({ 'Nom du client': 'Client de test' })],
      },
      decisions({
        clients: [[id(cousin), 'distinct']],
        types: [[id(beta), 'traiteurs']],
        exclusions: [[id(test), 'non']],
      }),
    );
    const client = (l: Record<string, string>) =>
      plan.aValider.clients.find((c) => c.bubble_id === id(l));
    expect(client(cousin)?.groupe_decide).toBe('distinct');
    expect(
      plan.aValider.types.find((t) => t.bubble_id === id(beta))?.type_valide,
    ).toBe('traiteurs');
    expect(
      plan.aValider.exclusions.map((e) => [e.source, e.nom, e.exclure]),
    ).toEqual([
      ['entreprise', 'Test Démo', 'non'],
      ['collecte', 'Client de test', ''],
    ]);
    expect(plan.tables.organisations.map((o) => o.nom)).toContain('Test Démo');
  });
});

describe('M5.1 / lieux — référentiel initié par la migration', () => {
  it('même adresse normalisée = un seul lieu : nom le plus fréquent, autre nom en alternatif, consignes réunies, contrôle d’accès si une fiche l’exige', () => {
    const plan = monde({
      lieux: [
        lieu({ 'Creation Date': 'Mar 1, 2023 8:00 am' }),
        lieu({
          adresse: '10 Avenue des Tests, 75008 PARIS',
          'Nom du lieu': 'Salon Delta',
          'instruction du lieu': 'Sonner au 2',
          'Creation Date': 'Mar 1, 2021 8:00 am',
        }),
        lieu({
          'Nom du lieu': 'Le Delta',
          "besoin de la plaque d'immatriculation": 'oui',
          Entreprise: 'Inconnue',
        }),
      ],
    });
    const l = seule(plan.tables.lieux);
    expect(l).toMatchObject({
      nom: 'Salon Delta',
      nom_alternatif: 'Le Delta',
      adresse_acces: '10 Avenue des Tests, 75008 PARIS',
      code_postal: '75008',
      ville: 'PARIS',
      region: 'idf',
      acces_details: 'Sonner au 2\n---\nEntrée par la cour',
      controle_acces_requis_default: true,
      created_at: '2021-03-01 08:00:00 Europe/Paris',
    });
    expect(l.id).toBe(
      identifiantCible('lieu', '10 avenue des tests, 75008 paris'),
    );
    // Traiteurs opérant : ceux des fiches du lieu ; une entreprise inconnue n'en ajoute pas.
    expect(l.traiteurs_operant).toEqual([
      seule(plan.tables.organisations.filter((o) => o.nom === 'Traiteur Alpha'))
        .id,
    ]);
    expect(
      plan.correspondances
        .filter((c) => c.table === 'lieux')
        .map((c) => c.fusionne),
    ).toEqual([false, true, true]);
  });

  it('colonnes sans source Bubble : véhicule maximal « poids_lourd », stationnement et accès office non écrits (NULL)', () => {
    const l = seule(monde().tables.lieux);
    expect(l.type_vehicule_max).toBe('poids_lourd');
    expect(l).not.toHaveProperty('stationnement');
    expect(l).not.toHaveProperty('acces_office');
  });

  it('2e passe : une adresse de collecte absente du référentiel crée un lieu, nommé d’après la collecte', () => {
    const plan = monde({
      collectes_ag: [
        collecte({
          Lieu: '5 quai des Fixtures, 69002 Lyon',
          'Nom du lieu': 'Pavillon Iota',
          "besoin de l'immatriculation": 'oui',
        }),
      ],
    });
    const iota = seule(
      plan.tables.lieux.filter((l) => l.nom === 'Pavillon Iota'),
    );
    expect(iota).toMatchObject({
      region: 'province',
      ville: 'Lyon',
      controle_acces_requis_default: true,
      actif: true,
    });
    expect(seule(plan.tables.evenements).lieu_id).toBe(iota.id);
    expect(
      seule(plan.tables.lieux.filter((l) => l.nom === 'Salon Delta')).actif,
    ).toBe(false);
  });

  it('rapprochement en trois niveaux : même position et noms proches = auto ; même position, noms différents = à revoir ; même nom ailleurs = à revoir', () => {
    const point = (latitude: number, longitude: number) => ({
      latitude,
      longitude,
      score: 0.9,
      precis: true,
      codePostal: '75008',
      ville: 'Paris',
    });
    const a = '10 avenue des tests, 75008 paris';
    const b = '10 av des tests paris 8';
    const c = '12 avenue des tests, 75008 paris';
    const d = '99 boulevard lointain, 13001 marseille';
    const lignes = {
      lieux: [
        lieu(),
        lieu({
          adresse: '10 av des Tests Paris 8',
          'Nom du lieu': 'Salon Delta Paris',
          'Creation Date': 'Mar 3, 2022 8:00 am',
        }),
        lieu({
          adresse: '12 avenue des Tests, 75008 Paris',
          'Nom du lieu': 'Hôtel Kappa',
          'Creation Date': 'Mar 4, 2022 8:00 am',
        }),
        lieu({
          adresse: '99 boulevard Lointain, 13001 Marseille',
          'Nom du lieu': 'Salon Delta',
          'Creation Date': 'Mar 5, 2022 8:00 am',
        }),
      ],
    };
    const geocodes = new Map([
      [a, point(48.87, 2.31)],
      [b, point(48.87005, 2.31005)],
      [c, point(48.8701, 2.3101)],
      [d, { ...point(43.3, 5.37), codePostal: '13001', ville: 'Marseille' }],
    ]);
    const plan = monde(lignes, { geocodes });
    const niveaux = Object.fromEntries(
      plan.aValider.lieux.map((l) => [l.cle, [l.niveau, l.groupe_propose]]),
    );
    expect(niveaux[b]).toEqual(['auto', a]);
    expect(niveaux[c]).toEqual(['a_revoir', a]);
    expect(niveaux[d]).toEqual(['a_revoir', a]);
    expect(plan.tables.lieux.map((l) => l.nom).sort()).toEqual([
      'Hôtel Kappa',
      'Salon Delta',
      'Salon Delta',
    ]);
    expect(
      seule(plan.tables.lieux.filter((l) => l.ville === 'Marseille')),
    ).toMatchObject({ latitude: 43.3, longitude: 5.37, region: 'province' });

    const decide = monde(lignes, {
      geocodes,
      decisions: {
        clients: new Map(),
        types: new Map(),
        exclusions: new Map(),
        lieux: new Map([
          [c, a],
          [b, 'distinct'],
        ]),
      },
    });
    expect(decide.tables.lieux.map((l) => l.nom).sort()).toEqual([
      'Salon Delta',
      'Salon Delta',
      'Salon Delta Paris',
    ]);
  });

  it('lieu non situé par le service d’adresses : position vide, listé à compléter', () => {
    const plan = monde(
      { lieux: [lieu({ adresse: 'Paris, France' })] },
      { geocodes: new Map([['paris', null]]) },
    );
    expect(seule(plan.tables.lieux)).toMatchObject({
      latitude: null,
      longitude: null,
      code_postal: '00000',
      ville: 'À compléter',
    });
    expect(seule(plan.listings['lieux-a-completer']!).manque).toBe(
      'position, code postal, ville',
    );
  });

  it('outils : ressemblance des noms, distance, décisions en chaîne', () => {
    expect(ressemblanceNoms('Salon Delta', 'SALON  DELTA')).toBe(1);
    expect(ressemblanceNoms('Salon Delta', 'Hôtel Kappa')).toBeLessThan(0.3);
    expect(ressemblanceNoms('', 'Salon')).toBe(0);
    expect(
      distanceMetres(
        { latitude: 48.87, longitude: 2.31 },
        { latitude: 48.87, longitude: 2.31 },
      ),
    ).toBe(0);
    expect(
      Math.round(
        distanceMetres(
          { latitude: 48.87, longitude: 2.31 },
          { latitude: 48.871, longitude: 2.31 },
        ),
      ),
    ).toBe(111);
    const groupes = appliquerDecisions(
      [
        { cle: 'a', niveau: 'distinct', groupePropose: 'a', motif: '' },
        { cle: 'b', niveau: 'auto', groupePropose: 'a', motif: '' },
        { cle: 'c', niveau: 'a_revoir', groupePropose: 'a', motif: '' },
        { cle: 'd', niveau: 'distinct', groupePropose: 'd', motif: '' },
      ],
      new Map([
        ['d', 'c'],
        ['c', 'b'],
        ['a', 'inconnue'],
      ]),
    );
    expect(Object.fromEntries(groupes)).toEqual({
      a: 'a',
      b: 'a',
      c: 'a',
      d: 'a',
    });
  });
});

describe('M5.1 / service d’adresses', () => {
  const reponse = {
    features: [
      {
        geometry: { coordinates: [2.31, 48.87] },
        properties: {
          score: 0.91,
          type: 'housenumber',
          postcode: '75008',
          city: 'Paris',
        },
      },
    ],
  };

  it('lit la réponse : position, confiance, précision au numéro ; réponse vide → null', () => {
    expect(lireReponse(reponse)).toEqual({
      latitude: 48.87,
      longitude: 2.31,
      score: 0.91,
      precis: true,
      codePostal: '75008',
      ville: 'Paris',
    });
    expect(lireReponse({ features: [] })).toBeNull();
  });

  it('n’envoie que l’adresse du lieu, garde chaque réponse en cache, ne rappelle pas le service au passage suivant', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const fichierCache = join(
      mkdtempSync(join(tmpdir(), 'cache-adresses-')),
      'adresses.json',
    );
    const appels: string[] = [];
    const recuperer = async (url: string) => {
      appels.push(url);
      if (url.includes('panne'))
        return { ok: false, status: 503, json: async () => ({}) };
      return {
        ok: true,
        status: 200,
        json: async () =>
          url.includes('introuvable') ? { features: [] } : reponse,
      };
    };
    const adresses = new Map([
      ['10 avenue des tests, 75008 paris', '10 avenue des Tests, 75008 Paris'],
      ['lieu introuvable', 'Lieu introuvable'],
      ['adresse en panne', 'Adresse en panne'],
    ]);
    const premier = await situerAdresses(adresses, {
      fichierCache,
      appeler: true,
      recuperer,
    });
    expect(premier).toMatchObject({ appels: 3, echecs: 1, duCache: 0 });
    expect(premier.geocodes.get('lieu introuvable')).toBeNull();
    expect(premier.geocodes.has('adresse en panne')).toBe(false);
    expect(appels[0]).toBe(
      'https://data.geopf.fr/geocodage/search?q=10+avenue+des+Tests%2C+75008+Paris&limit=1&index=address',
    );
    const second = await situerAdresses(adresses, {
      fichierCache,
      appeler: true,
      recuperer,
    });
    expect(second).toMatchObject({ appels: 1, echecs: 1, duCache: 2 });
    const sansAppel = await situerAdresses(adresses, {
      fichierCache,
      appeler: false,
      recuperer,
    });
    expect(sansAppel.appels).toBe(0);
    expect(appels).toHaveLength(4);
  });
});

describe('M5.1 / référentiels — associations, transporteurs, contacts', () => {
  it('associations : seuls les points de dépôt « NOURRITURE » ; préfixe de zone retiré ; horaires en heures ; jamais habilitée par défaut', () => {
    const plan = monde({
      points_depot: [
        pointDepot({
          Lundi: '[480,1260]',
          Mardi: '[0,0]',
          Mercredi: '[]',
          SIREN: '111 111 111',
          Nb_bénéficiaires: '80',
          description_pour_rapport_impact: 'trop court',
          Logo: '//cdn.example/logo.png',
        }),
        pointDepot({ Nom: 'Exutoire Lambda', Type: 'DECHET' }),
        pointDepot({ Nom: 'Sans type', Type: '' }),
      ],
      collectes_ag: [
        collecte({ 'Point de dépot': 'PARIS / Association Epsilon' }),
      ],
    });
    const asso = seule(plan.tables.associations);
    expect(asso).toMatchObject({
      nom: 'Association Epsilon',
      region: 'idf',
      ville: 'Paris',
      horaires_ouverture: { lundi: ['08:00', '21:00'] },
      contact_email: 'accueil@asso-epsilon.example',
      habilitee_attestation_fiscale: false,
      siren: '111111111',
      capacite_max_beneficiaires: 80,
      logo_url: null,
      latitude: null,
      description_rapport_impact:
        'Description à compléter — association Association Epsilon.',
      commentaires_internes: 'Zone Bubble : PARIS',
      actif: true,
    });
    expect(
      (asso.description_rapport_impact as string).length,
    ).toBeGreaterThanOrEqual(30);
    expect(plan.rejets.map((r) => r.motif)).toEqual([
      'type « DECHET » : pas une association',
      'type « vide » : pas une association',
    ]);
    expect(plageHoraire('[540,1080]')).toEqual(['09:00', '18:00']);
    expect(plageHoraire('[0,0]')).toBeNull();
  });

  it('association sans email : adresse à compléter posée et listée ; inactive sans collecte récente', () => {
    const plan = monde({
      points_depot: [pointDepot({ mailing_list: '', Adresse: '' })],
    });
    expect(seule(plan.tables.associations)).toMatchObject({
      contact_email: EMAIL_A_COMPLETER,
      adresse: 'À compléter',
      ville: 'À compléter',
      actif: false,
    });
    expect(seule(plan.listings['associations-a-completer']!).manque).toContain(
      'email de contact',
    );
  });

  it('transporteurs : champs sans source posés à compléter et listés ; véhicules et logiciel de transport normalisés ; types de collecte déduits des collectes', () => {
    const velo = transporteur({
      TmsType: TMS_BUBBLE_VELO,
      process: 'Appeler la veille',
    });
    const camion = transporteur({
      Nom: 'Frigo Mu',
      'Véhicules utilisés': 'Camion frigorifique',
      TmsType: TMS_BUBBLE_CAMION,
      'Mail de contact': '',
      'Numéro de contact': '',
      'Nom de contact': '',
    });
    const autre = transporteur({
      Nom: 'LYON / Livreurs Nu',
      'Véhicules utilisés': '',
    });
    const plan = monde({
      transporteurs: [velo, camion, autre],
      collectes_ag: [collecte({ Transporteur: velo['unique id']! })],
      collectes_zd: [
        collecte({ Type: 'DECHET', Transporteur: velo['unique id']! }),
      ],
    });
    const parNom = Object.fromEntries(
      plan.tables.transporteurs.map((t) => [t.nom, t]),
    );
    expect(parNom['Coursiers Zêta']).toMatchObject({
      siren: SIREN_A_COMPLETER,
      type_tms: TYPE_TMS_VELO,
      types_vehicules: ['velo_cargo'],
      types_collecte: ['anti_gaspi', 'zero_dechet'],
      contact_telephone: '+33600000001',
      description_process_collecte: 'Appeler la veille',
      commentaires_internes: 'Zone Bubble : IDF',
      actif: true,
    });
    expect(parNom['Frigo Mu']).toMatchObject({
      type_tms: TYPE_TMS_CAMION,
      types_vehicules: ['vul'],
      contact_nom: 'À compléter',
      contact_email: EMAIL_A_COMPLETER,
      contact_telephone: '-',
      types_collecte: null,
      actif: false,
    });
    expect(parNom['Livreurs Nu']).toMatchObject({
      type_tms: 'autre',
      types_vehicules: ['vul'],
    });
    expect(
      plan.tables.transporteurs.every(
        (t) => !('prestataire_logistique_id' in t),
      ),
    ).toBe(true);
    expect(typesVehicules('Vélo cargo et camionnette')).toEqual([
      'camionnette',
      'velo_cargo',
    ]);
    expect(typesVehicules('trottinette')).toBeNull();
  });

  it('contacts du carnet : dédoublonnés par organisation et téléphone puis par nom ; téléphone illisible ou entreprise inconnue = rejet ; plus de 5 ans sans usage = non repris', () => {
    const plan = monde({
      contacts: [
        contact(),
        contact({
          Numero: '06 00 00 00 02',
          'Creation Date': 'Jun 1, 2025 8:00 am',
        }),
        contact({
          Numero: '0600000003',
          'Creation Date': 'Jul 1, 2025 8:00 am',
        }),
        contact({ PrenomNom: 'Morgan', Numero: '0600000004' }),
        contact({ PrenomNom: 'Sans Numéro', Numero: 'xx' }),
        contact({
          PrenomNom: 'Sans Société',
          Numero: '0600000005',
          'Entreprise liée': 'Inconnue',
        }),
        contact({
          PrenomNom: 'Ancien Contact',
          Numero: '0600000006',
          'Creation Date': 'Nov 14, 2021 8:00 am',
        }),
      ],
    });
    const parNom = Object.fromEntries(
      plan.tables.contacts_traiteurs.map((c) => [c.nom, c]),
    );
    expect(Object.keys(parNom).sort()).toEqual(['Exemple', 'Morgan']);
    expect(parNom['Exemple']).toMatchObject({
      prenom: 'Sacha',
      telephone: '+33600000003',
      utilise_nb_fois: 3,
      created_at: '2025-05-01 08:00:00 Europe/Paris',
      derniere_utilisation: '2025-07-01 08:00:00 Europe/Paris',
    });
    expect(parNom['Morgan']).toMatchObject({
      prenom: '—',
      telephone: '+33600000004',
    });
    expect(plan.rejets.map((r) => r.motif).sort()).toEqual([
      'dernier usage de plus de 5 ans',
      'entreprise non retrouvée',
      'téléphone illisible',
    ]);
  });
});
