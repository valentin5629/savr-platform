/**
 * Montant de la prestation d'une collecte (décision Val 2026-11-03) : mêmes
 * règles que la facturation par collecte, calculées en lot.
 */
import { describe, it, expect } from 'vitest';
import {
  montantsPrestation,
  prixPack,
  STATUTS_REVENUS,
  type CollectePrestation,
} from './montant-prestation.js';

type Ligne = Record<string, unknown>;

// Faux client : chaque table rend ses lignes, filtrées par les `.eq` / `.in`
// de la requête. Les alias de `select` (« a:b ») sont appliqués.
function client(tables: Record<string, Ligne[]>) {
  const lectures: string[] = [];
  return {
    lectures,
    from(table: string) {
      lectures.push(table);
      const filtres: ((l: Ligne) => boolean)[] = [];
      const alias: [string, string][] = [];
      const chaine = {
        select(colonnes: string) {
          for (const c of colonnes.split(',').map((x) => x.trim())) {
            const [nom, source] = c.split(':');
            if (nom && source) alias.push([nom, source]);
          }
          return chaine;
        },
        eq(col: string, v: unknown) {
          filtres.push((l) => l[col] === v);
          return chaine;
        },
        in(col: string, vs: unknown[]) {
          filtres.push((l) => vs.includes(l[col]));
          return chaine;
        },
        then(resolve: (r: { data: Ligne[]; error: null }) => unknown) {
          const data = (tables[table] ?? [])
            .filter((l) => filtres.every((f) => f(l)))
            .map((l) => {
              const copie = { ...l };
              for (const [nom, source] of alias) copie[nom] = l[source];
              return copie;
            });
          return resolve({ data, error: null });
        },
      };
      return chaine;
    },
  };
}

const ORG = 'org-traiteur';
const GEST = 'org-gestionnaire';
const LIEU = 'lieu-1';
const AUTRE_LIEU = 'lieu-2';

const referentiel = (): Record<string, Ligne[]> => ({
  grilles_tarifaires_zd: [
    {
      id: 'g-defaut',
      actif: true,
      est_defaut: true,
      valide_du: '2026-01-01',
      valide_jusqu: null,
    },
    {
      id: 'g-org',
      actif: true,
      est_defaut: false,
      valide_du: '2026-06-01',
      valide_jusqu: null,
    },
  ],
  tarifs_zero_dechet: [
    {
      grille_id: 'g-defaut',
      pax_min: 1,
      pax_max: 500,
      prix_base_ht: 300,
      prix_par_couvert_ht: null,
    },
    {
      grille_id: 'g-defaut',
      pax_min: 501,
      pax_max: null,
      prix_base_ht: 100,
      prix_par_couvert_ht: 1,
    },
    {
      grille_id: 'g-org',
      pax_min: 1,
      pax_max: null,
      prix_base_ht: 200,
      prix_par_couvert_ht: null,
    },
  ],
  organisations: [{ id: ORG, grille_tarifaire_zd_id: 'g-org' }],
  organisations_lieux: [{ lieu_id: LIEU, organisation_id: GEST }],
  tarifs_negocie: [
    // Remise du traiteur, ZD, en vigueur toute l'année.
    {
      activite: 'zd',
      scope: 'organisation',
      organisation_id: ORG,
      gestionnaire_organisation_id: null,
      lieu_id: null,
      remise_pct: 0.1,
      valide_du: '2026-01-01',
      valide_jusqu_au: null,
    },
    // Remise du gestionnaire sur LIEU seulement, plus forte.
    {
      activite: 'zd',
      scope: 'gestionnaire',
      organisation_id: null,
      gestionnaire_organisation_id: GEST,
      lieu_id: LIEU,
      remise_pct: 0.25,
      valide_du: '2026-01-01',
      valide_jusqu_au: null,
    },
    // Remise AG du traiteur, expirée avant octobre.
    {
      activite: 'ag',
      scope: 'organisation',
      organisation_id: ORG,
      gestionnaire_organisation_id: null,
      lieu_id: null,
      remise_pct: 0.5,
      valide_du: '2026-01-01',
      valide_jusqu_au: '2026-09-30',
    },
  ],
  tarifs_packs_ag: [
    {
      type_pack: 'unitaire',
      prix_unitaire_ht: 590,
      valide_du: '2026-01-01',
      valide_jusqu_au: null,
    },
    {
      type_pack: 'pack_10',
      prix_unitaire_ht: 500,
      valide_du: '2026-01-01',
      valide_jusqu_au: null,
    },
  ],
});

