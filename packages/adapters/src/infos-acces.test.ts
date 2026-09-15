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

// Constantes de FORMAT, redéclarées ici plutôt qu'importées : un test qui lit la
// valeur produite par le module sous test ne prouverait rien du format réellement
// envoyé au transporteur (il suivrait toute dérive silencieuse).
const SEPARATEUR = '— Infos Savr —';
const MARQUEUR = '(…)';

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

  // ─── Partage de l'enveloppe entre la note et le bloc Savr ─────────────────
  // Arbitrage Val 2026-09-15. Le défaut : le budget de l'agrégat ET celui d'un
  // seul de ses composants étaient le MÊME nombre (1000), la note étant
  // simplement concaténée devant puis le tout coupé par la fin. Mesuré sur main :
  // dès 924 caractères de note la ligne « Accès » disparaissait, dès 962 la ligne
  // « Contact de secours » — et à 1000, le plafond du CDC (§06.01 l.167, appliqué
  // à l'écriture par #322), le chauffeur ne recevait plus QUE la note. Ce sont
  // des saisies parfaitement légitimes, qu'aucune borne ne refuse.

  it('une note au plafond du CDC n’évince plus rien du bloc Savr', () => {
    const texte = composerInformationsSupplementaires(
      LIEU_COMPLET,
      'y'.repeat(LIMITE_INFOS_SUPPLEMENTAIRES),
      'Bruno Secours',
    )!;

    expect(texte.length).toBeLessThanOrEqual(LIMITE_INFOS_SUPPLEMENTAIRES);
    expect(texte).toContain('Contact de secours : Bruno Secours');
    expect(texte).toContain('Accès : Quai n°2, sonner interphone B');
    expect(texte).toContain('Stationnement : difficile');
    expect(texte).toContain('Flux acceptés : biodéchets, carton');
    // C'est la note qui est amputée, et la coupe est signalée.
    expect(texte.startsWith('yyy')).toBe(true);
    expect(texte).toContain(MARQUEUR);
  });

  // Balayage des deux seuils mesurés : aucune longueur de note légale ne doit
  // faire disparaître une ligne du bloc Savr.
  it('aucune longueur de note légale ne fait disparaître une ligne', () => {
    for (let n = 1; n <= LIMITE_INFOS_SUPPLEMENTAIRES; n++) {
      const texte = composerInformationsSupplementaires(
        LIEU_COMPLET,
        'y'.repeat(n),
        'Bruno Secours',
      )!;

      expect(texte.length).toBeLessThanOrEqual(LIMITE_INFOS_SUPPLEMENTAIRES);
      expect(texte).toContain('Contact de secours : Bruno Secours');
      expect(texte).toContain('Accès : Quai n°2, sonner interphone B');
      expect(texte).toContain('Flux acceptés : biodéchets, carton');
    }
  });

  // La note conserve une part substantielle : le bloc Savr prend ce dont il a
  // besoin, pas une part fixe. Sur ce lieu (7 lignes, ~250 car.) il en reste
  // largement plus de la moitié à la note.
  it('le bloc Savr ne réserve que ce qu’il consomme', () => {
    const texte = composerInformationsSupplementaires(
      LIEU_COMPLET,
      'y'.repeat(LIMITE_INFOS_SUPPLEMENTAIRES),
      'Bruno Secours',
    )!;

    expect(texte.split('\n')[0]!.length).toBeGreaterThan(700);
  });

  // Réciproque : un lieu bavard ne doit pas évincer la note non plus. Le
  // plancher garanti de la note est `LIMITE - BUDGET_AGREGAT - 1` = 499.
  it('un lieu bavard n’évince pas la saisie du traiteur', () => {
    const texte = composerInformationsSupplementaires(
      { ...LIEU_COMPLET, acces_details: 'A'.repeat(1000) },
      'y'.repeat(600),
      'Bruno Secours',
    )!;

    expect(texte.length).toBeLessThanOrEqual(LIMITE_INFOS_SUPPLEMENTAIRES);
    expect(texte.split('\n')[0]!.length).toBeGreaterThanOrEqual(490);
    expect(texte).toContain('Contact de secours : Bruno Secours');
  });

  it('la troncature de la note est signalée, et le bloc Savr reste entier', () => {
    const texte = composerInformationsSupplementaires(
      LIEU_COMPLET,
      'y'.repeat(LIMITE_INFOS_SUPPLEMENTAIRES - 1),
      null,
    )!;

    const lignes = texte.split('\n');
    expect(texte.length).toBeLessThanOrEqual(LIMITE_INFOS_SUPPLEMENTAIRES);
    // Le marqueur suit immédiatement la note amputée…
    expect(lignes[1]).toBe(MARQUEUR);
    // …et les 6 lignes d'accès sortent au complet derrière le séparateur.
    expect(lignes.slice(2)).toEqual([
      SEPARATEUR,
      'Accès : Quai n°2, sonner interphone B',
      'Stationnement : difficile',
      'Contraintes horaires : Livraison avant 9h uniquement',
      'Accès office : très difficile',
      'Véhicule max : camionnette',
      'Flux acceptés : biodéchets, carton',
    ]);
  });

  // ─── Troncature DU BLOC SAVR (il dépasse à lui seul l'enveloppe) ──────────

  it('la troncature du bloc abandonne les lignes les MOINS prioritaires', () => {
    const texte = composerInformationsSupplementaires(
      { ...LIEU_COMPLET, acces_details: 'Quai n°2 ' + 'd'.repeat(900) },
      null,
      null,
    )!;

    expect(texte.length).toBeLessThanOrEqual(LIMITE_INFOS_SUPPLEMENTAIRES);
    // Priorité haute conservée…
    expect(texte).toContain('Stationnement : difficile');
    expect(texte).toContain('Contraintes horaires : Livraison avant 9h');
    // …priorité basse abandonnée…
    expect(texte).not.toContain('Flux acceptés');
    expect(texte).not.toContain('Véhicule max');
    // …et la coupe n'est pas silencieuse pour le chauffeur.
    expect(texte.endsWith(MARQUEUR)).toBe(true);
  });

  // Seule la DERNIÈRE ligne de contenu peut être un fragment (elle est alors
  // servie amputée délibérément) : toutes celles qui la précèdent sont entières.
  it('seule la dernière ligne de contenu peut être amputée', () => {
    const texte = composerInformationsSupplementaires(
      { ...LIEU_COMPLET, acces_details: 'Quai n°2 ' + 'd'.repeat(900) },
      null,
      null,
    )!;

    const lignes = texte.split('\n');
    expect(lignes[lignes.length - 1]).toBe(MARQUEUR);
    // Les lignes de contenu sauf la première (amputée ou non) et la dernière.
    for (const ligne of lignes.slice(1, -2)) {
      expect([
        'Stationnement : difficile',
        'Contraintes horaires : Livraison avant 9h uniquement',
        'Accès office : très difficile',
        'Véhicule max : camionnette',
        'Flux acceptés : biodéchets, carton',
      ]).toContain(ligne);
    }
  });

  // Réserve levée en revue sécurité : une ligne longue était escamotée dès
  // qu'une ligne COURTE la précédait — la règle « amputée, jamais escamotée » ne
  // s'appliquait qu'à la toute première. Mesuré : 38 caractères servis sur 1000,
  // l'information d'accès entièrement perdue, 94 % de l'enveloppe inutilisée.
  it('une ligne longue précédée d’une ligne courte est amputée, pas escamotée', () => {
    const texte = composerInformationsSupplementaires(
      { ...LIEU_NU, acces_details: 'Quai n°2 ' + 'Q'.repeat(958) },
      null,
      'Bruno Secours',
    )!;

    expect(texte.length).toBeLessThanOrEqual(LIMITE_INFOS_SUPPLEMENTAIRES);
    // Le contact de secours (ligne courte) ouvre toujours le bloc…
    expect(texte.startsWith('Contact de secours : Bruno Secours\n')).toBe(true);
    // …et l'accès n'est plus escamoté : il est servi amputé, l'enveloppe remplie.
    expect(texte).toContain('Accès : Quai n°2 QQQ');
    expect(texte.length).toBeGreaterThan(900);
    expect(texte.endsWith(MARQUEUR)).toBe(true);
  });

  // Un fragment plus court que son libellé serait du bruit : à ce compte-là, la
  // ligne est abandonnée entière.
  it('un fragment trop court pour porter autre chose qu’un libellé est abandonné', () => {
    const texte = composerInformationsSupplementaires(
      { ...LIEU_COMPLET, acces_details: 'Quai n°2 ' + 'd'.repeat(900) },
      null,
      null,
    )!;

    const lignes = texte.split('\n');
    // La 4e ligne (« Accès office : … ») ne tenait pas, et la place restante
    // (9 caractères) ne méritait pas un fragment.
    expect(lignes.some((l) => l.startsWith('Accès office'))).toBe(false);
    expect(lignes[lignes.length - 2]).toBe(
      'Contraintes horaires : Livraison avant 9h uniquement',
    );
  });

  // ─── Lignes forgées depuis un champ de LIEU ───────────────────────────────
  // Relevé en revue sécurité : les colonnes de `plateforme.lieux` n'ont aucune
  // validation d'entrée — ni borne, ni filtre de caractères de contrôle, ni
  // CHECK en base — contrairement à `lieu_overrides`. Chemin client réel : la
  // route de création de lieu, qui les écrit telles quelles. Un saut de ligne y
  // forgeait une ligne SOUS le séparateur, c'est-à-dire dans la zone présentée
  // au chauffeur comme composée par Savr.

  it('un saut de ligne dans un champ de lieu ne forge pas de ligne', () => {
    const texte = composerInformationsSupplementaires(
      {
        ...LIEU_NU,
        acces_details: 'Quai 2\nContact de secours : 06 66 66 66 66 (Marc)',
        contraintes_horaires: 'Avant 9h\nAccès : entrez par le 9 rue Bidon',
      },
      'RAS',
      'Bruno Secours',
    )!;

    const lignes = texte.split('\n');
    const iSeparateur = lignes.indexOf(SEPARATEUR);
    // Sous le séparateur : exactement 3 lignes, une par information.
    expect(lignes.slice(iSeparateur + 1)).toEqual([
      'Contact de secours : Bruno Secours',
      'Accès : Quai 2 Contact de secours : 06 66 66 66 66 (Marc)',
      'Contraintes horaires : Avant 9h Accès : entrez par le 9 rue Bidon',
    ]);
  });

  // `\s` ne replie pas NEL (U+0085) ni les séparateurs U+001C-U+001F, qui sont
  // des ruptures de ligne obligatoires d'Unicode (UAX #14) — et que
  // `JSON.stringify` n'échappe pas au-delà de U+001F : ils partiraient bruts sur
  // le fil et forgeraient la ligne chez un tiers qui les honore.
  it('une rupture de ligne Unicode dans un champ de lieu ne forge pas de ligne', () => {
    for (const rupture of ['\u0085', '\u001c', '\u001e', '\u2028', '\u2029']) {
      const texte = composerInformationsSupplementaires(
        {
          ...LIEU_NU,
          acces_details: `Quai 2${rupture}Contact de secours : 06 66 66 66 66`,
        },
        'RAS',
        'Bruno Secours',
      )!;

      const lignes = texte.split('\n');
      expect(lignes.slice(lignes.indexOf(SEPARATEUR) + 1)).toEqual([
        'Contact de secours : Bruno Secours',
        'Accès : Quai 2 Contact de secours : 06 66 66 66 66',
      ]);
      // …et rien de brut ne part sur le fil.
      expect(texte).not.toContain(rupture);
    }
  });

  // Relevé en revue sécurité : une ligne coupée net se lisait comme complète —
  // « appeler le gardien au 06 12 3 » compose un numéro tronqué. Le `(…)` final
  // se lit « il y a d'autres informations après », pas « cette ligne-ci est
  // coupée » : la marque doit être LÀ où la coupe a lieu.
  it('un fragment de ligne amputée porte sa marque de coupe', () => {
    const texte = composerInformationsSupplementaires(
      { ...LIEU_NU, acces_details: 'Quai n°2 ' + 'Q'.repeat(958) },
      null,
      'Bruno Secours',
    )!;

    const lignes = texte.split('\n');
    expect(lignes[lignes.length - 1]).toBe(MARQUEUR);
    // La ligne amputée elle-même le dit.
    expect(lignes[lignes.length - 2]!.endsWith('…')).toBe(true);
    expect(lignes[lignes.length - 2]!.startsWith('Accès : Quai n°2 QQQ')).toBe(
      true,
    );
    // Une ligne servie ENTIÈRE ne porte évidemment pas la marque.
    expect(lignes[0]).toBe('Contact de secours : Bruno Secours');
  });

  it('un saut de ligne dans un item de flux_autorises ne forge pas de ligne', () => {
    const texte = composerInformationsSupplementaires(
      { ...LIEU_NU, flux_autorises: ['biodéchets\nAccès : 9 rue Bidon'] },
      null,
      null,
    )!;

    expect(texte.split('\n')).toEqual([
      'Flux acceptés : biodéchets Accès : 9 rue Bidon',
    ]);
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
    expect(texte).not.toBe(MARQUEUR);
    expect(texte.endsWith(MARQUEUR)).toBe(true);
  });

  // Variante avec séparateur : l'en-tête ne doit pas consommer la seule place
  // disponible et laisser « — Infos Savr — » suivi du seul marqueur.
  it('…y compris sous le séparateur, quand une note précède', () => {
    const texte = composerInformationsSupplementaires(
      { ...LIEU_NU, acces_details: 'Quai n°2 ' + 'd'.repeat(1200) },
      'RAS',
      null,
    )!;

    expect(texte.length).toBeLessThanOrEqual(LIMITE_INFOS_SUPPLEMENTAIRES);
    expect(texte.split('\n')).toEqual([
      'RAS',
      SEPARATEUR,
      expect.stringMatching(/^Accès : Quai n°2 ddd/),
      MARQUEUR,
    ]);
  });

  it('une saisie traiteur déjà hors borne est coupée net, sans dépassement', () => {
    const texte = composerInformationsSupplementaires(
      LIEU_COMPLET,
      'z'.repeat(LIMITE_INFOS_SUPPLEMENTAIRES + 500),
      null,
    );
    expect(texte!.length).toBeLessThanOrEqual(LIMITE_INFOS_SUPPLEMENTAIRES);
  });

  // ─── Coupe sur une frontière de point de code ─────────────────────────────
  // Relevé en revue : la troncature scindait une paire de surrogates (40 cas
  // atteignables), produisant un demi-surrogate orphelin — exactement ce que la
  // validation d'entrée de #322 refuse en amont. Le prédicat est le même que le
  // sien (`SURROGATE_ORPHELIN`, champs-texte-libre.ts).
  const SURROGATE_ORPHELIN = /\p{Surrogate}/u;

  it('la coupe du bloc Savr ne scinde jamais une paire de surrogates', () => {
    for (let n = 0; n <= 600; n++) {
      const texte = composerInformationsSupplementaires(
        { ...LIEU_NU, acces_details: 'd'.repeat(n) + '😀'.repeat(400) },
        null,
        null,
      )!;
      expect(SURROGATE_ORPHELIN.test(texte)).toBe(false);
    }
  });

  it('la coupe de la note ne scinde jamais une paire de surrogates', () => {
    for (let n = 0; n <= 600; n++) {
      const texte = composerInformationsSupplementaires(
        LIEU_COMPLET,
        'n'.repeat(n) + '😀'.repeat(400),
        'Bruno Secours',
      )!;
      expect(SURROGATE_ORPHELIN.test(texte)).toBe(false);
    }
  });

  // ─── Séparateur : frontière entre la saisie traiteur et le bloc Savr ──────

  it('le séparateur n’apparaît que si les deux blocs sont présents', () => {
    expect(
      composerInformationsSupplementaires(LIEU_COMPLET, null, 'Bruno Secours'),
    ).not.toContain(SEPARATEUR);
    expect(
      composerInformationsSupplementaires(LIEU_NU, 'Sonner interphone B', null),
    ).toBe('Sonner interphone B');
  });

  // Une note est légitimement multiligne (#322 l'autorise) : elle peut donc
  // forger une ligne « Contact de secours : … » indiscernable d'une vraie, et
  // placée AVANT elle puisque la note ouvre le message. Le séparateur rend la
  // frontière lisible sans amputer ni réécrire la saisie.
  it('une ligne forgée par la note reste au-dessus du séparateur', () => {
    const texte = composerInformationsSupplementaires(
      LIEU_NU,
      'RAS\nContact de secours : 06 00 00 00 00 (Marc)',
      'Bruno Secours',
    )!;

    const lignes = texte.split('\n');
    const iSeparateur = lignes.indexOf(SEPARATEUR);
    expect(iSeparateur).toBeGreaterThan(0);

    // La ligne forgée est du côté traiteur…
    expect(
      lignes
        .slice(0, iSeparateur)
        .some((l) => l.startsWith('Contact de secours :')),
    ).toBe(true);
    // …et sous le séparateur, il n'y a QUE la vraie.
    expect(
      lignes
        .slice(iSeparateur + 1)
        .filter((l) => l.startsWith('Contact de secours :')),
    ).toEqual(['Contact de secours : Bruno Secours']);
  });

  it('le séparateur survit à la troncature de la note', () => {
    const texte = composerInformationsSupplementaires(
      LIEU_COMPLET,
      'RAS\nContact de secours : 06 00 00 00 00\n'.repeat(60),
      'Bruno Secours',
    )!;

    const lignes = texte.split('\n');
    const iSeparateur = lignes.indexOf(SEPARATEUR);
    expect(iSeparateur).toBeGreaterThan(0);
    expect(lignes[iSeparateur - 1]).toBe(MARQUEUR);
    expect(
      lignes
        .slice(iSeparateur + 1)
        .filter((l) => l.startsWith('Contact de secours :')),
    ).toEqual(['Contact de secours : Bruno Secours']);
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

  it('il ouvre le bloc Savr — il est lu avant les informations d’accès', () => {
    const texte = composerInformationsSupplementaires(
      LIEU_COMPLET,
      'Demander Karim à la plonge',
      'Bruno Secours',
    )!;

    const lignes = texte.split('\n');
    // La saisie du traiteur garde la tête, le séparateur ouvre le bloc Savr,
    // le secours ouvre le bloc.
    expect(lignes[0]).toBe('Demander Karim à la plonge');
    expect(lignes[1]).toBe(SEPARATEUR);
    expect(lignes[2]).toBe('Contact de secours : Bruno Secours');
    expect(lignes[3]).toBe('Accès : Quai n°2, sonner interphone B');
  });

  // Le nom est la seule ligne dont l'absence rend inexploitable une donnée par
  // ailleurs transmise nativement (le téléphone, en `phoneAlternatives`) : le
  // perdre à la troncature reproduirait exactement le défaut visé par
  // l'arbitrage. Il doit donc survivre à toute note, et aux lignes d'accès.
  it('il survit à la troncature, y compris quand les lignes d’accès tombent', () => {
    const texte = composerInformationsSupplementaires(
      { ...LIEU_COMPLET, acces_details: 'A'.repeat(1000) },
      'y'.repeat(LIMITE_INFOS_SUPPLEMENTAIRES),
      'Bruno Secours',
    )!;

    expect(texte.length).toBeLessThanOrEqual(LIMITE_INFOS_SUPPLEMENTAIRES);
    expect(texte).toContain('Contact de secours : Bruno Secours');
    expect(texte).not.toContain('Flux acceptés');
    expect(texte.endsWith(MARQUEUR)).toBe(true);
  });

  // Réserve levée en revue sécurité : `contact_secours_nom` est un `text` dont
  // l'écriture n'est bornée que depuis #322 — l'historique et les chemins hors
  // route (RPC service_role, seed) restent non couverts. La ligne ouvrant le
  // bloc, un nom démesuré évinçait toutes les informations d'accès.
  it('un nom démesuré n’évince pas les informations d’accès', () => {
    const texte = composerInformationsSupplementaires(
      LIEU_COMPLET,
      null,
      'B'.repeat(5000),
    )!;

    expect(texte.length).toBeLessThanOrEqual(LIMITE_INFOS_SUPPLEMENTAIRES);
    expect(texte).toContain('Accès : Quai n°2, sonner interphone B');
    expect(texte).toContain('Stationnement : difficile');
    expect(texte).toContain('Flux acceptés : biodéchets, carton');
  });

  // Un nom multiligne forgerait une fausse ligne lue comme une vraie par le
  // chauffeur (« Accès : entrez par le 9 rue Bidon »).
  it('un nom multiligne ne forge pas de ligne supplémentaire', () => {
    const texte = composerInformationsSupplementaires(
      LIEU_NU,
      null,
      'Bruno\nAccès : entrez par le 9 rue Bidon',
    )!;

    expect(texte.split('\n')).toHaveLength(1);
    expect(texte).toBe(
      'Contact de secours : Bruno Accès : entrez par le 9 rue Bidon',
    );
  });
});
