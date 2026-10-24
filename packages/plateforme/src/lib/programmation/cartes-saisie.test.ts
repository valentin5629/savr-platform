/**
 * M1.2 — cartes de l'écran 2 du formulaire de programmation (refonte, lot B2 ;
 * décisions Val 2026-10-22, C4–C5, et 2026-10-24, B2-Q4). Logique pure :
 *   · C5 : la collecte n°1 (Zéro Déchet #1, ou Anti-Gaspi #1 sans Zéro Déchet)
 *     sert de modèle ; les autres cartes en reprennent, champ par champ,
 *     convives, type d'événement, contacts et informations tant qu'on ne les a
 *     pas modifiés dans la carte ; date et heure ne sont jamais reprises ;
 *   · C4 : deux collectes du même type, même date et même heure → avertissement ;
 *   · B2-Q4 : au plus 10 collectes par type.
 */
import { describe, it, expect } from 'vitest';
import type { ContactOption } from '@/components/programmation/contact-combobox';
import {
  CHAMPS_SUIVIS,
  PLAFOND_PAR_TYPE,
  ajouterCarte,
  ajusterNombre,
  carteComplete,
  carteVersCorps,
  carteVide,
  cartesDepuis,
  clesEnDoublon,
  contactDepuis,
  figer,
  indexModele,
  libelleCarte,
  modifierCarte,
  nombreParType,
  paxSaisiValide,
  valeursEffectives,
  type CarteSaisie,
} from './cartes-saisie';

const PAUL: ContactOption = {
  id: 'c-paul',
  prenom: 'Paul',
  nom: 'Arnaud',
  telephone: '06 12 34 56 78',
};
const LEA: ContactOption = {
  id: 'c-lea',
  prenom: 'Léa',
  nom: 'Martin',
  telephone: '07 11 22 33 44',
};

/** Carte du type donné, avec les champs fournis comme valeurs propres. */
function carte(
  type: 'zd' | 'ag',
  champs: Partial<Omit<CarteSaisie, 'type'>> = {},
): CarteSaisie {
  return { ...carteVide(type), ...champs };
}

/** Modèle entièrement saisi (champs suivis + date et heure). */
const MODELE = {
  date_collecte: '2030-01-15',
  heure_collecte: '22:00',
  pax: '120',
  type_evenement_id: 'type-cocktail',
  contact_principal: PAUL,
  contact_secours: LEA,
  informations_supplementaires: 'Quai n°2',
};