function zd(over: Partial<CollectePrestation>): CollectePrestation {
  return {
    type: 'zero_dechet',
    pax: 200,
    date_collecte: '2026-10-10',
    organisation_id: 'org-sans-grille',
    lieu_id: AUTRE_LIEU,
    pack: null,
    ...over,
  };
}

function ag(over: Partial<CollectePrestation>): CollectePrestation {
  return { ...zd({}), type: 'anti_gaspi', ...over };
}

describe('montantsPrestation — ZD', () => {
  it('M3.5/montant_prestation_zd_grille_defaut — grille par défaut et palier du pax, sans remise', async () => {
    const c = client(referentiel());
    const m = await montantsPrestation(c as never, [
      zd({ pax: 200 }),
      zd({ pax: 800 }), // 100 + 800 × 1
    ]);
    expect(m).toEqual([300, 900]);
  });

  it('M3.5/montant_prestation_zd_grille_organisation — grille de l’organisation, et sa remise', async () => {
    const c = client(referentiel());
    const [m] = await montantsPrestation(c as never, [
      zd({ organisation_id: ORG }),
    ]);
    expect(m).toBe(180); // 200 × (1 − 0,10)
  });

  it('M3.5/montant_prestation_zd_grille_hors_validite — grille de l’organisation pas encore en vigueur : grille par défaut', async () => {
    const c = client(referentiel());
    const [m] = await montantsPrestation(c as never, [
      zd({ organisation_id: ORG, date_collecte: '2026-05-15' }),
    ]);
    expect(m).toBe(270); // 300 × (1 − 0,10)
  });

  it('M3.5/montant_prestation_zd_remise_max — la plus forte remise éligible s’applique, sans cumul (gestionnaire du lieu)', async () => {
    const c = client(referentiel());
    const [m] = await montantsPrestation(c as never, [
      zd({ organisation_id: ORG, lieu_id: LIEU }),
    ]);
    expect(m).toBe(150); // 200 × (1 − 0,25)
  });

  it('M3.5/montant_prestation_zd_inconnu — pax absent ou aucun palier : montant inconnu', async () => {
    const tables = referentiel();
    tables.grilles_tarifaires_zd = [];
    const sansGrille = client(tables);
    expect(
      await montantsPrestation(sansGrille as never, [zd({ pax: 100 })]),
    ).toEqual([null]);
    const c = client(referentiel());
    expect(await montantsPrestation(c as never, [zd({ pax: null })])).toEqual([
      null,
    ]);
  });
});

describe('montantsPrestation — éligibilité des remises', () => {
  const remise = (r: Partial<Ligne>): Ligne => ({
    activite: 'zd',
    scope: 'gestionnaire',
    organisation_id: null,
    gestionnaire_organisation_id: GEST,
    lieu_id: null,
    remise_pct: 0.2,
    valide_du: '2026-01-01',
    valide_jusqu_au: null,
    ...r,
  });

  it('M3.5/montant_prestation_remise_eligibilite — gestionnaire tous lieux oui, autre lieu non, autre organisation non', async () => {
    const tables = referentiel();
    tables.organisations_lieux = [
      { lieu_id: LIEU, organisation_id: GEST },
      { lieu_id: AUTRE_LIEU, organisation_id: GEST },
    ];
    tables.tarifs_negocie = [
      // Tous les lieux du gestionnaire : s'applique.
      remise({ lieu_id: null, remise_pct: 0.2 }),
      // Un autre lieu du même gestionnaire : ne s'applique pas sur LIEU.
      remise({ lieu_id: AUTRE_LIEU, remise_pct: 0.5 }),
      // Remise d'une autre organisation : jamais.
      remise({
        scope: 'organisation',
        organisation_id: 'org-tierce',
        gestionnaire_organisation_id: null,
        remise_pct: 0.6,
      }),
    ];
    const c = client(tables);
    const m = await montantsPrestation(c as never, [
      zd({ lieu_id: LIEU }), // 300 × 0,8
      zd({ lieu_id: AUTRE_LIEU }), // 300 × 0,5 (max 0,2 / 0,5)
      zd({ lieu_id: 'lieu-sans-gestionnaire' }),
    ]);
    expect(m).toEqual([240, 150, 300]);
  });

  it('M3.5/montant_prestation_ag_remise_gestionnaire — AG hors pack : remise AG du gestionnaire du lieu', async () => {
    const tables = referentiel();
    tables.tarifs_negocie = [remise({ activite: 'ag', remise_pct: 0.1 })];
    const c = client(tables);
    const [m] = await montantsPrestation(c as never, [ag({ lieu_id: LIEU })]);
    expect(m).toBe(531); // 590 × 0,9
  });
});

