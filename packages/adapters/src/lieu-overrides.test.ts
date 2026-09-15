// Garde de TYPE sur `collectes.lieu_overrides` à la LECTURE — jsonb libre.
//
// Défaut relevé par le reviewer sécurité en marge de #307 : l'allowlist bornait
// les CLÉS, pas le type des VALEURS. Une valeur non textuelle passait la fusion
// et finissait interpolée dans l'adresse envoyée au transporteur — un camion
// envoyé nulle part, de nuit. #308 refuse ces valeurs à l'écriture sur les deux
// routes ; ces tests tiennent la garde de lecture, seule à couvrir le chemin
// PostgREST direct que #308 laisse explicitement ouvert.
//
// Sondes reproduites telles qu'exécutées par le reviewer.

import { describe, expect, it } from 'vitest';

import {
  applyLieuOverrides,
  lieuChampSurcharge,
  LONGUEUR_MAX_SURCHARGE_LUE,
} from './lieu-overrides.js';

const LIEU = {
  id: 'lieu-001',
  nom: 'Pavillon Gabriel',
  adresse_acces: '5 Avenue Gabriel',
  code_postal: '75008',
  ville: 'Paris',
  acces_details: null as string | null,
  type_vehicule_max: 'camion_20m3',
  contraintes_horaires: null as string | null,
};

// Adresse telle que l'adapter la compose (mts1/adapter.ts) : c'est elle qui
// portait l'artefact de coercition.
const adresse = (l: typeof LIEU) =>
  `${l.adresse_acces}, ${l.code_postal} ${l.ville}`;

describe('lieuChampSurcharge — seule une chaîne non vide est une surcharge', () => {
  it('accepte une chaîne renseignée', () => {
    expect(
      lieuChampSurcharge(
        { adresse_acces: 'Entrée livraisons' },
        'adresse_acces',
      ),
    ).toBe(true);
  });

  it.each([
    ['un objet', { a: 1 }, '[object Object]'],
    ['un tableau', ['x', 'y'], 'x,y'],
    ['un nombre', 42, '42'],
    [
      'un objet à toString maison',
      { toString: () => 'valeur-forgee' },
      'valeur-forgee',
    ],
    ['un booléen', true, 'true'],
  ])('refuse %s', (_libelle, valeur, artefact) => {
    expect(lieuChampSurcharge({ adresse_acces: valeur }, 'adresse_acces')).toBe(
      false,
    );

    // L'enjeu n'est pas le booléen du prédicat : c'est que l'artefact de
    // coercition n'atteigne PAS le transporteur.
    const fusionne = applyLieuOverrides(LIEU, { adresse_acces: valeur });
    expect(adresse(fusionne)).toBe('5 Avenue Gabriel, 75008 Paris');
    expect(adresse(fusionne)).not.toContain(artefact);
  });

  it('refuse une chaîne vide ou blanche — ce n’est pas une correction d’adresse', () => {
    expect(lieuChampSurcharge({ ville: '' }, 'ville')).toBe(false);
    expect(lieuChampSurcharge({ ville: '   ' }, 'ville')).toBe(false);
    expect(applyLieuOverrides(LIEU, { ville: '   ' }).ville).toBe('Paris');
  });

  it('un champ optionnel vidé au formulaire n’efface pas la valeur officielle', () => {
    // Changement de comportement assumé : avant, `""` était une surcharge
    // effective et le champ officiel partait VIDE. Désormais `""` vaut `null`
    // — « non renseigné », pas « efface » — ce qui aligne la chaîne vide sur la
    // règle déjà en place pour `null` (« un null ne doit jamais écraser une
    // valeur de référence »).
    //
    // Sans effet observable en V1 : ni `acces_details` ni `contraintes_horaires`
    // n'est lu par un adapter (seuls adresse_acces / code_postal / ville
    // atteignent le wire). La sémantique compte pour la fusion V2, où le TMS
    // natif verra les mêmes champs.
    expect(lieuChampSurcharge({ acces_details: '' }, 'acces_details')).toBe(
      false,
    );
    expect(
      applyLieuOverrides(
        { ...LIEU, acces_details: 'Code portail 1234' },
        { acces_details: '' },
      ).acces_details,
    ).toBe('Code portail 1234');
  });

  it('refuse une valeur au-delà du plafond de lecture, accepte le plafond pile', () => {
    const max = LONGUEUR_MAX_SURCHARGE_LUE;

    expect(
      lieuChampSurcharge({ adresse_acces: 'a'.repeat(max) }, 'adresse_acces'),
    ).toBe(true);
    expect(
      lieuChampSurcharge(
        { adresse_acces: 'a'.repeat(max + 1) },
        'adresse_acces',
      ),
    ).toBe(false);

    // Une adresse de 10 000 caractères écrite en PostgREST direct n'atteint pas
    // MTS-1 : le lieu officiel passe à sa place.
    expect(
      applyLieuOverrides(LIEU, { adresse_acces: 'a'.repeat(10_000) })
        .adresse_acces,
    ).toBe('5 Avenue Gabriel');
  });

  it('ignore null, undefined et les clés absentes (comportement conservé)', () => {
    expect(lieuChampSurcharge(null, 'ville')).toBe(false);
    expect(lieuChampSurcharge({}, 'ville')).toBe(false);
    expect(lieuChampSurcharge({ ville: null }, 'ville')).toBe(false);
    expect(lieuChampSurcharge({ ville: undefined }, 'ville')).toBe(false);
  });
});

describe('applyLieuOverrides — jamais l’entrée par référence', () => {
  it('rend une copie même sans override', () => {
    const sansOverride = applyLieuOverrides(LIEU, null);

    expect(sansOverride).toEqual(LIEU);
    // `not.toBe` et pas seulement `toEqual` : un appelant futur qui muterait le
    // résultat corromprait sinon le lieu partagé par toutes les collectes de la
    // boucle E5 — donc potentiellement entre organisations.
    expect(sansOverride).not.toBe(LIEU);
  });

  it('ne mute pas le lieu source quand une surcharge s’applique', () => {
    applyLieuOverrides(LIEU, { ville: 'Levallois' });
    expect(LIEU.ville).toBe('Paris');
  });
});