describe('M1.2/formulaire_cartes — collecte n°1 (modèle)', () => {
  it('M1.2/formulaire_cartes_modele — Zéro Déchet #1 s’il existe, sinon Anti-Gaspi #1, aucun sans carte', () => {
    expect(indexModele([])).toBe(-1);
    expect(indexModele([carte('ag'), carte('ag')])).toBe(0);
    // Une ZD placée après une AG reste le modèle (la ZD prime).
    expect(indexModele([carte('ag'), carte('zd'), carte('zd')])).toBe(1);
    expect(indexModele([carte('zd'), carte('ag')])).toBe(0);
  });

  it('M1.2/formulaire_cartes_suivi — chaque champ suivi non modifié reprend celui du modèle', () => {
    const cartes = [carte('zd', MODELE), carte('zd'), carte('ag')];
    const [zd1, zd2, ag1] = valeursEffectives(cartes);
    expect(zd1).toEqual(cartes[0]);
    for (const suiveuse of [zd2!, ag1!]) {
      for (const champ of CHAMPS_SUIVIS) {
        expect(suiveuse[champ]).toEqual(MODELE[champ]);
      }
    }
    // La liste des champs suivis est exactement celle de C5.
    expect([...CHAMPS_SUIVIS].sort()).toEqual(
      [
        'contact_principal',
        'contact_secours',
        'informations_supplementaires',
        'pax',
        'type_evenement_id',
      ].sort(),
    );
  });

  it('M1.2/formulaire_cartes_date_heure_jamais_reprises — date et heure restent celles de la carte', () => {
    const [, zd2, ag1] = valeursEffectives([
      carte('zd', MODELE),
      carte('zd'),
      carte('ag', { date_collecte: '2030-02-01', heure_collecte: '09:00' }),
    ]);
    expect(zd2!.date_collecte).toBe('');
    expect(zd2!.heure_collecte).toBe('');
    expect(ag1!.date_collecte).toBe('2030-02-01');
    expect(ag1!.heure_collecte).toBe('09:00');
  });

  it('M1.2/formulaire_cartes_suivi_arrete — un champ modifié dans la carte ne suit plus, les autres continuent', () => {
    let cartes = [carte('zd', MODELE), carte('zd')];
    const cle2 = cartes[1]!.cle;
    cartes = modifierCarte(cartes, cle2, 'pax', '60');
    expect(cartes[1]!.modifies).toEqual(['pax']);

    // Le modèle change ensuite : la carte 2 garde son pax, suit le reste.
    const cle1 = cartes[0]!.cle;
    cartes = modifierCarte(cartes, cle1, 'pax', '150');
    cartes = modifierCarte(cartes, cle1, 'type_evenement_id', 'type-diner');
    cartes = modifierCarte(cartes, cle1, 'contact_principal', LEA);
    const [zd1, zd2] = valeursEffectives(cartes);
    expect(zd1!.pax).toBe('150');
    expect(zd2!.pax).toBe('60');
    expect(zd2!.type_evenement_id).toBe('type-diner');
    expect(zd2!.contact_principal).toEqual(LEA);

    // Vider un champ modifié ne le refait pas suivre : il reste « modifié ».
    cartes = modifierCarte(cartes, cle2, 'pax', '');
    expect(valeursEffectives(cartes)[1]!.pax).toBe('');
  });

  it('M1.2/formulaire_cartes_modele_jamais_marque — les champs du modèle et la date ne sont jamais « modifiés »', () => {
    let cartes = [carte('zd'), carte('zd')];
    cartes = modifierCarte(cartes, cartes[0]!.cle, 'pax', '80');
    expect(cartes[0]!.modifies).toEqual([]);
    cartes = modifierCarte(
      cartes,
      cartes[1]!.cle,
      'date_collecte',
      '2030-01-15',
    );
    cartes = modifierCarte(cartes, cartes[1]!.cle, 'heure_collecte', '22:00');
    expect(cartes[1]!.modifies).toEqual([]);
    expect(cartes[1]!.date_collecte).toBe('2030-01-15');
    // Seule la carte visée change.
    expect(cartes[0]!.date_collecte).toBe('');
  });
});

