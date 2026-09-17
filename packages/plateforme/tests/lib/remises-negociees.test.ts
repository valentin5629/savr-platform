/**
 * Remises négociées éligibles à une collecte — §05 « Tarifs et remises —
 * résolution du prix », étape 3 : scope organisation (programmateur) + scope
 * gestionnaire (gestionnaire du lieu via organisations_lieux, lieu_id = ce lieu
 * OU null), cumul multiplicatif.
 *
 * Le fake applique réellement les filtres eq/in posés par le code : une remise
 * d'un autre scope, d'une autre activité ou d'un autre gestionnaire n'est rendue
 * que si le code oublie le filtre correspondant.
 */
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@savr/shared/src/supabase-client.js';
import { facteurRemisesNegociees } from '@/lib/facturation/remises-negociees.js';
import { calculer_tarif_zd } from '@/lib/tarif-zd.js';
import { calculer_tarif_ag } from '@/lib/facturation/tarif-ag.js';

type Row = Record<string, unknown>;

function fakeSb(
  tables: Record<string, Row[]>,
  erreurs: Record<string, string> = {},
): SupabaseClient {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          rows = rows.filter((r) => r[col] === val);
          return builder;
        },
        in: (col: string, vals: unknown[]) => {
          rows = rows.filter((r) => vals.includes(r[col]));
          return builder;
        },
        lte: () => builder,
        or: () => builder,
        single: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
        then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
          Promise.resolve(
            erreurs[table]
              ? { data: null, error: { message: erreurs[table] } }
              : { data: rows, error: null },
          ).then(onF, onR),
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

const DATE = '2026-09-17';
const TRAITEUR = 'org-traiteur';
const VIPARIS = 'org-viparis';
const AUTRE_GEST = 'org-autre-gestionnaire';
const LIEU_VIPARIS = 'lieu-porte-versailles';
const AUTRE_LIEU_VIPARIS = 'lieu-paris-nord';

const LIENS = [
  { organisation_id: VIPARIS, lieu_id: LIEU_VIPARIS },
  { organisation_id: VIPARIS, lieu_id: AUTRE_LIEU_VIPARIS },
];

function remise(r: Row): Row {
  return {
    activite: 'zd',
    organisation_id: null,
    gestionnaire_organisation_id: null,
    lieu_id: null,
    ...r,
  };
}

describe('Remises négociées — scope gestionnaire de lieux', () => {
  it('remise gestionnaire « tous ses lieux » appliquée à un traiteur sans remise propre', async () => {
    const f = await facteurRemisesNegociees(
      fakeSb({
        organisations_lieux: LIENS,
        tarifs_negocie: [
          remise({
            scope: 'gestionnaire',
            gestionnaire_organisation_id: VIPARIS,
            remise_pct: 0.1,
          }),
        ],
      }),
      {
        activite: 'zd',
        organisationId: TRAITEUR,
        lieuId: LIEU_VIPARIS,
        dateStr: DATE,
      },
    );
    expect(f).toBeCloseTo(0.9, 10);
  });

  it('cumul multiplicatif remise traiteur × remise gestionnaire (15 % puis 10 % → 0,765)', async () => {
    const f = await facteurRemisesNegociees(
      fakeSb({
        organisations_lieux: LIENS,
        tarifs_negocie: [
          remise({
            scope: 'organisation',
            organisation_id: TRAITEUR,
            remise_pct: 0.15,
          }),
          remise({
            scope: 'gestionnaire',
            gestionnaire_organisation_id: VIPARIS,
            remise_pct: 0.1,
          }),
        ],
      }),
      {
        activite: 'zd',
        organisationId: TRAITEUR,
        lieuId: LIEU_VIPARIS,
        dateStr: DATE,
      },
    );
    expect(f).toBeCloseTo(0.765, 10);
  });

  it('remise gestionnaire sur un lieu précis : appliquée à ce lieu, pas aux autres lieux du gestionnaire', async () => {
    const tables = {
      organisations_lieux: LIENS,
      tarifs_negocie: [
        remise({
          scope: 'gestionnaire',
          gestionnaire_organisation_id: VIPARIS,
          lieu_id: LIEU_VIPARIS,
          remise_pct: 0.2,
        }),
      ],
    };
    const surLieu = await facteurRemisesNegociees(fakeSb(tables), {
      activite: 'zd',
      organisationId: TRAITEUR,
      lieuId: LIEU_VIPARIS,
      dateStr: DATE,
    });
    const autreLieu = await facteurRemisesNegociees(fakeSb(tables), {
      activite: 'zd',
      organisationId: TRAITEUR,
      lieuId: AUTRE_LIEU_VIPARIS,
      dateStr: DATE,
    });
    expect(surLieu).toBeCloseTo(0.8, 10);
    expect(autreLieu).toBe(1);
  });

  it("lieu d'un autre gestionnaire (ou sans gestionnaire) : remise Viparis non appliquée", async () => {
    const tarifs = [
      remise({
        scope: 'gestionnaire',
        gestionnaire_organisation_id: VIPARIS,
        remise_pct: 0.1,
      }),
    ];
    const autreGest = await facteurRemisesNegociees(
      fakeSb({
        organisations_lieux: [
          { organisation_id: AUTRE_GEST, lieu_id: 'lieu-x' },
        ],
        tarifs_negocie: tarifs,
      }),
      {
        activite: 'zd',
        organisationId: TRAITEUR,
        lieuId: 'lieu-x',
        dateStr: DATE,
      },
    );
    const sansGest = await facteurRemisesNegociees(
      fakeSb({ organisations_lieux: [], tarifs_negocie: tarifs }),
      {
        activite: 'zd',
        organisationId: TRAITEUR,
        lieuId: 'lieu-libre',
        dateStr: DATE,
      },
    );
    expect(autreGest).toBe(1);
    expect(sansGest).toBe(1);
  });

  it("filtre par activité : une remise gestionnaire ZD ne s'applique pas à une collecte AG", async () => {
    const f = await facteurRemisesNegociees(
      fakeSb({
        organisations_lieux: LIENS,
        tarifs_negocie: [
          remise({
            scope: 'gestionnaire',
            gestionnaire_organisation_id: VIPARIS,
            remise_pct: 0.1,
          }),
        ],
      }),
      {
        activite: 'ag',
        organisationId: TRAITEUR,
        lieuId: LIEU_VIPARIS,
        dateStr: DATE,
      },
    );
    expect(f).toBe(1);
  });

  it('une remise « organisation » portée par le gestionnaire ne profite pas aux traiteurs', async () => {
    const f = await facteurRemisesNegociees(
      fakeSb({
        organisations_lieux: LIENS,
        tarifs_negocie: [
          remise({
            scope: 'organisation',
            organisation_id: VIPARIS,
            remise_pct: 0.1,
          }),
        ],
      }),
      {
        activite: 'zd',
        organisationId: TRAITEUR,
        lieuId: LIEU_VIPARIS,
        dateStr: DATE,
      },
    );
    expect(f).toBe(1);
  });

  it('erreur de lecture des remises : levée, jamais avalée (pas de plein tarif silencieux)', async () => {
    await expect(
      facteurRemisesNegociees(
        fakeSb(
          { organisations_lieux: LIENS, tarifs_negocie: [] },
          { organisations_lieux: 'timeout' },
        ),
        {
          activite: 'zd',
          organisationId: TRAITEUR,
          lieuId: LIEU_VIPARIS,
          dateStr: DATE,
        },
      ),
    ).rejects.toThrow('timeout');
  });
});

