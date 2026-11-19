/**
 * M5.3 — checks de réconciliation, remise à zéro, rapport. Fixtures inventées.
 *
 * Le dernier bloc joue une répétition entière (import, rejeu, checks, sabotage,
 * remise à zéro) sur la base locale jetable. Il ne tourne que si
 * MIGRATION_BUBBLE_TEST_DATABASE_URL est posée (jamais en CI, qui n'a pas de
 * base) et refuse une base qui porte déjà un import.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DECLENCHEURS_COUPES, connecter, type Requeteur } from '../src/base';
import { CHECKS, jouerChecks } from '../src/checks';
import { ecrireCsv, type Ligne } from '../src/csv';
import { importer, type BilanPassage } from '../src/importer';
import { TABLES_CIBLES } from '../src/plan';
import { ecrireRapport, redigerRapport } from '../src/rapport';
import { TMS_BUBBLE_CAMION, TMS_BUBBLE_VELO } from '../src/referentiel-tms';
import { remettreAZero } from '../src/remise-a-zero';
import { CATALOGUE, type TypeSource } from '../src/sources';
import { MOTIF_SANS_POIDS } from '../src/transformations/collectes';
import {
  NOM_ASSOCIATION_HISTORIQUE,
  NOM_TRANSPORTEUR_HISTORIQUE,
} from '../src/transformations/referentiels';
import {
  abonnement,
  agence,
  collecte,
  contact,
  entreprise,
  lieu,
  pack,
  poids,
  pointDepot,
  transporteur,
  utilisateur,
} from './fixtures';

describe('M5.3 / checks de réconciliation — catalogue', () => {
  it('chaque check a un code unique, un libellé et une nature ; les familles A à E de la fiche sont couvertes', () => {
    const codes = CHECKS.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const famille of ['A', 'B', 'C', 'D', 'E'])
      expect(codes.some((c) => c.startsWith(famille))).toBe(true);
    expect(codes).toEqual(
      expect.arrayContaining([
        'A1',
        'A2',
        'A3',
        'A5',
        'B1',
        'B2',
        'B3',
        'B4',
        'B5',
        'B6',
        'C8',
        'C9',
        'C10',
        'E2',
        'E3',
        'E4',
        'E5',
      ]),
    );
    expect(CHECKS.every((c) => c.libelle.length > 15)).toBe(true);
  });

  it('les contrôles de complétion avant go-live ne bloquent pas une répétition ; tous les autres bloquent', () => {
    const gates = CHECKS.filter((c) => c.nature === 'gate_go_live').map(
      (c) => c.code,
    );
    expect(gates).toEqual(['D1', 'D2', 'D3', 'D4', 'D6']);
    expect(
      CHECKS.filter((c) => !c.code.startsWith('D')).every(
        (c) => c.nature === 'bloquant',
      ),
    ).toBe(true);
  });

  it('un check ne fait que lire : aucune écriture, aucun changement de schéma', () => {
    for (const c of CHECKS) {
      expect(c.sql.trimStart()).toMatch(/^(SELECT|WITH)\b/);
      expect(c.sql).not.toMatch(
        /\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|GRANT)\b/,
      );
    }
  });

  it('les attendus sont relus dans les exports bruts, sans chiffre figé', () => {
    const sourcees = ['A1', 'A2', 'A4', 'A6', 'A7', 'B1', 'B5', 'B6'];
    for (const code of sourcees)
      expect(CHECKS.find((c) => c.code === code)!.sql).toContain(
        'migration.sources_brutes',
      );
    for (const c of CHECKS)
      expect(c.sql).not.toMatch(/\b(1977|1755|222|133)\b/);
  });

  it('0 ligne = vert ; chaque ligne rendue est une anomalie, cinq exemples au plus sont gardés', async () => {
    const client: Requeteur = {
      query: async (texte) => {
        const rows = texte.includes('credits_restants < 0')
          ? Array.from({ length: 7 }, (_, i) => ({ id: `pack-${i}` }))
          : [];
        return { rows, rowCount: rows.length };
      },
    };
    const resultats = await jouerChecks(client);
    expect(resultats).toHaveLength(CHECKS.length);
    const b3 = resultats.find((r) => r.code === 'B3')!;
    expect(b3).toMatchObject({ anomalies: 7, nature: 'bloquant' });
    expect(b3.exemples).toHaveLength(5);
    expect(
      resultats.filter((r) => r.code !== 'B3').every((r) => r.anomalies === 0),
    ).toBe(true);
  });
});

describe('M5.3 / remise à zéro', () => {
  const client = (presente: boolean) => {
    const requetes: string[] = [];
    const c: Requeteur = {
      query: async (texte, valeurs) => {
        requetes.push(
          `${texte.replace(/\s+/g, ' ').trim()}${valeurs ? ` ← ${String(valeurs[0])}` : ''}`,
        );
        if (texte.includes('to_regclass'))
          return { rows: [{ presente }], rowCount: 1 };
        if (texte.includes('pg_trigger')) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: texte.startsWith('DELETE') ? 3 : 0 };
      },
    };
    return { c, requetes };
  };

  it('retire les lignes importées dans l’ordre inverse des dépendances, retrouvées par la table de correspondance', async () => {
    const { c, requetes } = client(true);
    const retirees = await remettreAZero(c);
    const suppressions = requetes.filter(
      (r) => r.startsWith('DELETE FROM') && r.includes('migration.id_map m'),
    );
    expect(suppressions.map((r) => /^DELETE FROM (\S+)/.exec(r)![1])).toEqual([
      'plateforme.attributions_antgaspi',
      'plateforme.collecte_flux',
      'plateforme.collecte_contacts',
      'plateforme.collectes',
      'plateforme.evenements',
      'plateforme.packs_antgaspi',
      'plateforme.contacts_traiteurs',
      'plateforme.organisations_domaines_email',
      'plateforme.entites_facturation',
      'plateforme.transporteurs',
      'shared.prestataires',
      'plateforme.associations',
      'plateforme.lieux',
      'plateforme.users',
      'plateforme.organisations',
    ]);
    // Seules les lignes de la table de correspondance partent : jamais un vidage de table.
    expect(
      suppressions.every(
        (r) => r.includes('WHERE t.') && r.includes('IN (SELECT m.target_id'),
      ),
    ).toBe(true);
    expect(requetes.some((r) => /\bTRUNCATE\b/i.test(r))).toBe(false);
    expect(Object.keys(retirees)).toHaveLength(TABLES_CIBLES.length + 1);
    expect(requetes[1]).toBe('BEGIN');
    expect(requetes.at(-1)).toBe('COMMIT');
  });

  it('coupe les déclencheurs pendant le retrait, les rétablit, puis vide le staging', async () => {
    const { c, requetes } = client(true);
    await remettreAZero(c);
    const rang = (motif: RegExp) => requetes.findIndex((r) => motif.test(r));
    expect(requetes.filter((r) => /DISABLE TRIGGER/.test(r))).toHaveLength(
      DECLENCHEURS_COUPES.length,
    );
    expect(requetes.filter((r) => /ENABLE TRIGGER/.test(r))).toHaveLength(
      DECLENCHEURS_COUPES.length,
    );
    expect(rang(/DISABLE TRIGGER/)).toBeLessThan(
      rang(/^DELETE FROM plateforme/),
    );
    expect(rang(/ENABLE TRIGGER/)).toBeGreaterThan(
      rang(/^DELETE FROM plateforme\.organisations/),
    );
    expect(requetes.slice(-5, -1)).toEqual([
      'DELETE FROM migration.id_map',
      'DELETE FROM migration.rejets',
      'DELETE FROM migration.sources_brutes',
      'DELETE FROM migration.auteurs_evenements',
    ]);
  });

  it('base sans import : ne fait rien', async () => {
    const { c, requetes } = client(false);
    expect(await remettreAZero(c)).toEqual({});
    expect(requetes).toHaveLength(1);
  });
});

const BILAN: BilanPassage = {
  horodatage: '20261115-210000',
  jourReference: '2026-11-15',
  exports: {
    agences: {
      fichier: 'export_All-Agences_2026-06-07_19-46-06.csv',
      lignes: 3,
      ecartes: [
        {
          fichier: 'export_All-Agences_2026-06-07_18-00-00.csv',
          motif: 'complet mais plus ancien',
        },
      ],
    },
  },
  geocodage: { adresses: 4, appels: 4, echecs: 1, duCache: 0 },
  ecritures: [
    {
      table: 'plateforme.collectes',
      lues: 5,
      inserees: 5,
      modifiees: 0,
      inchangees: 0,
    },
  ],
  correspondances: { inserees: 12, modifiees: 0, disparues: 0 },
  rejets: { 'collecte — date de collecte illisible': 1 },
  listings: { 'lieux-a-completer': 2 },
  co2: { antiGaspi: 3, zeroDechet: 1 },
  auteurs: {
    evenements: 5,
    avecEmailCommercial: 3,
    avecEmailContactSeul: 1,
    sansEmail: 1,
    emailsDistincts: 2,
    emailsSurDomainePublic: 1,
    emailsHorsDomaineOrganisation: 1,
    evenementsHorsDomaineOrganisation: 2,
  },
  comptes: {
    'plateforme.collectes': { avant: 0, apres: 5 },
    'plateforme.outbox_events': { avant: 0, apres: 0 },
  },
  dureesMs: { écriture: 120 },
};

describe('M5.3 / rapport de répétition', () => {
  it('donne, par passage, les écritures par table, les rejets par motif, les checks, les durées et les déclencheurs coupés', () => {
    const rejeu: BilanPassage = {
      ...BILAN,
      horodatage: '20261115-210500',
      ecritures: [
        {
          table: 'plateforme.collectes',
          lues: 5,
          inserees: 0,
          modifiees: 0,
          inchangees: 5,
        },
      ],
      correspondances: { inserees: 0, modifiees: 0, disparues: 0 },
      comptes: {
        'plateforme.collectes': { avant: 5, apres: 5 },
        'plateforme.outbox_events': { avant: 0, apres: 0 },
      },
    };
    const rapport = redigerRapport(
      [BILAN, rejeu],
      [
        {
          code: 'A1',
          libelle: 'Collectes importées',
          nature: 'bloquant',
          anomalies: 0,
          exemples: [],
        },
        {
          code: 'B2',
          libelle: 'Crédits consommés',
          nature: 'bloquant',
          anomalies: 2,
          exemples: [],
        },
        {
          code: 'D1',
          libelle: 'Transporteur à compléter',
          nature: 'gate_go_live',
          anomalies: 4,
          exemples: [],
        },
      ],
    );
    expect(rapport).toContain(
      '| plateforme.collectes | 5 | 5 | 0 | 0 | 5 | 0 | 0 | 5 |',
    );
    expect(rapport).toContain(
      '| plateforme.outbox_events (aucune écriture attendue) | 0 | 0 | 0 | 0 |',
    );
    expect(rapport).toContain('| collecte — date de collecte illisible | 1 |');
    expect(rapport).toContain(
      '| A1 | Collectes importées | bloquant | 0 | vert |',
    );
    expect(rapport).toContain(
      '| B2 | Crédits consommés | bloquant | 2 | ROUGE |',
    );
    expect(rapport).toContain(
      '| D1 | Transporteur à compléter | gate_go_live | 4 | à compléter avant le go-live |',
    );
    expect(rapport).toContain('| écriture | 120 | 120 |');
    expect(rapport).toContain('| 1 | 5 | 3 | 1 | 1 | 2 | 1 | 1 | 2 |');
    expect(rapport).toContain('`provenance` (`commercial`');
    expect(rapport).toContain('| collectes | trg_pack_debit_programmation |');
    expect(rapport).toContain(
      'export_All-Agences_2026-06-07_18-00-00.csv (complet mais plus ancien)',
    );
  });

  it('écrit le rapport dans le dossier de la répétition, à partir des bilans de passage, et y joint les notes rédigées à la main', () => {
    const dossier = mkdtempSync(join(tmpdir(), 'rapport-'));
    mkdirSync(join(dossier, 'passages'));
    writeFileSync(
      join(dossier, 'passages', 'passage-20261115-210000.json'),
      JSON.stringify(BILAN),
    );
    writeFileSync(
      join(dossier, 'notes.md'),
      '## Notes de la répétition\n\nMesure faite à part.\n',
    );
    const chemin = ecrireRapport(dossier);
    expect(chemin).toBe(join(dossier, 'rapport.md'));
    const rapport = readFileSync(chemin, 'utf8');
    expect(rapport).toContain('| plateforme.collectes | 5 | 5 | 0 | 0 |');
    expect(rapport).toContain(
      '## Notes de la répétition\n\nMesure faite à part.',
    );
    expect(rapport).not.toContain('## Checks de réconciliation');
  });

  it('sans passage enregistré : le dit', () => {
    expect(redigerRapport([], null)).toContain('Aucun passage enregistré.');
  });
});

// ── Répétition entière sur la base locale jetable (fixtures inventées) ───────

const NOMS_EXPORTS: Record<TypeSource, string> = {
  collectes_ag: 'export_---Collectes-Nourritures_2026-06-07_19-13-16.csv',
  collectes_zd: 'export_----Collectes-D-chets_2026-06-07_19-19-14.csv',
  poids_zd:
    'export_All-Poids-collecte-d-chets-modified--_2026-06-07_19-08-18.csv',
  entreprises: 'export_All-Entreprises-modified--_2026-06-07_19-44-30.csv',
  agences: 'export_All-Agences-modified--_2026-06-07_19-46-06.csv',
  utilisateurs: 'export_All-Users-modified--_2026-06-07_19-23-40.csv',
  lieux: 'export_All-Lieu--v-nementiels-modified--_2026-06-07_19-47-55.csv',
  contacts: 'export_All-Contacts-modified_2026-06-07_19-19-40.csv',
  packs: 'export_All-Packs-modified--_2026-06-07_19-45-06.csv',
  abonnements: 'export_All-Abonnements-modified--_2026-06-07_19-11-39.csv',
  points_depot: 'export_All-Point-de-d-pots-modified--_2026-06-07_19-22-12.csv',
  transporteurs: 'export_All-Transporteurs-modified--_2026-06-07_19-22-32.csv',
};

function ecrireExports(lignes: Record<TypeSource, Ligne[]>): string {
  const dossier = mkdtempSync(join(tmpdir(), 'exports-inventes-'));
  for (const type of Object.keys(NOMS_EXPORTS) as TypeSource[])
    writeFileSync(
      join(dossier, NOMS_EXPORTS[type]),
      ecrireCsv(CATALOGUE[type].colonnes, lignes[type]),
    );
  return dossier;
}

function exportsInventes(): Record<TypeSource, Ligne[]> {
  const velo = transporteur({ TmsType: TMS_BUBBLE_VELO });
  const camion = transporteur({
    Nom: 'Frigo Mu',
    'Véhicules utilisés': 'Camion frigorifique',
    TmsType: TMS_BUBBLE_CAMION,
  });
  const gamma = agence();
  const p = pack();
  const pesees = poids({
    'Biodéchets (kg)': '12,5',
    'DIB (kg)': '3',
    'Plastique (kg)': '1,25',
  });
  const asso = 'PARIS / Association Epsilon';
  const don = { Transporteur: velo['unique id']!, 'Point de dépot': asso };
  const ag = [
    collecte({ ...don, 'Poids total': '12,6', 'pack lié': p['unique id']! }),
    collecte({ ...don, 'Poids total': '4', Agence: gamma['unique id']! }),
    collecte({ "Pas d'excédents": 'oui', 'pack lié': p['unique id']! }),
    collecte({ Statut: 'Annulée' }),
    collecte({
      Statut: 'Programmée',
      'Heure du pickup': 'Dec 20, 2027 6:00 pm',
      "besoin de l'immatriculation": 'oui',
    }),
    collecte({
      ...don,
      'Poids total': '9',
      'Heure du pickup': 'Mar 3, 2020 6:00 pm',
      'Instruction lieu': 'Demander Alex',
    }),
    // Don sans association ni transporteur dans Bubble : porté par les fiches historiques.
    collecte({ 'Poids total': '7', 'Nombre de convives': '' }),
    collecte({ 'Heure du pickup': 'illisible' }),
    // Terminée sans poids ni mention « pas d'excédents » : importée « sans excédent ».
    collecte({ ...don, Identifiant: 'SANS-POIDS' }),
  ];
  p['Collectes liées'] = `${ag[0]!['unique id']} , ${ag[2]!['unique id']}`;
  return {
    entreprises: [
      entreprise(),
      entreprise({
        'Raison sociale': 'Maison Bêta',
        SIRET: '0',
        'Email de contact': 'a@maison-beta.example',
      }),
    ],
    agences: [gamma],
    utilisateurs: [utilisateur()],
    lieux: [
      lieu(),
      lieu({
        adresse: '5 quai des Fixtures, 69002 Lyon',
        'Nom du lieu': 'Pavillon Iota',
      }),
    ],
    points_depot: [
      pointDepot(),
      pointDepot({ Nom: 'Exutoire Lambda', Type: 'DECHET' }),
    ],
    transporteurs: [velo, camion],
    contacts: [
      contact(),
      contact({ Numero: 'xx' }),
      contact({ PrenomNom: 'Alex Surplace', Numero: '0600000021' }),
    ],
    packs: [p],
    abonnements: [abonnement()],
    poids_zd: [pesees, poids({})],
    collectes_ag: ag,
    collectes_zd: [
      collecte({
        Type: 'DECHET',
        'Poids déchets': pesees['unique id']!,
        Transporteur: camion['unique id']!,
        'Point de dépot': 'Exutoire Lambda',
      }),
      collecte({
        Type: 'DECHET',
        'User entreprise': 'Maison Bêta',
        Lieu: '5 quai des Fixtures, 69002 Lyon',
      }),
    ],
  };
}

const ADRESSE_TEST = process.env.MIGRATION_BUBBLE_TEST_DATABASE_URL;

describe.skipIf(!ADRESSE_TEST)(
  'M5.3 / répétition sur base jetable — import, rejeu, checks, remise à zéro',
  () => {
    const dossierSortie = mkdtempSync(join(tmpdir(), 'repetition-inventee-'));
    const options = {
      adresseBase: ADRESSE_TEST,
      dossierExports: ecrireExports(exportsInventes()),
      dossierSortie,
      dossierDecisions: dossierSortie,
      fichierCache: join(dossierSortie, 'cache-adresses.json'),
      appliquerTypesProposes: true,
      situerLesLieux: false,
    };
    const compter = async (client: Requeteur, sql: string) =>
      Number(
        (await client.query(`SELECT count(*) AS n FROM ${sql}`)).rows[0]!.n,
      );

    it('import, rejeu sans rien créer, checks verts, sabotage détecté, remise à zéro', async () => {
      const client = await connecter(ADRESSE_TEST);
      try {
        const presente = (
          await client.query(
            `SELECT to_regclass('migration.id_map') IS NOT NULL AS p`,
          )
        ).rows[0]!.p;
        if (presente && (await compter(client, 'migration.id_map')) > 0)
          throw new Error(
            'La base porte déjà un import : la remettre à zéro avant ce test.',
          );

        // 1. Premier passage.
        const premier = await importer(options);
        const ecrit = Object.fromEntries(
          premier.ecritures.map((e) => [e.table.replace('plateforme.', ''), e]),
        );
        expect(ecrit.collectes).toMatchObject({
          lues: 10,
          inserees: 10,
          modifiees: 0,
        });
        expect(ecrit.evenements!.inserees).toBe(10);
        expect(ecrit.collecte_flux!.inserees).toBe(3);
        // Les 4 dons clôturés, dont celui que portent les deux fiches historiques.
        expect(ecrit.attributions_antgaspi!.inserees).toBe(4);
        expect(ecrit.associations!.inserees).toBe(2);
        expect(ecrit.transporteurs!.inserees).toBe(3);
        // Recopiées par le déclencheur de la base à l'insertion des collectes : identiques au plan.
        expect(ecrit.collecte_contacts).toMatchObject({
          inserees: 0,
          modifiees: 0,
          inchangees: 10,
        });
        expect(premier.rejets).toMatchObject({
          'collecte — date de collecte illisible': 1,
        });
        expect(premier.co2).toEqual({ antiGaspi: 4, zeroDechet: 2 });
        expect(premier.comptes['shared.prestataires']).toEqual({
          avant: 0,
          apres: 2,
        });
        for (const table of [
          'plateforme.outbox_events',
          'plateforme.jobs_pdf',
          'plateforme.emails_envoyes',
          'plateforme.alertes_admin',
          'plateforme.audit_log',
          'plateforme.factures',
        ])
          expect(premier.comptes[table]!.apres).toBe(
            premier.comptes[table]!.avant,
          );

        // 2. Rejeu : rien d'inséré, rien de modifié, aucune ligne en plus.
        const rejeu = await importer(options);
        for (const e of rejeu.ecritures)
          expect(e).toMatchObject({
            inserees: 0,
            modifiees: 0,
            inchangees: e.lues,
          });
        expect(rejeu.correspondances).toEqual({
          inserees: 0,
          modifiees: 0,
          disparues: 0,
        });
        expect(rejeu.co2).toEqual({ antiGaspi: 0, zeroDechet: 0 });
        for (const [table, n] of Object.entries(rejeu.comptes))
          expect([table, n.apres]).toEqual([table, n.avant]);

        // 3. État en base : ce que les fonctions et déclencheurs de la base ont calculé.
        const { rows } = await client.query(
          `SELECT e.reference_affaire, c.type::text, c.statut::text, c.pax, c.historique_partiel,
                c.co2_evite_kg::float8 AS co2_evite, c.taux_recyclage IS NOT NULL AS taux,
                c.pack_antgaspi_id IS NOT NULL AS pack, e.date_evenement::text AS jour,
                c.type_evenement_id = e.type_evenement_id AS meme_type,
                k.contact_principal_nom, c.informations_supplementaires
           FROM plateforme.collectes c
           JOIN plateforme.evenements e ON e.id = c.evenement_id
           JOIN plateforme.collecte_contacts k ON k.collecte_id = c.id
          ORDER BY c.date_collecte, c.created_at, c.id`,
        );
        expect(rows.every((r) => r.meme_type === true)).toBe(true);
        // CO₂ évité = repas × facteur en vigueur dans la base (9 kg → 20 repas ; 12,6 kg → 28 repas).
        const facteur = Number(
          (
            await client.query(
              `SELECT facteur_co2_evite_par_repas_kg AS f FROM plateforme.parametres_facteurs_co2_ag WHERE actif ORDER BY date_maj DESC LIMIT 1`,
            )
          ).rows[0]!.f,
        );
        const ancienne = rows[0]!;
        expect(ancienne).toMatchObject({
          jour: '2020-03-03',
          contact_principal_nom: '—',
          informations_supplementaires: null,
        });
        expect(ancienne.co2_evite).toBeCloseTo(20 * facteur, 2);
        const don = rows.find(
          (r) => r.pack === true && r.statut === 'cloturee',
        )!;
        expect(don).toMatchObject({ pax: 120 });
        expect(don.co2_evite).toBeCloseTo(28 * facteur, 2);
        expect(
          rows
            .filter((r) => r.type === 'zero_dechet')
            .map((r) => r.taux)
            .sort(),
        ).toEqual([false, true]);
        expect(rows.find((r) => r.statut === 'annulee')!.jour).toBeNull();
        // Sans poids dans Bubble : « sans excédent », motif dédié, aucune attribution.
        expect(
          (
            await client.query(
              `SELECT c.statut::text, c.aucun_repas_motif, c.co2_evite_kg,
                      (SELECT count(*)::int FROM plateforme.attributions_antgaspi a WHERE a.collecte_id = c.id) AS attributions
                 FROM plateforme.collectes c JOIN plateforme.evenements e ON e.id = c.evenement_id
                WHERE e.reference_affaire = 'SANS-POIDS'`,
            )
          ).rows,
        ).toEqual([
          {
            statut: 'realisee_sans_collecte',
            aucun_repas_motif: MOTIF_SANS_POIDS,
            co2_evite_kg: null,
            attributions: 0,
          },
        ]);
        // Le don de 7 kg sans association ni transporteur : attribué aux deux fiches inactives.
        expect(
          (
            await client.query(
              `SELECT s.nom AS association, s.actif AS association_active,
                      t.nom AS transporteur, t.actif AS transporteur_actif,
                      t.prestataire_logistique_id IS NULL AS sans_prestataire,
                      a.volume_repas_realise
                 FROM plateforme.attributions_antgaspi a
                 JOIN plateforme.associations s ON s.id = a.association_id
                 JOIN plateforme.transporteurs t ON t.id = a.transporteur_id
                WHERE a.poids_repas_kg = 7`,
            )
          ).rows,
        ).toEqual([
          {
            association: NOM_ASSOCIATION_HISTORIQUE,
            association_active: false,
            transporteur: NOM_TRANSPORTEUR_HISTORIQUE,
            transporteur_actif: false,
            sans_prestataire: true,
            volume_repas_realise: 16,
          },
        ]);
        const pack = (
          await client.query(
            `SELECT credits_consommes, credits_restants, statut::text FROM plateforme.packs_antgaspi WHERE type_pack = 'pack_10'`,
          )
        ).rows[0];
        expect(pack).toEqual({
          credits_consommes: 2,
          credits_restants: 8,
          statut: 'actif',
        });
        expect(
          await compter(
            client,
            `plateforme.lieux WHERE controle_acces_requis_default`,
          ),
        ).toBe(1);
        expect(
          await compter(
            client,
            `plateforme.organisations_domaines_email WHERE verifie_at IS NOT NULL`,
          ),
        ).toBe(2);
        expect(
          await compter(
            client,
            `pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'plateforme' AND NOT t.tgisinternal AND t.tgenabled <> 'O'`,
          ),
        ).toBe(0);

        // 4. Checks : tous les bloquants verts.
        const resultats = await jouerChecks(client);
        expect(
          resultats
            .filter((r) => r.nature === 'bloquant' && r.anomalies > 0)
            .map((r) => r.code),
        ).toEqual([]);
        expect(
          resultats.find((r) => r.code === 'D1')!.anomalies,
        ).toBeGreaterThan(0);

        // 5. Sabotage, dans une transaction annulée : chaque défaut allume son check.
        const rouges = async (sabotage: string) => {
          await client.query('BEGIN');
          try {
            await client.query(`SET LOCAL session_replication_role = replica`);
            await client.query(sabotage);
            return (await jouerChecks(client))
              .filter((r) => r.nature === 'bloquant' && r.anomalies > 0)
              .map((r) => r.code);
          } finally {
            await client.query('ROLLBACK');
          }
        };
        expect(
          await rouges(
            `DELETE FROM plateforme.collecte_flux WHERE poids_reel_kg = 3`,
          ),
        ).toEqual(['A7', 'B5']);
        expect(
          await rouges(
            `UPDATE plateforme.packs_antgaspi SET credits_consommes = credits_consommes + 1 WHERE type_pack = 'pack_10'`,
          ),
        ).toEqual(['B2']);
        expect(
          await rouges(
            `UPDATE plateforme.attributions_antgaspi SET poids_repas_kg = poids_repas_kg + 1`,
          ),
        ).toEqual(['B6', 'B7']);
        expect(
          await rouges(
            `UPDATE plateforme.collectes SET historique_partiel = false`,
          ),
        ).toEqual(['C8', 'E4']);
        // Un don clôturé sans son attribution : poids manquant, attribution manquante, CO₂ faux.
        expect(
          await rouges(
            `DELETE FROM plateforme.attributions_antgaspi WHERE poids_repas_kg = 7`,
          ),
        ).toEqual(['B6', 'C9', 'E7']);
        // Une anti-gaspi sans poids laissée « clôturée » au lieu de « sans excédent ».
        expect(
          await rouges(
            `UPDATE plateforme.collectes SET statut = 'cloturee' WHERE aucun_repas_motif = '${MOTIF_SANS_POIDS}'`,
          ),
        ).toEqual(['A8', 'C9', 'E7']);
        // Fiches historiques : jamais actives, jamais à la place d'une fiche que l'export désigne.
        expect(
          await rouges(
            `UPDATE plateforme.associations SET actif = true WHERE nom = '${NOM_ASSOCIATION_HISTORIQUE}'`,
          ),
        ).toEqual(['E11']);
        expect(
          await rouges(
            `UPDATE plateforme.transporteurs SET actif = true WHERE nom = '${NOM_TRANSPORTEUR_HISTORIQUE}'`,
          ),
        ).toEqual(['E11']);
        expect(
          await rouges(
            `UPDATE plateforme.attributions_antgaspi
                SET association_id = (SELECT id FROM plateforme.associations WHERE nom = '${NOM_ASSOCIATION_HISTORIQUE}')
              WHERE poids_repas_kg = 4`,
          ),
        ).toEqual(['E11']);
        expect(
          await rouges(
            `UPDATE plateforme.attributions_antgaspi
                SET transporteur_id = (SELECT id FROM plateforme.transporteurs WHERE nom = '${NOM_TRANSPORTEUR_HISTORIQUE}')
              WHERE poids_repas_kg = 4`,
          ),
        ).toEqual(['E11']);
        expect(
          await rouges(
            `UPDATE plateforme.collectes SET co2_evite_kg = NULL WHERE type = 'anti_gaspi'`,
          ),
        ).toEqual(['E7']);
        expect(
          await rouges(
            `UPDATE plateforme.collecte_contacts SET contact_principal_nom = 'Alex Surplace'`,
          ),
        ).toEqual(['E8']);
        // Un numéro qu'aucun contact repris ne porte ; un numéro sur une collecte de plus de 5 ans.
        expect(
          await rouges(
            `UPDATE plateforme.collecte_contacts SET contact_secours_telephone = '+33699999999'`,
          ),
        ).toEqual(['C10', 'E8']);
        expect(
          await rouges(
            `UPDATE plateforme.collecte_contacts SET contact_secours_telephone = '+33600000021' WHERE contact_principal_nom = '—'`,
          ),
        ).toEqual(['E8']);
        expect(
          await rouges(
            `UPDATE plateforme.collectes SET statut_tms = 'acceptee' WHERE statut = 'programmee'`,
          ),
        ).toEqual(['E9']);
        expect(
          await rouges(`DELETE FROM plateforme.collecte_contacts`),
        ).toEqual(['C1']);
        expect(
          await rouges(
            `UPDATE plateforme.organisations_domaines_email SET verifie_at = NULL`,
          ),
        ).toEqual(['A5']);
        expect(
          await rouges(
            `DELETE FROM migration.rejets WHERE source_type = 'collecte'`,
          ),
        ).toEqual(['A1', 'A2']);
        expect(
          await rouges(
            `DELETE FROM migration.id_map WHERE source_type = 'evenement'`,
          ),
        ).toEqual(['A3']);
        expect(
          await rouges(
            `DELETE FROM migration.id_map WHERE source_type = 'agence'`,
          ),
        ).toEqual(['A4']);
        expect(
          await rouges(
            `DELETE FROM migration.id_map WHERE source_type = 'transporteur'`,
          ),
        ).toEqual(['A6']);
        expect(
          await rouges(
            `UPDATE plateforme.packs_antgaspi SET credits_initiaux = credits_initiaux + 1 WHERE type_pack = 'pack_10'`,
          ),
        ).toEqual(['B1']);
        expect(
          await rouges(
            `UPDATE plateforme.collectes SET taux_recyclage = NULL WHERE type = 'zero_dechet'`,
          ),
        ).toEqual(['E2']);
        expect(
          await rouges(
            `UPDATE plateforme.collectes SET date_collecte = DATE '2031-01-01' WHERE statut = 'annulee'`,
          ),
        ).toEqual(['E3']);
        expect(
          await rouges(
            `UPDATE plateforme.collectes SET statut = 'realisee_sans_collecte' WHERE type = 'zero_dechet'`,
          ),
        ).toEqual(['E5']);
        expect(
          await rouges(
            `UPDATE plateforme.evenements SET traiteur_operationnel_organisation_id = (SELECT id FROM plateforme.organisations WHERE nom = 'Maison Bêta')
            WHERE traiteur_operationnel_organisation_id = (SELECT id FROM plateforme.organisations WHERE nom = 'Traiteur Alpha')`,
          ),
          // C10 : la collecte d'agence garde un numéro du carnet de Traiteur Alpha, devenu étranger.
        ).toEqual(['C10', 'E1']);
        // B3 (pack sur-consommé) et B4 (deux packs actifs) ne se sabotent pas : la base les
        // interdit elle-même (contrainte chk_pack_credits_limite, index uniq_pack_actif_par_org).
        await expect(
          rouges(
            `UPDATE plateforme.packs_antgaspi SET credits_consommes = credits_initiaux + 1`,
          ),
        ).rejects.toThrow(/chk_pack_credits_limite/);
        await expect(
          rouges(`UPDATE plateforme.packs_antgaspi SET statut = 'actif'`),
        ).rejects.toThrow(/uniq_pack_actif_par_org/);

        expect(
          await rouges(
            `UPDATE plateforme.collectes SET origine = 'plateforme' WHERE statut = 'annulee'`,
          ),
        ).toEqual(['E10']);

        // Emails gardés à part pour la réattribution : un par événement, ici celui de contact du traiteur.
        expect(await compter(client, 'migration.auteurs_evenements')).toBe(10);
        expect(
          await compter(
            client,
            `migration.auteurs_evenements WHERE provenance = 'contact_traiteur'`,
          ),
        ).toBe(10);
        expect(premier.auteurs).toEqual({
          evenements: 10,
          avecEmailCommercial: 0,
          avecEmailContactSeul: 10,
          sansEmail: 0,
          emailsDistincts: 2,
          emailsSurDomainePublic: 0,
          emailsHorsDomaineOrganisation: 0,
          evenementsHorsDomaineOrganisation: 0,
        });
        expect(
          await compter(
            client,
            `plateforme.collectes WHERE origine = 'migration_bubble'`,
          ),
        ).toBe(10);

        // 6. Remise à zéro : plus aucune ligne importée, référentiels intacts.
        const retirees = await remettreAZero(client);
        expect(retirees['plateforme.collectes']).toBe(10);
        expect(retirees['shared.prestataires']).toBe(2);
        for (const table of TABLES_CIBLES)
          expect([table, await compter(client, `plateforme.${table}`)]).toEqual(
            [table, 0],
          );
        expect(await compter(client, 'shared.prestataires')).toBe(0);
        expect(await compter(client, 'migration.id_map')).toBe(0);
        expect(await compter(client, 'migration.auteurs_evenements')).toBe(0);
        expect(await compter(client, 'plateforme.flux_dechets')).toBe(5);
      } finally {
        await client.end();
      }
    }, 60_000);
  },
);
