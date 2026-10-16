// Commentaire transmis au transporteur (format décidé par Val le 2026-10-15,
// C60-C62).
//
// Ces tests portent sur le FORMAT et les bornes. Le câblage (les données
// arrivent bien dans le payload sortant des DEUX adapters, depuis le lieu
// FUSIONNÉ) est vérifié de bout en bout dans outbox-worker.m2-3.test.ts,
// mts1/adapter.m1-5a.test.ts et everest/adapter.m2-5.test.ts.

import { describe, expect, it } from 'vitest';

import type { Lieu } from './index.js';
import {
  type EntreeCommentaire,
  LIMITE_INFOS_SUPPLEMENTAIRES,
  composerCommentaireTransporteur,
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

const SANS_CONTACT = { nom: null, telephone: null };

const VIDE: EntreeCommentaire = {
  traiteurNom: null,
  pax: null,
  lieu: LIEU_NU,
  informationsSupplementaires: null,
  contact: SANS_CONTACT,
  contactSecours: SANS_CONTACT,
  vehicule: null,
  livraison: null,
};

const COMPLET: EntreeCommentaire = {
  traiteurNom: 'Traiteur Essai',
  pax: 120,
  lieu: LIEU_COMPLET,
  informationsSupplementaires: 'Demander Karim à la plonge',
  contact: { nom: 'Alice Martin', telephone: '+33600000001' },
  contactSecours: { nom: 'Bruno Secours', telephone: '+33600000002' },
  vehicule: { type: 'camionnette', nombre: 2 },
  livraison: {
    instructionsAcces: 'Sonner à l’accueil',
    contact: { nom: 'Nadia Benali', telephone: '+33699990001' },
  },
};

function composer(e: Partial<EntreeCommentaire>): string | null {
  return composerCommentaireTransporteur({ ...VIDE, ...e });
}

const SURROGATE_ORPHELIN = /\p{Surrogate}/u;

describe('infos-acces / commentaire au transporteur', () => {
  it('format complet de Val : traiteur, pax, instructions d’accès en liste, contacts, livraison', () => {
    expect(composerCommentaireTransporteur(COMPLET)).toBe(
      [
        'Traiteur : Traiteur Essai',
        'Nombre de pax : 120',
        "Instructions d'accès :",
        '- Accès : Quai n°2, sonner interphone B',
        '- Précisions du traiteur : Demander Karim à la plonge',
        '- Contraintes horaires : Livraison avant 9h uniquement',
        '- Accès office : très difficile',
        '- Flux acceptés : biodéchets, carton',
        '- Véhicule souhaité : camionnette (1 par commande, 2 commandes identiques pour cette collecte)',
        'Contact : Alice Martin, +33600000001',
        'Contact de secours : Bruno Secours, +33600000002',
        'Livraison :',
        "- Instructions d'accès : Sonner à l’accueil",
        '- Contact : Nadia Benali, +33699990001',
      ].join('\n'),
    );
  });

  it('ni le véhicule max ni le stationnement du lieu ne sortent (Val, C60), même renseignés', () => {
    const texte = composerCommentaireTransporteur(COMPLET)!;
    expect(texte).not.toMatch(/Véhicule max|Stationnement|poids lourd/);
  });

  it('aucune information du tout → null (ni comment MTS-1 ni notes Everest)', () => {
    expect(composer({})).toBeNull();
  });

  it('un champ vide n’ajoute aucune ligne, et une rubrique vide n’a pas d’en-tête', () => {
    expect(
      composer({ contact: { nom: 'Alice Martin', telephone: null } }),
    ).toBe('Contact : Alice Martin');
    expect(
      composer({
        livraison: { instructionsAcces: '  ', contact: SANS_CONTACT },
      }),
    ).toBeNull();
  });

  it('nombre de pax : seul un entier strictement positif sort', () => {
    for (const pax of [0, -3, 12.5, Number.NaN, null, undefined]) {
      expect(composer({ pax })).toBeNull();
    }
    expect(composer({ pax: 80 })).toBe('Nombre de pax : 80');
  });

  it('contact : nom et téléphone, ou celui des deux qui existe', () => {
    expect(
      composer({ contactSecours: { nom: null, telephone: '+33600000002' } }),
    ).toBe('Contact de secours : +33600000002');
  });

  it('les enums sont traduits en libellés lisibles, une valeur inconnue passe brute', () => {
    expect(
      composer({ lieu: { ...LIEU_NU, acces_office: 'tres_difficile' } }),
    ).toBe("Instructions d'accès :\n- Accès office : très difficile");
    expect(composer({ lieu: { ...LIEU_NU, acces_office: 'inedit' } })).toBe(
      "Instructions d'accès :\n- Accès office : inedit",
    );
  });

  it('le véhicule souhaité sort en clair : type seul, ou 1 par commande et N commandes identiques ; rien pour un seul véhicule sans type', () => {
    expect(composer({ vehicule: { type: 'velo_cargo', nombre: 1 } })).toBe(
      "Instructions d'accès :\n- Véhicule souhaité : vélo cargo",
    );
    expect(composer({ vehicule: { type: null, nombre: 3 } })).toBe(
      "Instructions d'accès :\n- Véhicule souhaité : 1 par commande, 3 commandes identiques pour cette collecte",
    );
    expect(composer({ vehicule: { type: null, nombre: 1 } })).toBeNull();
  });

  it('une valeur non textuelle (surcharge jsonb libre) est ignorée, jamais interpolée', () => {
    expect(
      composer({
        lieu: {
          ...LIEU_NU,
          acces_details: { quai: 2 } as unknown as string,
          flux_autorises: ['carton', 3 as unknown as string],
        },
      }),
    ).toBe("Instructions d'accès :\n- Flux acceptés : carton");
  });

  // ─── Une valeur ne forge jamais une ligne ──────────────────────────────────

  it.each([
    ['un saut de ligne', '\n'],
    ['un retour chariot', '\r\n'],
    ['NEL (U+0085)', '\u0085'],
    ['un séparateur de ligne (U+2028)', '\u2028'],
    ['un séparateur de paragraphe (U+2029)', '\u2029'],
    ['un séparateur d’information (U+001E)', '\u001e'],
  ])(
    '%s dans une saisie ne forge pas de ligne « Contact : … »',
    (_cas, rupture) => {
      const forge = `ok${rupture}Contact : Faux, 06 66 66 66 66`;
      const texte = composerCommentaireTransporteur({
        ...COMPLET,
        traiteurNom: forge,
        informationsSupplementaires: forge,
        lieu: {
          ...LIEU_COMPLET,
          acces_details: forge,
          contraintes_horaires: forge,
          flux_autorises: [forge],
        },
        contact: { nom: forge, telephone: '+33600000001' },
        contactSecours: { nom: forge, telephone: forge },
        livraison: {
          instructionsAcces: forge,
          contact: { nom: forge, telephone: forge },
        },
      })!;
      const lignes = texte.split('\n');
      // Chaque ligne commence par un libellé composé par Savr.
      for (const l of lignes) {
        expect(l).toMatch(
          /^(Traiteur|Nombre de pax|Instructions d'accès|Contact|Contact de secours|Livraison) :|^- [A-ZÉ][^:]* : /,
        );
      }
      expect(lignes.filter((l) => l.startsWith('Contact :'))).toHaveLength(1);
      for (const rupture of ['\r', '\u0085', '\u2028', '\u2029', '\u001e']) {
        expect(texte).not.toContain(rupture);
      }
    },
  );

  // ─── Bornes ────────────────────────────────────────────────────────────────

  it('un nom démesuré est borné à 120 caractères, coupe marquée', () => {
    const texte = composer({
      contact: { nom: 'N'.repeat(300), telephone: '+33600000001' },
    })!;
    expect(texte).toBe(`Contact : ${'N'.repeat(119)}…, +33600000001`);
  });

  it('l’enveloppe de 1000 caractères est respectée, quelles que soient les longueurs', () => {
    for (const n of [0, 300, 600, 1000, 5000]) {
      const long = 'x'.repeat(n);
      const texte = composerCommentaireTransporteur({
        ...COMPLET,
        traiteurNom: long,
        informationsSupplementaires: long,
        lieu: {
          ...LIEU_COMPLET,
          acces_details: long,
          contraintes_horaires: long,
          flux_autorises: [long],
        },
        contact: { nom: long, telephone: long },
        contactSecours: { nom: long, telephone: long },
        livraison: {
          instructionsAcces: long,
          contact: { nom: long, telephone: long },
        },
      })!;
      expect(texte.length).toBeLessThanOrEqual(LIMITE_INFOS_SUPPLEMENTAIRES);
    }
  });

  it('la saisie du traiteur est amputée la première, juste ce qu’il faut, coupe marquée ; le reste est entier', () => {
    const texte = composerCommentaireTransporteur({
      ...COMPLET,
      informationsSupplementaires: 'p'.repeat(1000),
    })!;
    expect(texte).toHaveLength(LIMITE_INFOS_SUPPLEMENTAIRES);
    const precisions = texte
      .split('\n')
      .find((l) => l.startsWith('- Précisions du traiteur : '))!;
    expect(precisions.endsWith('p…')).toBe(true);
    expect(texte).toContain('- Accès : Quai n°2, sonner interphone B');
    expect(texte).toContain("- Instructions d'accès : Sonner à l’accueil");
    expect(texte).toContain('Contact de secours : Bruno Secours, +33600000002');
  });

  it('ordre d’abandon : précisions du traiteur, puis accès, puis instructions de livraison, puis contraintes horaires, puis flux', () => {
    const long = (c: string) => c.repeat(600);
    const texte = composerCommentaireTransporteur({
      ...COMPLET,
      informationsSupplementaires: long('p'),
      lieu: {
        ...LIEU_COMPLET,
        acces_details: long('a'),
        contraintes_horaires: long('h'),
        flux_autorises: [long('f')],
      },
      livraison: {
        instructionsAcces: long('l'),
        contact: { nom: 'Nadia Benali', telephone: '+33699990001' },
      },
    })!;
    expect(texte.length).toBeLessThanOrEqual(LIMITE_INFOS_SUPPLEMENTAIRES);
    // Chacune ne garderait pas 40 caractères : retirées dans l'ordre, jusqu'à ce
    // que le reste tienne ; la dernière (flux) reste entière à son plafond.
    expect(texte).not.toContain('Précisions du traiteur');
    expect(texte).not.toContain('- Accès :');
    expect(texte).not.toContain("- Instructions d'accès :");
    expect(texte).not.toContain('Contraintes horaires');
    expect(texte).toContain(`- Flux acceptés : ${'f'.repeat(600)}\n`);
    // Les lignes bornées par construction sont toutes là.
    for (const ligne of [
      'Traiteur : Traiteur Essai',
      'Nombre de pax : 120',
      '- Accès office : très difficile',
      'Contact : Alice Martin, +33600000001',
      'Contact de secours : Bruno Secours, +33600000002',
      '- Contact : Nadia Benali, +33699990001',
    ]) {
      expect(texte).toContain(ligne);
    }
  });

  it.each([
    [39, false],
    [40, true],
  ])(
    'une saisie du traiteur qui ne garderait que %i caractères : servie amputée seulement à partir de 40, sinon retirée ; l’accès reste entier',
    (garde, servie) => {
      // Longueur du reste (sans la saisie du traiteur) choisie pour que la
      // saisie de 600 caractères ne puisse en garder que `garde`.
      const sansAcces = composerCommentaireTransporteur({
        ...COMPLET,
        informationsSupplementaires: null,
        lieu: { ...LIEU_COMPLET, acces_details: null },
      })!.length;
      const ligneSaisie = '\n- Précisions du traiteur : '.length + 600;
      const reste =
        LIMITE_INFOS_SUPPLEMENTAIRES + 600 - ligneSaisie - 1 - garde;
      const acces = 'a'.repeat(reste - sansAcces - '\n- Accès : '.length);
      const texte = composerCommentaireTransporteur({
        ...COMPLET,
        informationsSupplementaires: 'p'.repeat(600),
        lieu: { ...LIEU_COMPLET, acces_details: acces },
      })!;
      expect(texte.length).toBeLessThanOrEqual(LIMITE_INFOS_SUPPLEMENTAIRES);
      expect(texte).toContain(`- Accès : ${acces}\n`);
      if (servie) {
        expect(texte).toContain(
          `- Précisions du traiteur : ${'p'.repeat(garde)}…\n`,
        );
      } else {
        expect(texte).not.toContain('Précisions du traiteur');
      }
    },
  );

  it('la coupe ne scinde jamais une paire de surrogates', () => {
    for (let n = 0; n <= 700; n += 7) {
      const texte = composerCommentaireTransporteur({
        ...COMPLET,
        informationsSupplementaires: 'n'.repeat(n) + '😀'.repeat(400),
        lieu: {
          ...LIEU_COMPLET,
          acces_details: 'd'.repeat(n) + '😀'.repeat(400),
        },
      })!;
      expect(SURROGATE_ORPHELIN.test(texte)).toBe(false);
    }
  });
});