describe('M1.2/formulaire_cartes — nombre de collectes (écran 1) et ajout (écran 2)', () => {
  it('M1.2/formulaire_cartes_ajuster_nombre — ajoute en fin, retire les dernières, garde les autres types', () => {
    let cartes = ajusterNombre([], 'zd', 2);
    cartes = ajusterNombre(cartes, 'ag', 1);
    expect(cartes.map((c) => c.type)).toEqual(['zd', 'zd', 'ag']);
    const [zd1, zd2, ag1] = cartes;

    // Augmenter : les cartes existantes restent, en tête, dans leur ordre.
    const plus = ajusterNombre(cartes, 'zd', 3);
    expect(plus.map((c) => c.type)).toEqual(['zd', 'zd', 'zd', 'ag']);
    expect(plus.slice(0, 2).map((c) => c.cle)).toEqual([zd1!.cle, zd2!.cle]);
    expect(plus[3]!.cle).toBe(ag1!.cle);

    // Diminuer : la dernière carte du type part, les autres restent.
    const moins = ajusterNombre(plus, 'zd', 1);
    expect(moins.map((c) => c.cle)).toEqual([zd1!.cle, ag1!.cle]);

    // Zéro : plus aucune carte du type.
    expect(ajusterNombre(moins, 'ag', 0).map((c) => c.cle)).toEqual([zd1!.cle]);
  });

  it('M1.2/formulaire_cartes_borne_0_10 — le nombre voulu est borné de 0 à 10 par type', () => {
    expect(PLAFOND_PAR_TYPE).toBe(10);
    const max = ajusterNombre([], 'zd', 12);
    expect(nombreParType(max, 'zd')).toBe(10);
    expect(nombreParType(ajusterNombre(max, 'zd', -3), 'zd')).toBe(0);
    expect(nombreParType(ajusterNombre([], 'ag', 2.7), 'ag')).toBe(2);
    expect(nombreParType(ajusterNombre(max, 'ag', 10), 'ag')).toBe(10);
    expect(nombreParType(ajusterNombre(max, 'ag', 10), 'zd')).toBe(10);
  });

  it('M1.2/formulaire_cartes_ajouter — une carte de plus, rangée après celles de son type, qui suit la n°1', () => {
    const base = [carte('zd', MODELE), carte('ag')];
    const avec = ajouterCarte(base, 'zd');
    expect(avec.map((c) => c.type)).toEqual(['zd', 'zd', 'ag']);
    expect(avec[0]!.cle).toBe(base[0]!.cle);
    expect(avec[2]!.cle).toBe(base[1]!.cle);
    const nouvelle = valeursEffectives(avec)[1]!;
    expect(nouvelle.pax).toBe('120');
    expect(nouvelle.contact_principal).toEqual(PAUL);
    expect(nouvelle.date_collecte).toBe('');
    expect(nouvelle.heure_collecte).toBe('');
  });

  it('M1.2/formulaire_cartes_ajouter_plafond — refusé au-delà de 10 cartes du type, l’autre type reste possible', () => {
    const dix = ajusterNombre([], 'zd', 10);
    const refus = ajouterCarte(dix, 'zd');
    expect(refus).toHaveLength(10);
    expect(refus.map((c) => c.cle)).toEqual(dix.map((c) => c.cle));
    const ag = ajouterCarte(dix, 'ag');
    expect(nombreParType(ag, 'zd')).toBe(10);
    expect(nombreParType(ag, 'ag')).toBe(1);
  });

  it('M1.2/formulaire_cartes_figer — les valeurs affichées deviennent les valeurs propres', () => {
    const cartes = [carte('zd', MODELE), carte('ag')];
    const figees = figer(cartes);
    expect(figees[1]!.pax).toBe('120');
    expect(figees[1]!.contact_principal).toEqual(PAUL);
    // Les cartes d'origine ne sont pas modifiées.
    expect(cartes[1]!.pax).toBe('');
  });

  it('M1.2/formulaire_cartes_figer_changement_modele — retirer la ZD #1 : l’AG qui la suivait garde ce qu’elle affichait', () => {
    // L'AG #1 suit la ZD #1 ; la ZD retirée, l'AG #1 devient le modèle.
    const cartes = [carte('zd', MODELE), carte('ag', { pax: '' })];
    const apres = ajusterNombre(cartes, 'zd', 0);
    expect(apres).toHaveLength(1);
    expect(indexModele(apres)).toBe(0);
    const [ag1] = valeursEffectives(apres);
    for (const champ of CHAMPS_SUIVIS) {
      expect(ag1![champ]).toEqual(MODELE[champ]);
    }
  });

  // Défaut relevé au lot B2 et corrigé (`figer` marque les champs remplis de
  // la collecte n°1, `restructurer` fait reprendre au nouveau modèle les champs
  // de l'ancien) : une Zéro Déchet qui arrive devant des Anti-Gaspi ne fait
  // perdre ni à l'AG #1 ce qui a été saisi dans sa carte, ni à l'AG #2 ce
  // qu'elle reprenait de l'AG #1.
  it('M1.2/formulaire_cartes_figer_zd_ajoutee — une ZD ajoutée devant les AG : l’AG #1 garde ce qui a été saisi dans sa carte', () => {
    let cartes = ajusterNombre([], 'ag', 2);
    const ag1 = cartes[0]!.cle;
    cartes = modifierCarte(cartes, ag1, 'pax', '80');
    cartes = modifierCarte(
      cartes,
      ag1,
      'informations_supplementaires',
      'Porte B',
    );
    for (const apres of [
      ajusterNombre(cartes, 'zd', 1),
      ajouterCarte(cartes, 'zd'),
    ]) {
      const affichees = valeursEffectives(apres);
      const affichee = affichees.find((c) => c.cle === ag1)!;
      expect(affichee.pax).toBe('80');
      expect(affichee.informations_supplementaires).toBe('Porte B');
      // L'AG #2 suivait l'AG #1 : elle garde ce contenu.
      const ag2 = affichees.filter((c) => c.type === 'ag')[1]!;
      expect(ag2.pax).toBe('80');
      expect(ag2.informations_supplementaires).toBe('Porte B');
      // La ZD #1, nouveau modèle, reprend les champs de l'ancien, sans date.
      const zd1 = affichees.find((c) => c.type === 'zd')!;
      expect(zd1.pax).toBe('80');
      expect(zd1.date_collecte).toBe('');
    }
  });

  it('M1.2/formulaire_cartes_figer_suiveuse_retiree — retirer une carte ne change pas le contenu des autres', () => {
    let cartes = ajusterNombre([], 'zd', 3);
    cartes = modifierCarte(cartes, cartes[0]!.cle, 'pax', '90');
    cartes = modifierCarte(
      cartes,
      cartes[1]!.cle,
      'informations_supplementaires',
      'Porte B',
    );
    const avant = valeursEffectives(cartes);
    const apres = valeursEffectives(ajusterNombre(cartes, 'zd', 2));
    expect(apres).toHaveLength(2);
    expect(apres[0]!.pax).toBe(avant[0]!.pax);
    expect(apres[1]!.pax).toBe('90');
    expect(apres[1]!.informations_supplementaires).toBe('Porte B');
  });

  it('M1.2/formulaire_cartes_libelle — « Collecte Zéro Déchet #2 », numérotation par type', () => {
    const cartes = ajusterNombre(ajusterNombre([], 'zd', 2), 'ag', 1);
    expect(cartes.map((c) => libelleCarte(cartes, c.cle))).toEqual([
      'Collecte Zéro Déchet #1',
      'Collecte Zéro Déchet #2',
      'Collecte Anti-Gaspi #1',
    ]);
    expect(libelleCarte(cartes, 'inconnue')).toBe('');
  });
});

