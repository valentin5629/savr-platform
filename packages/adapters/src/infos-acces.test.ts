// Agrégation des informations d'accès dans le champ libre transmis au
// transporteur (arbitrage Val 2026-09-15, divergence M1.5).
//
// Ces tests portent sur le FORMAT et les bornes. Le câblage (les 6 champs
// arrivent bien dans le payload sortant des DEUX adapters, depuis le lieu
// FUSIONNÉ) est vérifié de bout en bout dans outbox-worker.m2-3.test.ts,
// mts1/adapter.m1-5a.test.ts et everest/adapter.m2-5.test.ts.

import { describe, expect, it } from 'vitest';

import type { Lieu } from './index.js';
import {
  LIMITE_INFOS_SUPPLEMENTAIRES,
  composerInformationsSupplementaires,
} from './infos-acces.js';

const LIEU_NU: Lieu = {
  id: 'lieu-001',
  nom: 'Salle Pleyel',
  adresse_acces: '252 rue du Faubourg Saint-Honoré',
  code_postal: '75008',
  ville: 'Paris',
  acces_details: null,
  type_vehicule_max: '',
  contraintes_horaires: null,
  stationnement: null,
  acces_office: null,
  flux_autorises: null,
};

const LIEU_COMPLET: Lieu = {
  ...LIEU_NU,
  acces_details: 'Quai n°2, sonner interphone B',
  stationnement: 'difficile',
  contraintes_horaires: 'Livraison avant 9h uniquement',
  acces_office: 'tres_difficile',
  type_vehicule_max: 'camionnette',
  flux_autorises: ['biodéchets', 'carton'],
};