// Chaîne complète : le prix calculé (récap programmation + brouillon facture)
// intègre la remise du gestionnaire du lieu. Exemple §05 : Butard 300 pax chez
// Viparis, grille 200 € + 1 €/pax = 500 € → −5 % gestionnaire = 475 € HT.
describe('Prix ZD / AG — remise gestionnaire du lieu intégrée', () => {
  const TABLES_ZD = {
    organisations: [{ id: TRAITEUR, grille_tarifaire_zd_id: 'grille-butard' }],
    grilles_tarifaires_zd: [
      { id: 'grille-butard', actif: true, est_defaut: false },
    ],
    tarifs_zero_dechet: [
      {
        id: 'tarif-fv',
        grille_id: 'grille-butard',
        prix_base_ht: 200,
        prix_par_couvert_ht: 1,
      },
    ],
    organisations_lieux: LIENS,
    tarifs_negocie: [
      remise({
        scope: 'gestionnaire',
        gestionnaire_organisation_id: VIPARIS,
        remise_pct: 0.05,
      }),
    ],
  };

  it('ZD : exemple §05 Butard 300 pax chez Viparis −5 % → 475 € HT', async () => {
    const r = await calculer_tarif_zd(
      300,
      TRAITEUR,
      new Date('2026-09-17'),
      fakeSb(TABLES_ZD),
      LIEU_VIPARIS,
    );
    expect(r.montant_brut_ht).toBe(500);
    expect(r.montant_ht).toBe(475);
    expect(r.remise_pct_cumulee).toBeCloseTo(0.05, 10);
  });

  it('ZD : même événement hors lieu Viparis → 500 € HT (pas de remise)', async () => {
    const r = await calculer_tarif_zd(
      300,
      TRAITEUR,
      new Date('2026-09-17'),
      fakeSb(TABLES_ZD),
      'lieu-hors-viparis',
    );
    expect(r.montant_ht).toBe(500);
  });

  it('AG hors pack : tarif unitaire 590 € − 10 % gestionnaire → 531 € HT', async () => {
    const r = await calculer_tarif_ag(
      fakeSb({
        tarifs_packs_ag: [
          { id: 'tarif-unit', type_pack: 'unitaire', prix_unitaire_ht: 590 },
        ],
        organisations_lieux: LIENS,
        tarifs_negocie: [
          remise({
            activite: 'ag',
            scope: 'gestionnaire',
            gestionnaire_organisation_id: VIPARIS,
            remise_pct: 0.1,
          }),
        ],
      }),
      {
        packAntgaspiId: null,
        organisationId: TRAITEUR,
        lieuId: LIEU_VIPARIS,
        date: new Date('2026-09-17'),
      },
    );
    expect(r.skip).toBe(false);
    if (r.skip) return;
    expect(r.montant_ht).toBe(531);
  });
});