describe('M1.2/formulaire_cartes — avertissement même date même heure (C4)', () => {
  it('M1.2/formulaire_cartes_doublon — même type, même date et même heure seulement', () => {
    const zd1 = carte('zd', {
      date_collecte: '2030-01-15',
      heure_collecte: '22:00',
    });
    const zd2 = carte('zd', {
      date_collecte: '2030-01-15',
      heure_collecte: '22:00:00',
    });
    const zd3 = carte('zd', {
      date_collecte: '2030-01-15',
      heure_collecte: '23:00',
    });
    const zd4 = carte('zd', {
      date_collecte: '2030-01-16',
      heure_collecte: '22:00',
    });
    const ag1 = carte('ag', {
      date_collecte: '2030-01-15',
      heure_collecte: '22:00',
    });
    // Heure saisie avec ou sans secondes : même créneau.
    expect(clesEnDoublon([zd1, zd2, zd3, zd4, ag1])).toEqual(
      new Set([zd1.cle, zd2.cle]),
    );
    // Heure différente, date différente, autre type : aucun avertissement.
    expect(clesEnDoublon([zd1, zd3, zd4, ag1]).size).toBe(0);
    // Deux AG au même créneau : avertissement aussi.
    const ag2 = carte('ag', {
      date_collecte: '2030-01-15',
      heure_collecte: '22:00',
    });
    expect(clesEnDoublon([ag1, ag2])).toEqual(new Set([ag1.cle, ag2.cle]));
  });

  it('M1.2/formulaire_cartes_doublon_incomplet — sans date ou sans heure, aucun avertissement', () => {
    expect(
      clesEnDoublon([
        carte('zd', { date_collecte: '2030-01-15' }),
        carte('zd', { date_collecte: '2030-01-15' }),
        carte('zd', { heure_collecte: '22:00' }),
        carte('zd', { heure_collecte: '22:00' }),
      ]).size,
    ).toBe(0);
  });
});