describe('infos-acces / composition du champ libre', () => {
  it('les 6 informations d’accès sortent en clair, une par ligne', () => {
    const texte = composerInformationsSupplementaires(LIEU_COMPLET, null, null);

    expect(texte).toBe(
      [
        'Accès : Quai n°2, sonner interphone B',
        'Stationnement : difficile',
        'Contraintes horaires : Livraison avant 9h uniquement',
        'Accès office : très difficile',
        'Véhicule max : camionnette',
        'Flux acceptés : biodéchets, carton',
      ].join('\n'),
    );
  });

  // Les enums DB ne sont pas destinés à être lus sur un téléphone à 22 h.
  it('les enums sont traduits en libellés lisibles par un chauffeur', () => {
    const texte = composerInformationsSupplementaires(
      { ...LIEU_NU, stationnement: 'tres_difficile' },
      null,
      null,
    );
    expect(texte).toBe('Stationnement : très difficile');
    expect(texte).not.toContain('tres_difficile');
  });

  // Une valeur inconnue (enum étendu en base, seed ancien) doit rester visible
  // plutôt que de faire disparaître l'information du chauffeur.
  it('une valeur d’enum inconnue est transmise brute, jamais perdue', () => {
    const texte = composerInformationsSupplementaires(
      { ...LIEU_NU, type_vehicule_max: 'camion_20m3' },
      null,
      null,
    );
    expect(texte).toBe('Véhicule max : camion_20m3');
  });

  it('un champ vide n’ajoute aucune ligne — pas de « Stationnement : » orphelin', () => {
    const texte = composerInformationsSupplementaires(
      {
        ...LIEU_NU,
        acces_details: '   ',
        stationnement: '',
        type_vehicule_max: 'fourgon',
        flux_autorises: ['', '  '],
      },
      null,
      null,
    );

    expect(texte).toBe('Véhicule max : fourgon');
    expect(texte).not.toContain('Stationnement');
    expect(texte).not.toContain('Accès :');
    expect(texte).not.toContain('Flux acceptés');
  });

  it('aucune information du tout → null (ni comment MTS-1 ni notes Everest)', () => {
    expect(composerInformationsSupplementaires(LIEU_NU, null, null)).toBeNull();
    expect(
      composerInformationsSupplementaires(LIEU_NU, '   ', null),
    ).toBeNull();
  });

  it('la saisie du traiteur est conservée, en tête — l’agrégat s’y ajoute', () => {
    const texte = composerInformationsSupplementaires(
      LIEU_COMPLET,
      'Demander Karim à la plonge',
      null,
    );

    expect(texte).toContain('Demander Karim à la plonge');
    expect(texte!.startsWith('Demander Karim à la plonge\n')).toBe(true);
    expect(texte).toContain('Accès : Quai n°2, sonner interphone B');
  });

  it('saisie traiteur seule (lieu sans info d’accès) → transmise inchangée', () => {
    expect(
      composerInformationsSupplementaires(LIEU_NU, 'Sonner interphone B', null),
    ).toBe('Sonner interphone B');
  });

  // `lieu_overrides` est un jsonb libre dont la validation d'entrée côté routes
  // est un lot distinct : un override `{"stationnement":{"$ne":1}}` ne doit pas
  // produire « Stationnement : [object Object] » chez le transporteur.
  it('une valeur non textuelle est ignorée, jamais interpolée', () => {
    const texte = composerInformationsSupplementaires(
      {
        ...LIEU_NU,
        stationnement: { $ne: 1 } as unknown as string,
        acces_details: { toString: () => 'injecté' } as unknown as string,
        contraintes_horaires: 42 as unknown as string,
        flux_autorises: 'biodéchets' as unknown as string[],
        type_vehicule_max: 'vul',
      },
      null,
      null,
    );

    expect(texte).toBe('Véhicule max : VUL');
    expect(texte).not.toContain('[object Object]');
    expect(texte).not.toContain('injecté');
    expect(texte).not.toContain('42');
  });

  // Aucune longueur maximale n'est documentée sur `comment` (MTS-1) ni `notes`
  // (Everest) : la borne retenue est celle de la source, §08 E1 (max 1000 car.).
  // Une coupe silencieuse chez le tiers emporterait l'information la plus utile.
  it('la borne du canal libre est respectée', () => {
    const texte = composerInformationsSupplementaires(
      LIEU_COMPLET,
      'x'.repeat(LIMITE_INFOS_SUPPLEMENTAIRES),
      null,
    );
    expect(texte!.length).toBeLessThanOrEqual(LIMITE_INFOS_SUPPLEMENTAIRES);
  });

  it('la troncature abandonne les lignes les MOINS prioritaires et se signale', () => {
    // Budget juste suffisant pour les 3 lignes prioritaires (accès,
    // stationnement, horaires) + le marqueur, pas pour les 3 suivantes.
    const prioritaires = [
      'Accès : Quai n°2, sonner interphone B',
      'Stationnement : difficile',
      'Contraintes horaires : Livraison avant 9h uniquement',
    ].join('\n');
    const base = 'y'.repeat(
      LIMITE_INFOS_SUPPLEMENTAIRES - prioritaires.length - 10,
    );

    const texte = composerInformationsSupplementaires(
      LIEU_COMPLET,
      base,
      null,
    )!;

    expect(texte.length).toBeLessThanOrEqual(LIMITE_INFOS_SUPPLEMENTAIRES);
    // Priorité haute conservée…
    expect(texte).toContain('Accès : Quai n°2, sonner interphone B');
    expect(texte).toContain('Stationnement : difficile');
    expect(texte).toContain('Contraintes horaires : Livraison avant 9h');
    // …priorité basse abandonnée…
    expect(texte).not.toContain('Flux acceptés');
    expect(texte).not.toContain('Véhicule max');
    // …et la coupe n'est pas silencieuse pour le chauffeur.
    expect(texte).toContain('(…)');
    // La saisie du traiteur reste intacte.
    expect(texte.startsWith(base)).toBe(true);
  });

  // Réserve levée en revue sécurité : une ligne prioritaire trop longue faisait
  // sortir « (…) » et RIEN d'autre — le chauffeur perdait tout, y compris le
  // début de l'information la plus utile.
  it('une ligne prioritaire trop longue est servie amputée, jamais escamotée', () => {
    const texte = composerInformationsSupplementaires(
      { ...LIEU_NU, acces_details: 'Quai n°2 ' + 'd'.repeat(1200) },
      null,
      null,
    )!;

    expect(texte.length).toBeLessThanOrEqual(LIMITE_INFOS_SUPPLEMENTAIRES);
    expect(texte.startsWith('Accès : Quai n°2 ddd')).toBe(true);
    expect(texte).not.toBe('(…)');
    expect(texte.endsWith('(…)')).toBe(true);
  });

  // Réserve levée en revue sécurité : quand la saisie du traiteur occupait tout
  // le budget, le marqueur se faisait manger par la coupe finale — la
  // troncature redevenait invisible dans le cas même qu'il devait couvrir.
  it('le marqueur survit quand la saisie du traiteur occupe tout le budget', () => {
    const texte = composerInformationsSupplementaires(
      LIEU_COMPLET,
      'y'.repeat(LIMITE_INFOS_SUPPLEMENTAIRES - 1),
      null,
    )!;

    expect(texte.length).toBeLessThanOrEqual(LIMITE_INFOS_SUPPLEMENTAIRES);
    expect(texte.endsWith('(…)')).toBe(true);
  });

  // Une coupe ne doit pas laisser de bout de ligne pendouillant quand il reste
  // du contenu complet avant elle.
  it('aucun fragment de ligne orphelin quand du contenu complet précède', () => {
    const texte = composerInformationsSupplementaires(
      LIEU_COMPLET,
      'y'.repeat(LIMITE_INFOS_SUPPLEMENTAIRES - 200),
      null,
    )!;

    const lignes = texte.split('\n');
    expect(lignes[lignes.length - 1]).toBe('(…)');
    // Chaque ligne d'accès conservée est complète (libellé + valeur entière).
    for (const ligne of lignes.slice(1, -1)) {
      expect([
        'Accès : Quai n°2, sonner interphone B',
        'Stationnement : difficile',
        'Contraintes horaires : Livraison avant 9h uniquement',
        'Accès office : très difficile',
        'Véhicule max : camionnette',
        'Flux acceptés : biodéchets, carton',
      ]).toContain(ligne);
    }
  });

  // ─── Nom du contact de secours (arbitrage Val 2026-09-14) ─────────────────
  // MTS-1 n'expose qu'UN contact par commande : le téléphone du secours part en
  // `phoneAlternatives`, son nom n'a aucun champ d'accueil — ni chez MTS-1, ni
  // chez Everest (`pickup.contact` = objet unique). Sans cette ligne, le
  // chauffeur a « un numéro de secours sans savoir qui appeler » (§08 l.393-397).

  it('le nom du contact de secours sort dans le champ libre', () => {
    const texte = composerInformationsSupplementaires(
      LIEU_NU,
      null,
      'Bruno Secours',
    );

    expect(texte).toBe('Contact de secours : Bruno Secours');
  });

  it('pas de contact de secours → aucune ligne « Contact de secours »', () => {
    expect(
      composerInformationsSupplementaires(LIEU_COMPLET, null, null),
    ).not.toContain('Contact de secours');
    expect(
      composerInformationsSupplementaires(LIEU_COMPLET, null, '  '),
    ).not.toContain('Contact de secours');
    // …et un lieu nu sans secours ne fabrique toujours pas de champ libre.
    expect(composerInformationsSupplementaires(LIEU_NU, null, '')).toBeNull();
  });

  it('il précède les informations d’accès — il est lu en premier', () => {
    const texte = composerInformationsSupplementaires(
      LIEU_COMPLET,
      'Demander Karim à la plonge',
      'Bruno Secours',
    )!;

    const lignes = texte.split('\n');
    // La saisie du traiteur garde la tête, le secours ouvre l'agrégat.
    expect(lignes[0]).toBe('Demander Karim à la plonge');
    expect(lignes[1]).toBe('Contact de secours : Bruno Secours');
    expect(lignes[2]).toBe('Accès : Quai n°2, sonner interphone B');
  });

  // Le nom est la seule ligne dont l'absence rend inexploitable une donnée par
  // ailleurs transmise nativement (le téléphone, en `phoneAlternatives`) : le
  // perdre à la troncature reproduirait exactement le défaut visé par
  // l'arbitrage. Il doit donc survivre là où les lignes d'accès tombent.
  it('il survit à la troncature qui emporte les lignes d’accès', () => {
    const texte = composerInformationsSupplementaires(
      LIEU_COMPLET,
      'y'.repeat(LIMITE_INFOS_SUPPLEMENTAIRES - 60),
      'Bruno Secours',
    )!;

    expect(texte.length).toBeLessThanOrEqual(LIMITE_INFOS_SUPPLEMENTAIRES);
    expect(texte).toContain('Contact de secours : Bruno Secours');
    expect(texte).not.toContain('Flux acceptés');
    expect(texte.endsWith('(…)')).toBe(true);
  });

  it('une saisie traiteur déjà hors borne est coupée net, sans dépassement', () => {
    const texte = composerInformationsSupplementaires(
      LIEU_COMPLET,
      'z'.repeat(LIMITE_INFOS_SUPPLEMENTAIRES + 500),
      null,
    );
    expect(texte!.length).toBe(LIMITE_INFOS_SUPPLEMENTAIRES);
  });
});