describe('montantsPrestation — AG', () => {
  it('M3.5/montant_prestation_ag_pack_debite — pack débité : son prix unitaire, sinon total ÷ crédits, sans remise', async () => {
    const c = client(referentiel());
    const m = await montantsPrestation(c as never, [
      ag({
        organisation_id: ORG,
        date_collecte: '2026-09-10',
        pack: {
          prix_unitaire_ht: 130,
          montant_total_ht: 1300,
          credits_initiaux: 10,
        },
      }),
      ag({
        pack: {
          prix_unitaire_ht: null,
          montant_total_ht: 2400,
          credits_initiaux: 20,
        },
      }),
    ]);
    expect(m).toEqual([130, 120]);
    // Aucun tarif unitaire lu quand toutes les collectes AG ont un pack.
    expect(c.lectures).not.toContain('tarifs_packs_ag');
  });

  it('M3.5/montant_prestation_ag_hors_pack — sans pack : tarif unitaire public moins la remise AG en vigueur', async () => {
    const c = client(referentiel());
    const m = await montantsPrestation(c as never, [
      ag({ organisation_id: ORG, date_collecte: '2026-09-10' }),
      ag({ organisation_id: ORG, date_collecte: '2026-10-10' }), // remise expirée
    ]);
    expect(m).toEqual([295, 590]);
  });
});

describe('montantsPrestation — lot', () => {
  it('M3.5/montant_prestation_lots_de_100 — 101 organisations : deux lectures, résultats fusionnés', async () => {
    const tables = referentiel();
    const orgs = Array.from({ length: 101 }, (_, i) => `org-${i}`);
    tables.organisations = orgs.map((id) => ({
      id,
      grille_tarifaire_zd_id: id === 'org-100' ? 'g-org' : null,
    }));
    const c = client(tables);
    const m = await montantsPrestation(
      c as never,
      orgs.map((id) => zd({ organisation_id: id })),
    );
    expect(c.lectures.filter((t) => t === 'organisations')).toHaveLength(2);
    expect(m[0]).toBe(300); // grille par défaut
    expect(m[100]).toBe(200); // grille propre, lue dans le second lot
  });

  it('M3.5/montant_prestation_sans_remise_a_lire — page d’AG sur pack : ni remise ni référentiel lu', async () => {
    const c = client(referentiel());
    await montantsPrestation(c as never, [
      ag({
        pack: {
          prix_unitaire_ht: 120,
          montant_total_ht: null,
          credits_initiaux: null,
        },
      }),
    ]);
    expect(c.lectures).toEqual([]);
  });

  it('M3.5/montant_prestation_lecture_tronquee — 1000 lignes pour un lot : erreur, jamais un montant sans sa remise', async () => {
    const tables = referentiel();
    tables.organisations_lieux = Array.from({ length: 1000 }, (_, i) => ({
      lieu_id: LIEU,
      organisation_id: `gest-${i}`,
    }));
    const c = client(tables);
    await expect(
      montantsPrestation(c as never, [zd({ lieu_id: LIEU })]),
    ).rejects.toThrow();
  });

  it('M3.5/montant_prestation_lot_vide — aucune collecte : aucune lecture', async () => {
    const c = client(referentiel());
    expect(await montantsPrestation(c as never, [])).toEqual([]);
    expect(c.lectures).toEqual([]);
  });

  it('prixPack sans prix ni crédits : inconnu', () => {
    expect(
      prixPack({
        prix_unitaire_ht: null,
        montant_total_ht: 1000,
        credits_initiaux: 0,
      }),
    ).toBeNull();
  });

  it('M3.5/montant_prestation_statuts_revenus — statuts des Revenus : programmées et réalisées seulement', () => {
    expect([...STATUTS_REVENUS].sort()).toEqual([
      'cloturee',
      'en_cours',
      'programmee',
      'realisee',
      'realisee_sans_collecte',
      'validee',
    ]);
  });
});