describe('M1.2/formulaire_cartes — complétude et corps envoyé', () => {
  it('M1.2/formulaire_cartes_complete — date, heure, convives, type d’événement et contact principal avec téléphone', () => {
    const complete = carte('zd', MODELE);
    expect(carteComplete(complete)).toBe(true);
    // Le contact de secours et les informations sont facultatifs.
    expect(
      carteComplete({
        ...complete,
        contact_secours: null,
        informations_supplementaires: '',
      }),
    ).toBe(true);
    for (const manque of [
      { date_collecte: '' },
      { heure_collecte: '' },
      { pax: '' },
      { pax: '0' },
      { type_evenement_id: '' },
      { contact_principal: null },
      { contact_principal: { ...PAUL, telephone: '  ' } },
    ]) {
      expect(carteComplete({ ...complete, ...manque })).toBe(false);
    }
  });

  it('M1.2/formulaire_cartes_pax — entier de 1 à 100 000', () => {
    expect(paxSaisiValide('1')).toBe(true);
    expect(paxSaisiValide(' 700 ')).toBe(true);
    expect(paxSaisiValide('100000')).toBe(true);
    for (const refuse of [
      '',
      '0',
      '-5',
      '07',
      '12.5',
      '1e3',
      'abc',
      '100001',
    ]) {
      expect(paxSaisiValide(refuse)).toBe(false);
    }
  });

  it('M1.2/formulaire_cartes_corps — une carte devient la collecte attendue par la route', () => {
    expect(carteVersCorps({ ...carte('ag', MODELE) })).toEqual({
      type: 'ag',
      date_collecte: '2030-01-15',
      heure_collecte: '22:00',
      pax: 120,
      type_evenement_id: 'type-cocktail',
      contact_principal_nom: 'Paul Arnaud',
      contact_principal_telephone: '06 12 34 56 78',
      contact_secours_nom: 'Léa Martin',
      contact_secours_telephone: '07 11 22 33 44',
      informations_supplementaires: 'Quai n°2',
    });
    // Contact de secours et informations absents : null, jamais une chaîne vide.
    const corps = carteVersCorps(
      carte('zd', {
        ...MODELE,
        contact_secours: null,
        informations_supplementaires: '',
      }),
    );
    expect(corps.contact_secours_nom).toBeNull();
    expect(corps.contact_secours_telephone).toBeNull();
    expect(corps.informations_supplementaires).toBeNull();
    // Un contact relu (brouillon, duplication) n'a que son nom complet.
    expect(
      carteVersCorps(
        carte('zd', {
          ...MODELE,
          contact_principal: contactDepuis('Paul Arnaud', '06 12 34 56 78'),
        }),
      ).contact_principal_nom,
    ).toBe('Paul Arnaud');
  });

  it('M1.2/formulaire_cartes_contact_depuis — contact relu présenté comme une option, absent sans nom', () => {
    expect(contactDepuis('Paul Arnaud', '06 12 34 56 78')).toEqual({
      id: '',
      prenom: '',
      nom: 'Paul Arnaud',
      telephone: '06 12 34 56 78',
    });
    expect(contactDepuis('Paul Arnaud', null)?.telephone).toBe('');
    expect(contactDepuis(null, '06 12 34 56 78')).toBeNull();
    expect(contactDepuis('', '06 12 34 56 78')).toBeNull();
  });
});

describe('M1.2/formulaire_cartes — cartes relues (brouillon, duplication)', () => {
  const source = (
    type: 'zd' | 'ag',
    champs: Partial<Omit<CarteSaisie, 'cle' | 'modifies' | 'type'>> = {},
  ): Omit<CarteSaisie, 'cle' | 'modifies'> => ({
    type,
    ...MODELE,
    contact_principal: contactDepuis('Paul Arnaud', '06 12 34 56 78'),
    contact_secours: null,
    ...champs,
  });

  it('M1.2/formulaire_cartes_depuis — seuls les champs différents du modèle sont marqués modifiés', () => {
    const cartes = cartesDepuis([
      // Rangées ZD puis AG : l'AG passée en tête ne devient pas le modèle.
      source('ag', {
        pax: '40',
        contact_principal: contactDepuis('Léa Martin', '07 11 22 33 44'),
      }),
      source('zd'),
      source('zd', { date_collecte: '2030-01-16', heure_collecte: '08:00' }),
    ]);
    expect(cartes.map((c) => c.type)).toEqual(['zd', 'zd', 'ag']);
    expect(indexModele(cartes)).toBe(0);
    expect(cartes[0]!.modifies).toEqual([]);
    // Date et heure différentes ne sont pas des champs suivis.
    expect(cartes[1]!.modifies).toEqual([]);
    expect([...cartes[2]!.modifies].sort()).toEqual(
      ['contact_principal', 'pax'].sort(),
    );
    expect(new Set(cartes.map((c) => c.cle)).size).toBe(3);

    // La ZD #1 change de type d'événement : l'AG suit (champ égal), garde
    // ses convives et son contact (champs différents).
    const apres = valeursEffectives(
      modifierCarte(cartes, cartes[0]!.cle, 'type_evenement_id', 'type-diner'),
    );
    expect(apres[2]!.type_evenement_id).toBe('type-diner');
    expect(apres[2]!.pax).toBe('40');
    expect(apres[2]!.contact_principal?.nom).toBe('Léa Martin');
    expect(apres[1]!.date_collecte).toBe('2030-01-16');
  });

  it('M1.2/formulaire_cartes_depuis_vide — aucune source, aucune carte', () => {
    expect(cartesDepuis([])).toEqual([]);
  });
});
