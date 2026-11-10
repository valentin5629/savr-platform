// Commentaires transmis au transporteur (format décidé par Val le 2026-11-03) :
// commentaire de la mission, commentaire de l'adresse de départ, commentaire de
// l'adresse d'arrivée, et les trois réunis pour MTS-1.
//
// Ces tests portent sur le FORMAT et les bornes. Le câblage (les données
// arrivent bien dans le payload sortant des DEUX adapters, depuis le lieu
// FUSIONNÉ) est vérifié de bout en bout dans outbox-worker.m2-3.test.ts,
// mts1/adapter.m1-5a.test.ts et everest/adapter.m2-5.test.ts.

import { describe, expect, it } from 'vitest';

import type { Lieu } from './index.js';
import {
  CONSIGNE_PESEE_PHOTOS,
  type EntreeCommentaire,
  LIMITE_INFOS_SUPPLEMENTAIRES,
  composerCommentairesTransporteur,
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
  lieu: LIEU_NU,
  informationsSupplementaires: null,
  contact: SANS_CONTACT,
  contactSecours: SANS_CONTACT,
  vehicule: null,
  livraison: null,
};

const COMPLET: EntreeCommentaire = {
  lieu: LIEU_COMPLET,
  informationsSupplementaires: 'Rentrer par la cuisine',
  contact: { nom: 'Alice Martin', telephone: '+33600000001' },
  contactSecours: { nom: 'Bruno Secours', telephone: '+33600000002' },
  vehicule: { type: null, nombre: 2, typeTms: 'a_toutes' },
  livraison: {
    instructionsAcces: 'Sonner à l’accueil',
    contact: { nom: 'Association Essai', telephone: '+33600000003' },
  },
};

const URGENCE = "En cas d'urgence, appeler le 0761912997";
const VELOS =
  '2 vélos prévus pour cette collecte, veuillez vous coordonner pour les appels au traiteur';

function composer(e: Partial<EntreeCommentaire>) {
  return composerCommentairesTransporteur({ ...VIDE, ...e });
}

const SURROGATE_ORPHELIN = /\p{Surrogate}/u;

