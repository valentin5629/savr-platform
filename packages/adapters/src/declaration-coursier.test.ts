/**
 * Déclaration du coursier A Toute! à l'enlèvement (décisions Val 2026-11-17) :
 * poids du don AG aux règles de MTS-1 (somme des vélos, l'Admin garde le
 * dernier mot) et champs montrés à l'Admin. Forme de l'historique = celle
 * mesurée sur le compte A Toute! le 2026-11-17 ; valeurs inventées.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  etapeDeclaree,
  lireDeclarationsCoursier,
  lirePoidsSaisi,
  releverPoidsDonCoursier,
} from './declaration-coursier.js';
import {
  setupEverestMock,
  type EtapeHistoriqueEverest,
  type MockMissionState,
} from './everest/mock.js';

const COLLECTE = '11111111-1111-1111-1111-111111111111';
const PRESTA_AT = 'presta-a-toutes';

interface Course {
  rang: number;
  ref: string;
  statut?: string;
}

interface Etat {
  type: string;
  statut: string;
  typeTms: string;
  courses: Course[];
  sansAttribution?: boolean;
  memoire?: number;
  ecritsPoids: number[];
  memoiresNotees: number[];
}

function fauxSupabase(etat: Etat): SupabaseClient {
  const table = (nom: string) => {
    const filtres: Record<string, unknown> = {};
    let maj: Record<string, unknown> | null = null;
    const resultat = () => {
      switch (nom) {
        case 'collectes':
          return {
            type: etat.type,
            statut: etat.statut,
            prestataire_logistique_id: PRESTA_AT,
          };
        case 'transporteurs':
          return 'type_tms' in filtres
            ? [{ prestataire_logistique_id: PRESTA_AT }]
            : { type_tms: etat.typeTms };
        case 'collecte_tournees':
          return etat.courses.map((c) => ({
            rang: c.rang,
            tournees: {
              id: `t${c.rang}`,
              statut: c.statut ?? 'en_cours',
              external_ref_commande: c.ref,
              prestataire_logistique_id: PRESTA_AT,
            },
          }));
        case 'attributions_antgaspi':
          if (maj) {
            if (etat.sansAttribution) return null;
            etat.ecritsPoids.push(maj['poids_repas_kg'] as number);
            return { id: 'att-1' };
          }
          return null;
        case 'integrations_inbox':
          return etat.memoire === undefined
            ? null
            : { payload: { valeur: etat.memoire } };
        default:
          return null;
      }
    };
    const c = {
      select: () => c,
      eq: (col: string, v: unknown) => {
        filtres[col] = v;
        return c;
      },
      is: () => c,
      in: () => c,
      update: (v: Record<string, unknown>) => {
        maj = v;
        if (nom === 'integrations_inbox') {
          etat.memoiresNotees.push((v['payload'] as { valeur: number }).valeur);
        }
        return c;
      },
      maybeSingle: () => Promise.resolve({ data: resultat(), error: null }),
      insert: (ligne: Record<string, unknown>) => {
        etat.memoiresNotees.push(
          (ligne['payload'] as { valeur: number }).valeur,
        );
        return Promise.resolve({
          error:
            etat.memoire === undefined
              ? null
              : { code: '23505', message: 'duplicate key value' },
        });
      },
      then: (ok: (v: unknown) => void) =>
        ok({ data: maj ? null : resultat(), error: null }),
    };
    return c;
  };
  return {
    from: table,
    schema: () => ({ from: table }),
    rpc: () => Promise.resolve({ data: null, error: null }),
  } as unknown as SupabaseClient;
}

const CREATION: EtapeHistoriqueEverest = {
  statut_code: 'nouvelle-mission',
  date: 1794417354,
  champs: [],
};

function enlevement(
  poids: string,
  date = 1794420000,
  autres: EtapeHistoriqueEverest['champs'] = [],
): EtapeHistoriqueEverest {
  return {
    statut_code: 'mission-en-cours-de-livraison',
    date,
    champs: [
      { name: 'Poids en Kg obligatoire', value: poids, type: 'number' },
      ...autres,
    ],
  };
}

const REMISE: EtapeHistoriqueEverest = {
  statut_code: 'livraison-terminee',
  date: 1794423000,
  champs: [],
};

let etat: Etat;
let mock: MockMissionState;
beforeEach(() => {
  mock = setupEverestMock();
  etat = {
    type: 'anti_gaspi',
    statut: 'en_cours',
    typeTms: 'a_toutes',
    courses: [{ rang: 1, ref: 'MIS-1' }],
    ecritsPoids: [],
    memoiresNotees: [],
  };
});

describe('lirePoidsSaisi', () => {
  it.each([
    ['12,5', 12.5],
    ['12.5', 12.5],
    [' 1 200 ', 1200],
    ['40', 40],
    ['0', null],
    ['', null],
    ['-3', null],
    ['douze', null],
    ['12,5,3', null],
  ])('« %s » → %s', (saisie, attendu) => {
    expect(lirePoidsSaisi(saisie)).toBe(attendu);
  });
});

describe('etapeDeclaree', () => {
  it('retient la dernière étape qui porte le poids, même après « Colis remis »', () => {
    const retenue = etapeDeclaree([
      CREATION,
      enlevement('10', 1794420000),
      enlevement('11', 1794421000),
      REMISE,
    ]);
    expect(retenue?.champs[0]?.value).toBe('11');
  });

  it('aucune étape avec le poids → null', () => {
    expect(etapeDeclaree([CREATION, REMISE])).toBeNull();
  });
});

describe('releverPoidsDonCoursier — poids du don AG', () => {
  it('une course pesée : le poids est écrit, puis noté', async () => {
    mock.historiques.set('MIS-1', [CREATION, enlevement('12,5'), REMISE]);
    const ecrit = await releverPoidsDonCoursier(
      fauxSupabase(etat),
      COLLECTE,
      'corr',
    );
    expect(ecrit).toBe(true);
    expect(etat.ecritsPoids).toEqual([12.5]);
    expect(etat.memoiresNotees).toEqual([12.5]);
  });

  it('deux vélos : rien tant qu’un seul est pesé, puis la somme', async () => {
    etat.courses = [
      { rang: 1, ref: 'MIS-1' },
      { rang: 2, ref: 'MIS-2' },
    ];
    mock.historiques.set('MIS-1', [CREATION, enlevement('20')]);
    mock.historiques.set('MIS-2', [CREATION]);
    expect(
      await releverPoidsDonCoursier(fauxSupabase(etat), COLLECTE, 'corr'),
    ).toBe(false);
    expect(etat.ecritsPoids).toEqual([]);

    mock.historiques.set('MIS-2', [CREATION, enlevement('7,25')]);
    expect(
      await releverPoidsDonCoursier(fauxSupabase(etat), COLLECTE, 'corr'),
    ).toBe(true);
    expect(etat.ecritsPoids).toEqual([27.25]);
  });

  it('une course annulée ne compte pas', async () => {
    etat.courses = [
      { rang: 1, ref: 'MIS-1' },
      { rang: 2, ref: 'MIS-2', statut: 'annulee' },
    ];
    mock.historiques.set('MIS-1', [enlevement('9')]);
    await releverPoidsDonCoursier(fauxSupabase(etat), COLLECTE, 'corr');
    expect(etat.ecritsPoids).toEqual([9]);
  });

  it('l’Admin garde le dernier mot : même somme déjà écrite → rien', async () => {
    etat.memoire = 12.5;
    mock.historiques.set('MIS-1', [enlevement('12,5')]);
    expect(
      await releverPoidsDonCoursier(fauxSupabase(etat), COLLECTE, 'corr'),
    ).toBe(false);
    expect(etat.ecritsPoids).toEqual([]);
  });

  it('le coursier corrige sa saisie : le nouveau poids est écrit, la mémoire mise à jour', async () => {
    etat.memoire = 12.5;
    mock.historiques.set('MIS-1', [
      enlevement('12,5'),
      enlevement('14', 1794422000),
    ]);
    await releverPoidsDonCoursier(fauxSupabase(etat), COLLECTE, 'corr');
    expect(etat.ecritsPoids).toEqual([14]);
    // INSERT refusé (clé déjà là) puis mise à jour.
    expect(etat.memoiresNotees).toEqual([14, 14]);
  });

  it.each([
    ['zero_dechet', 'en_cours'],
    ['anti_gaspi', 'cloturee'],
    ['anti_gaspi', 'annulee'],
    ['anti_gaspi', 'realisee_sans_collecte'],
    ['anti_gaspi', 'programmee'],
  ])('collecte %s au statut %s : rien n’est écrit', async (type, statut) => {
    etat.type = type;
    etat.statut = statut;
    mock.historiques.set('MIS-1', [enlevement('12')]);
    expect(
      await releverPoidsDonCoursier(fauxSupabase(etat), COLLECTE, 'corr'),
    ).toBe(false);
    expect(etat.ecritsPoids).toEqual([]);
  });

  it('collecte réalisée : le poids s’écrit encore', async () => {
    etat.statut = 'realisee';
    mock.historiques.set('MIS-1', [enlevement('12')]);
    await releverPoidsDonCoursier(fauxSupabase(etat), COLLECTE, 'corr');
    expect(etat.ecritsPoids).toEqual([12]);
  });

  it('collecte confiée à un autre transporteur : rien n’est lu ni écrit', async () => {
    etat.typeTms = 'mts1';
    mock.historiques.set('MIS-1', [enlevement('12')]);
    await releverPoidsDonCoursier(fauxSupabase(etat), COLLECTE, 'corr');
    expect(etat.ecritsPoids).toEqual([]);
  });

  it('poids illisible : rien n’est écrit', async () => {
    mock.historiques.set('MIS-1', [enlevement('douze')]);
    await releverPoidsDonCoursier(fauxSupabase(etat), COLLECTE, 'corr');
    expect(etat.ecritsPoids).toEqual([]);
  });

  it('sans attribution : rien n’est noté (le poids s’écrira plus tard)', async () => {
    etat.sansAttribution = true;
    mock.historiques.set('MIS-1', [enlevement('12')]);
    expect(
      await releverPoidsDonCoursier(fauxSupabase(etat), COLLECTE, 'corr'),
    ).toBe(false);
    expect(etat.memoiresNotees).toEqual([]);
  });
});

describe('lireDeclarationsCoursier — fiche collecte Admin', () => {
  it('tous les champs de l’enlèvement, cases en Oui / Non, par vélo', async () => {
    etat.courses = [
      { rang: 2, ref: 'MIS-2' },
      { rang: 1, ref: 'MIS-1' },
      { rang: 3, ref: 'MIS-3' },
    ];
    mock.historiques.set('MIS-1', [
      CREATION,
      enlevement('12,5', 1794420000, [
        {
          name: '30 et 59,99 kg ( oui ou non )',
          value: '1',
          type: 'true_false',
        },
        { name: '60 et 79,99 kg ( oui ou non )', value: '0', type: null },
        {
          name: "Minutes d'attentes ( nombre ) colis récupéré",
          value: '20',
          type: 'number',
        },
        {
          name: 'ENTRE demie caisse ET caisse complete ( oui ou non )',
          value: '',
          type: 'true_false',
        },
      ]),
      REMISE,
    ]);
    mock.historiques.set('MIS-2', [enlevement('8')]);
    mock.historiques.set('MIS-3', [CREATION]);

    const lu = await lireDeclarationsCoursier(
      fauxSupabase(etat),
      COLLECTE,
      'corr',
    );

    expect(lu).toEqual({
      pris_en_charge: true,
      courses_sans_declaration: 1,
      courses: [
        {
          course: 1,
          declare_le: new Date(1794420000 * 1000).toISOString(),
          poids_kg: 12.5,
          champs: [
            { nom: 'Poids en Kg obligatoire', valeur: '12,5' },
            { nom: '30 et 59,99 kg ( oui ou non )', valeur: 'Oui' },
            { nom: '60 et 79,99 kg ( oui ou non )', valeur: 'Non' },
            {
              nom: "Minutes d'attentes ( nombre ) colis récupéré",
              valeur: '20',
            },
            {
              nom: 'ENTRE demie caisse ET caisse complete ( oui ou non )',
              valeur: '',
            },
          ],
        },
        {
          course: 2,
          declare_le: new Date(1794420000 * 1000).toISOString(),
          poids_kg: 8,
          champs: [{ nom: 'Poids en Kg obligatoire', valeur: '8' }],
        },
      ],
    });
  });

  it('autre transporteur : non pris en charge', async () => {
    etat.typeTms = 'mts1';
    expect(
      await lireDeclarationsCoursier(fauxSupabase(etat), COLLECTE, 'corr'),
    ).toEqual({ pris_en_charge: false });
  });
});
