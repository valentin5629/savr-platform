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
  MAX_ENTREES_SURCHARGE_LUE,
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

// `flux_autorises` est la seule entrée de l'allowlist dont la colonne est un
// `text[]`. La garde de type ci-dessus, écrite pour des champs textuels, la
// rejetait en bloc : conflit sémantique entre #312 (garde « chaîne ») et
// l'élargissement de l'allowlist à 9 champs — chacun correct isolément, les deux
// ensemble rendant IMPOSSIBLE tout override de ce champ. Le formulaire le
// propose, #308 le valide et le stocke en tableau, et rien n'arrivait au
// transporteur.
describe('lieuChampSurcharge — champ liste (flux_autorises, colonne text[])', () => {
  it('accepte un tableau de chaînes et le transmet', () => {
    expect(
      lieuChampSurcharge(
        { flux_autorises: ['biodéchets', 'carton'] },
        'flux_autorises',
      ),
    ).toBe(true);

    expect(
      applyLieuOverrides(
        { ...LIEU, flux_autorises: ['verre'] },
        { flux_autorises: ['biodéchets', 'carton'] },
      ).flux_autorises,
    ).toEqual(['biodéchets', 'carton']);
  });

  it('refuse une CHAÎNE sur un champ liste — la forme dépend du champ', () => {
    // Le symétrique du test suivant : c'est le CHAMP qui décide de la forme
    // attendue, jamais ce que la donnée se trouve porter.
    expect(
      lieuChampSurcharge({ flux_autorises: 'biodéchets' }, 'flux_autorises'),
    ).toBe(false);
    expect(
      applyLieuOverrides(
        { ...LIEU, flux_autorises: ['verre'] },
        { flux_autorises: 'biodéchets, carton' },
      ).flux_autorises,
    ).toEqual(['verre']);
  });

  it('refuse un TABLEAU sur un champ texte — la garde #312 tient toujours', () => {
    expect(lieuChampSurcharge({ ville: ['a', 'b'] }, 'ville')).toBe(false);
    expect(applyLieuOverrides(LIEU, { ville: ['a', 'b'] }).ville).toBe('Paris');
  });

  it('une seule entrée invalide disqualifie la liste entière', () => {
    // Transmettre une liste amputée serait pire qu'un repli sur le référentiel :
    // le chauffeur ne peut pas deviner qu'il en manque un.
    for (const invalide of [
      ['biodéchets', 42],
      ['biodéchets', null],
      ['biodéchets', { a: 1 }],
      ['biodéchets', '   '],
      ['biodéchets', 'x'.repeat(LONGUEUR_MAX_SURCHARGE_LUE + 1)],
    ]) {
      expect(
        lieuChampSurcharge({ flux_autorises: invalide }, 'flux_autorises'),
      ).toBe(false);
    }

    expect(
      applyLieuOverrides(
        { ...LIEU, flux_autorises: ['verre'] },
        { flux_autorises: ['biodéchets', 42] },
      ).flux_autorises,
    ).toEqual(['verre']);
  });

  // Relevé en revue sécurité : le chemin PostgREST direct (GRANT UPDATE
  // `authenticated`, dette #308) laissait écrire un tableau de 10 000 entrées,
  // relu tel quel par `fetchCollecte`. Rien de démesuré n'atteignait le
  // transporteur (le canal libre plafonne à 1000 car.), mais le worker chargeait
  // le tableau entier.
  it('refuse une liste démesurée, accepte le plafond pile', () => {
    const entree = 'biodéchets';
    const pile = Array.from(
      { length: MAX_ENTREES_SURCHARGE_LUE },
      () => entree,
    );

    expect(lieuChampSurcharge({ flux_autorises: pile }, 'flux_autorises')).toBe(
      true,
    );
    expect(
      lieuChampSurcharge(
        { flux_autorises: [...pile, entree] },
        'flux_autorises',
      ),
    ).toBe(false);
    // La borne d'écriture (#308, 20 items) est plus basse : aucune valeur passée
    // par une route ne touche ce plafond.
    expect(MAX_ENTREES_SURCHARGE_LUE).toBeGreaterThan(20);
  });

  // `{ ...lieu }` est superficiel : sans copie, la fusion rendait le tableau de
  // l'override PAR RÉFÉRENCE, ce que ce module promet de ne jamais faire (la
  // boucle E5 partage le lieu entre collectes, donc entre organisations).
  it('le tableau fusionné est une copie, jamais la référence de l’override', () => {
    const overrides = { flux_autorises: ['biodéchets', 'carton'] };
    const fusionne = applyLieuOverrides(
      { ...LIEU, flux_autorises: ['verre'] },
      overrides,
    );

    expect(fusionne.flux_autorises).toEqual(['biodéchets', 'carton']);
    expect(fusionne.flux_autorises).not.toBe(overrides.flux_autorises);

    (fusionne.flux_autorises as string[]).push('polluant');
    expect(overrides.flux_autorises).toEqual(['biodéchets', 'carton']);
  });

  it('un tableau vide vaut « non renseigné », pas « efface »', () => {
    expect(lieuChampSurcharge({ flux_autorises: [] }, 'flux_autorises')).toBe(
      false,
    );
    expect(
      applyLieuOverrides(
        { ...LIEU, flux_autorises: ['verre'] },
        { flux_autorises: [] },
      ).flux_autorises,
    ).toEqual(['verre']);
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