describe('infos-acces / commentaires au transporteur (Val 2026-11-03)', () => {
  it('format complet : mission, départ, arrivée, et les trois réunis pour MTS-1', () => {
    const c = composerCommentairesTransporteur(COMPLET);
    expect(c.general).toBe(
      [
        'Veuillez peser et prendre de belles photos de ce que vous récupérez svp',
        VELOS,
      ].join('\n'),
    );
    expect(c.depart).toBe(
      [
        "- Instructions d'accès : Quai n°2, sonner interphone B",
        '- Précisions du traiteur : Rentrer par la cuisine',
        '- Contact 1 : Alice Martin, +33600000001',
        '- Contact 2 : Bruno Secours, +33600000002',
        URGENCE,
      ].join('\n'),
    );
    expect(c.arrivee).toBe(
      [
        "- Instructions d'accès : Sonner à l’accueil",
        '- Contact : Association Essai, +33600000003',
      ].join('\n'),
    );
    expect(c.unique).toBe(
      [c.general, 'Départ :', c.depart, 'Arrivée :', c.arrivee].join('\n'),
    );
  });

  it('ne partent plus : traiteur, pax, contraintes horaires, accès office, flux, véhicule max, stationnement', () => {
    const { unique } = composerCommentairesTransporteur(COMPLET);
    expect(unique).not.toMatch(
      /Traiteur :|pax|Contraintes|Accès office|Flux|Véhicule|Stationnement|9h|biodéchets|très difficile/,
    );
  });

  it('rien de renseigné : la consigne seule, le numéro d’urgence au départ, pas d’arrivée', () => {
    const c = composer({});
    expect(c.general).toBe(CONSIGNE_PESEE_PHOTOS);
    expect(c.depart).toBe(URGENCE);
    expect(c.arrivee).toBeNull();
    expect(c.unique).toBe(
      [CONSIGNE_PESEE_PHOTOS, 'Départ :', URGENCE].join('\n'),
    );
  });

  it('un champ vide n’ajoute aucune ligne ; une arrivée vide n’a pas d’en-tête', () => {
    const c = composer({
      contact: { nom: 'Alice Martin', telephone: null },
      livraison: { instructionsAcces: '  ', contact: SANS_CONTACT },
    });
    expect(c.depart).toBe(['- Contact 1 : Alice Martin', URGENCE].join('\n'));
    expect(c.arrivee).toBeNull();
    expect(c.unique).not.toContain('Arrivée');
  });

  it('contact : nom et téléphone, ou celui des deux qui existe', () => {
    expect(
      composer({ contactSecours: { nom: null, telephone: '+33600000002' } })
        .depart,
    ).toBe(['- Contact 2 : +33600000002', URGENCE].join('\n'));
  });

  it('un seul véhicule sans type : aucune phrase', () => {
    expect(
      composer({ vehicule: { type: null, nombre: 1, typeTms: 'a_toutes' } })
        .general,
    ).toBe(CONSIGNE_PESEE_PHOTOS);
  });

  it('un seul véhicule au type précisé : « Véhicule souhaité : … » suit la consigne (Val 2026-11-10)', () => {
    const ligne = (type: string) =>
      composer({ vehicule: { type, nombre: 1, typeTms: 'mts1' } }).general;
    expect(ligne('camion_20m3_simple')).toBe(
      `${CONSIGNE_PESEE_PHOTOS}\nVéhicule souhaité : camion 20 m³ simple`,
    );
    expect(ligne('camion_16m3_double')).toBe(
      `${CONSIGNE_PESEE_PHOTOS}\nVéhicule souhaité : camion 16 m³ double`,
    );
    expect(ligne('camionnette_frigo')).toBe(
      `${CONSIGNE_PESEE_PHOTOS}\nVéhicule souhaité : camionnette frigo`,
    );
    expect(ligne('camion_frigo')).toBe(
      `${CONSIGNE_PESEE_PHOTOS}\nVéhicule souhaité : camion frigo`,
    );
    expect(ligne('velo_cargo')).toBe(
      `${CONSIGNE_PESEE_PHOTOS}\nVéhicule souhaité : vélo cargo`,
    );
  });

  it('plusieurs véhicules : la phrase suit la consigne, nommée par le type ou le transporteur', () => {
    const suite =
      ' pour cette collecte, veuillez vous coordonner pour les appels au traiteur';
    const phrase = (v: EntreeCommentaire['vehicule']) =>
      composer({ vehicule: v }).general.split('\n')[1];
    expect(phrase({ type: null, nombre: 2, typeTms: 'a_toutes' })).toBe(
      `2 vélos prévus${suite}`,
    );
    expect(phrase({ type: null, nombre: 3, typeTms: 'mts1' })).toBe(
      `3 camions prévus${suite}`,
    );
    expect(phrase({ type: null, nombre: 2, typeTms: 'par_mail' })).toBe(
      `2 véhicules prévus${suite}`,
    );
    expect(phrase({ type: 'velo_cargo', nombre: 2, typeTms: 'mts1' })).toBe(
      `2 vélos cargo prévus${suite}`,
    );
    expect(phrase({ type: 'camionnette', nombre: 2, typeTms: 'mts1' })).toBe(
      `2 camionnettes prévues${suite}`,
    );
    expect(
      phrase({ type: 'camion_20m3_double', nombre: 2, typeTms: 'mts1' }),
    ).toBe(`2 camions 20 m³ double prévus${suite}`);
    expect(
      phrase({ type: 'camionnette_frigo', nombre: 2, typeTms: 'mts1' }),
    ).toBe(`2 camionnettes frigo prévues${suite}`);
    expect(phrase({ type: 'camion_frigo', nombre: 3, typeTms: 'mts1' })).toBe(
      `3 camions frigo prévus${suite}`,
    );
  });

  it('une valeur non textuelle (surcharge jsonb libre) est ignorée, jamais interpolée', () => {
    expect(
      composer({
        lieu: { ...LIEU_NU, acces_details: { quai: 2 } as unknown as string },
      }).depart,
    ).toBe(URGENCE);
  });

  // ─── Une valeur ne forge jamais une ligne ──────────────────────────────────

  it.each([
    ['un saut de ligne', '\n'],
    ['un retour chariot', '\r\n'],
    ['NEL (U+0085)', '\u0085'],
    ['un séparateur de ligne (U+2028)', ' '],
    ['un séparateur de paragraphe (U+2029)', ' '],
    ['un séparateur d’information (U+001E)', '\u001e'],
  ])(
    '%s dans une saisie ne forge pas de ligne « Contact 1 : … »',
    (_cas, rupture) => {
      const forge = `ok${rupture}- Contact 1 : Faux, 06 66 66 66 66`;
      // Un véhicule (« Véhicule souhaité : … ») comme plusieurs (« N … prévus »).
      for (const nombre of [1, 2]) verifier(nombre);
      function verifier(nombre: number) {
        const { unique } = composerCommentairesTransporteur({
          ...COMPLET,
          lieu: { ...LIEU_COMPLET, acces_details: forge },
          informationsSupplementaires: forge,
          contact: { nom: forge, telephone: '+33600000001' },
          contactSecours: { nom: forge, telephone: forge },
          vehicule: { type: forge, nombre, typeTms: forge },
          livraison: {
            instructionsAcces: forge,
            contact: { nom: forge, telephone: forge },
          },
        });
        const lignes = unique.split('\n');
        // Chaque ligne est composée par Savr : en-tête, consigne, phrase des
        // véhicules, urgence, ou « - Libellé : … ».
        for (const l of lignes) {
          expect(l).toMatch(
            /^(Départ :|Arrivée :|Veuillez peser |En cas d'urgence, appeler le 0761912997$|- (Instructions d'accès|Précisions du traiteur|Contact 1|Contact 2|Contact) :|Véhicule souhaité : |\d+ .+ prévue?s pour cette collecte, veuillez vous coordonner pour les appels au traiteur$)/,
          );
        }
        expect(
          lignes.filter((l) => l.startsWith('- Contact 1 :')),
        ).toHaveLength(1);
        for (const r of ['\r', '\u0085', ' ', ' ', '\u001e']) {
          expect(unique).not.toContain(r);
        }
      }
    },
  );

  // ─── Bornes ────────────────────────────────────────────────────────────────

  it('un nom démesuré est borné à 120 caractères, coupe marquée', () => {
    expect(
      composer({ contact: { nom: 'N'.repeat(300), telephone: '+33600000001' } })
        .depart,
    ).toBe(
      [`- Contact 1 : ${'N'.repeat(119)}…, +33600000001`, URGENCE].join('\n'),
    );
  });

  it('chaque texte tient dans 1000 caractères, quelles que soient les longueurs', () => {
    for (const n of [0, 300, 600, 1000, 5000]) {
      const long = 'x'.repeat(n);
      const c = composerCommentairesTransporteur({
        lieu: { ...LIEU_COMPLET, acces_details: long },
        informationsSupplementaires: long,
        contact: { nom: long, telephone: long },
        contactSecours: { nom: long, telephone: long },
        vehicule: { type: long, nombre: 99, typeTms: long },
        livraison: {
          instructionsAcces: long,
          contact: { nom: long, telephone: long },
        },
      });
      for (const t of [c.general, c.depart, c.arrivee ?? '', c.unique]) {
        expect(t.length).toBeLessThanOrEqual(LIMITE_INFOS_SUPPLEMENTAIRES);
      }
      // Les lignes bornées par construction restent toutes dans le texte unique.
      expect(c.unique).toContain(CONSIGNE_PESEE_PHOTOS);
      expect(c.unique).toContain(URGENCE);
      if (n > 0) {
        expect(c.unique).toMatch(/^- Contact 1 : /m);
        expect(c.unique).toMatch(/^- Contact 2 : /m);
      }
    }
  });

  it('trop long : les précisions du traiteur partent les premières (arbitrage du 2026-09-15), juste ce qu’il faut', () => {
    const c = composerCommentairesTransporteur({
      ...COMPLET,
      lieu: { ...LIEU_COMPLET, acces_details: 'a'.repeat(600) },
      informationsSupplementaires: 'p'.repeat(600),
    });
    // Texte du départ d'Everest : seules les précisions sont amputées.
    expect(c.depart.length).toBe(LIMITE_INFOS_SUPPLEMENTAIRES);
    expect(c.depart).toMatch(/- Précisions du traiteur : p{40,}…\n/);
    expect(c.depart).toContain(`- Instructions d'accès : ${'a'.repeat(600)}\n`);
    expect(c.depart).toContain(URGENCE);
  });

  it('texte unique trop long : l’accès de l’arrivée part le premier, puis celui du départ', () => {
    const long = (c: string) => c.repeat(600);
    const c = composerCommentairesTransporteur({
      ...COMPLET,
      informationsSupplementaires: null,
      lieu: { ...LIEU_COMPLET, acces_details: long('a') },
      livraison: {
        instructionsAcces: long('l'),
        contact: { nom: 'Association Essai', telephone: '+33600000003' },
      },
    });
    expect(c.unique.length).toBeLessThanOrEqual(LIMITE_INFOS_SUPPLEMENTAIRES);
    // L'accès de l'arrivée ne garderait pas 40 caractères : retiré. Celui du
    // départ tient alors entier.
    expect(c.unique).not.toContain('l'.repeat(10));
    expect(c.unique).toContain(`- Instructions d'accès : ${long('a')}\n`);
    expect(c.unique).toContain('- Contact : Association Essai, +33600000003');
    // Chaque texte d'Everest, lui, reste entier : il tient seul.
    expect(c.depart).toContain(`- Instructions d'accès : ${long('a')}\n`);
    expect(c.arrivee).toContain(`- Instructions d'accès : ${long('l')}\n`);
  });

  it('si l’arrivée ne suffit pas, l’accès du départ est amputé juste ce qu’il faut, coupe marquée', () => {
    const c = composerCommentairesTransporteur({
      ...COMPLET,
      informationsSupplementaires: null,
      lieu: { ...LIEU_COMPLET, acces_details: 'a'.repeat(600) },
      contact: { nom: 'N'.repeat(120), telephone: '0'.repeat(40) },
      contactSecours: { nom: 'S'.repeat(120), telephone: '0'.repeat(40) },
      livraison: {
        instructionsAcces: 'l'.repeat(600),
        contact: { nom: 'A'.repeat(120), telephone: '0'.repeat(40) },
      },
    });
    expect(c.unique.length).toBe(LIMITE_INFOS_SUPPLEMENTAIRES);
    expect(c.unique).not.toContain('l'.repeat(10));
    expect(c.unique).toMatch(/- Instructions d'accès : a{40,}…\n/);
    expect(c.unique).toContain(URGENCE);
  });

  it('la coupe ne scinde jamais une paire de surrogates', () => {
    for (let n = 0; n <= 700; n += 7) {
      const c = composerCommentairesTransporteur({
        ...COMPLET,
        lieu: {
          ...LIEU_COMPLET,
          acces_details: 'd'.repeat(n) + '😀'.repeat(400),
        },
        livraison: {
          instructionsAcces: 'n'.repeat(n) + '😀'.repeat(400),
          contact: null,
        },
      });
      for (const t of [c.depart, c.arrivee ?? '', c.unique]) {
        expect(SURROGATE_ORPHELIN.test(t)).toBe(false);
      }
    }
  });
});
