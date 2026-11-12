/**
 * M1.6 — Données du rapport de recyclage ZD (gabarit @4), rassemblées au clic
 * (décision Val 2026-10-16 : plus de rapport fabriqué par le batch).
 *
 * Données mesurées = celles figées à la clôture (collecte, collecte_flux) ;
 * annexe (page 2) = numéro et date du bordereau, référentiel `flux_dechets`
 * (code déchet, exutoire habituel, code R/D), forfait transport du snapshot ;
 * noms et logos lus au moment du clic (BL-P2-18, BL-P2-19). Décisions Val du
 * 2026-11-12 : l'annexe remplace le bordereau de pesée (C1) et suit le rapport
 * quel que soit le demandeur (C2) ; les 5 flux toujours imprimés (C5).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Logo = clé R2 de la cascade, inlinée en data URI via getObjectBytes.
const getObjectBytes = vi.fn();
vi.mock('@/lib/pdf/r2-client.js', () => ({
  getObjectBytes: (...a: unknown[]) => getObjectBytes(...a),
}));

import {
  buildEquivalences,
  communeDeLAdresse,
  construirePayloadRapport,
  forfaitTransport,
} from '@/lib/pdf/payload-rapport.js';

type Res = { data: unknown; error: unknown };

function makeAdmin(tables: Record<string, Res>) {
  const selects: Record<string, string> = {};
  const from = (table: string) => {
    const res = tables[table] ?? { data: null, error: null };
    const c: Record<string, unknown> = {
      select: (cols: string) => {
        selects[table] = cols;
        return c;
      },
      eq: () => c,
      order: () => c,
      limit: () => c,
      maybeSingle: () => Promise.resolve(res),
      then: (resolve: (v: Res) => unknown) => resolve(res),
    };
    return c;
  };
  return { admin: { from } as never, selects };
}

const LOGO_AGENCE = 'savr-dev/logos/a9e1c2d3-4b5c-4d6e-8f70-81a2b3c4d5e6.png';
const LOGO_TRAITEUR = 'savr-dev/logos/b8f2d3e4-5c6d-4e7f-9a81-92b3c4d5e6f7.png';

const evenement = (surcharge: Record<string, unknown> = {}) => ({
  nom_evenement: 'Gala Kaspia',
  date_evenement: '2026-06-13',
  // Pax de l'événement (tous jours et toutes collectes) : jamais imprimé, le
  // rapport imprime les convives de LA collecte (lot C2, Q5).
  pax: 1200,
  logo_client_organisateur_url: null,
  nom_client_organisateur: null,
  organisations: { nom: 'Kaspia Réceptions', type: 'traiteur', logo_url: null },
  traiteur_operationnel: null,
  client_organisateur: null,
  lieux: {
    nom: 'Grand Palais',
    adresse_acces: '3 avenue',
    code_postal: '75008',
    ville: 'Paris',
  },
  ...surcharge,
});

const BORDEREAU = {
  numero: 'BSAV-2026-00012',
  date_emission: '2026-06-14',
  date_collecte: '2026-06-13',
};

/** Référentiel `flux_dechets` (valeurs de la migration 20261004203000). */
const REFERENTIEL = [
  {
    code: 'biodechet',
    nom: 'Biodéchets',
    code_dechet_europeen: '20 01 08',
    exutoire: 'GENERIS VSG DCDT',
    exutoire_adresse:
      'ZI des Graviers, 6 avenue Winston Churchill, 94190 Villeneuve-Saint-Georges',
    code_traitement: 'R3',
    filiere_valorisation: 'methanisation',
  },
  {
    code: 'emballage',
    nom: 'Emballages',
    code_dechet_europeen: '15 01 06',
    exutoire: 'CENTRE DE TRI SELECTIF PAPREC TRIVALO 93',
    exutoire_adresse: '10 rue de la Victoire, 93150 Le Blanc-Mesnil',
    code_traitement: 'R3/R5',
    filiere_valorisation: 'recyclage',
  },
  {
    code: 'carton',
    nom: 'Cartons',
    code_dechet_europeen: '15 01 01',
    exutoire: 'TAIS VILLENEUVE LE ROI TDI',
    exutoire_adresse: '6 rue des Vœux Saint-Georges, 94290 Villeneuve-le-Roi',
    code_traitement: 'R3',
    filiere_valorisation: 'recyclage',
  },
  {
    code: 'verre',
    nom: 'Verre',
    code_dechet_europeen: '15 01 07',
    exutoire: 'REVIVAL GENNEVILLIERS TRSFT',
    exutoire_adresse: '9 route du Môle Central, 92230 Gennevilliers',
    code_traitement: 'R5',
    filiere_valorisation: 'recyclage',
  },
  {
    code: 'dechet_residuel',
    nom: 'Déchet résiduel',
    code_dechet_europeen: '20 03 01',
    exutoire: 'NOVAZUR ARGENTEUIL UVEND',
    exutoire_adresse: '2 rue du Chemin Vert, 95100 Argenteuil',
    code_traitement: 'R1',
    filiere_valorisation: 'valorisation_energetique',
  },
];

function tables(
  evt: Record<string, unknown> | null = evenement(),
  surcharge: Record<string, Res> = {},
  paxCollecte = 250,
): Record<string, Res> {
  return {
    collectes: {
      data: {
        date_collecte: '2026-06-13',
        pax: paxCollecte,
        taux_recyclage: 72.5,
        co2_evite_kg: 312,
        co2_induit_kg: 341,
        energie_primaire_evitee_kwh: 9000,
        co2_facteurs_snapshot: {
          equivalences: { km_voiture: 0.218, foyer_kwh: 4500 },
          forfait_collecte: { km: 25, fe_camion: 0.4 },
        },
        caps_appliques: { verre: 0.95, carton: 0.85 },
        evenements: evt,
      },
      error: null,
    },
    bordereaux_savr: { data: BORDEREAU, error: null },
    collecte_flux: {
      data: [
        { poids_reel_kg: 12, flux: { code: 'biodechet' } },
        { poids_reel_kg: 4, flux: { code: 'dechet_residuel' } },
        { poids_reel_kg: null, flux: { code: 'verre' } },
      ],
      error: null,
    },
    flux_dechets: { data: REFERENTIEL, error: null },
    ...surcharge,
  };
}

async function payload(t: Record<string, Res> = tables()) {
  const { admin, selects } = makeAdmin(t);
  const r = await construirePayloadRapport(admin, 'c1');
  return { r, selects };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Seules les clés du bucket de l'environnement sont lues (lib/logo-key).
  vi.stubEnv('R2_BUCKET_NAME', 'savr-dev');
  getObjectBytes.mockResolvedValue(Buffer.from([1, 2, 3]));
});
afterEach(() => vi.unstubAllEnvs());

describe('M1.6 / données du rapport @4 rassemblées au clic', () => {
  it('mesures figées à la clôture, taux de captation, équivalences, forfait transport ; induit et évité séparés, plus de net ; version sans radar', async () => {
    const { r } = await payload();
    if (!r.ok) throw new Error('attendu ok');
    const p = r.payload;
    expect(p.nom_evenement).toBe('Gala Kaspia');
    expect(p.traiteur_nom).toBe('Kaspia Réceptions');
    expect(p.date_evenement).toBe('13/06/2026');
    expect(p.lieu_nom).toBe('Grand Palais');
    expect(p.nb_pax).toBe(250);
    expect(p.taux_recyclage).toBe(72.5);
    expect(p.poids_total_kg).toBe(16);
    expect(p.co2_evite_kg).toBe(312);
    expect(p.co2_induit_kg).toBe(341);
    expect(p).not.toHaveProperty('co2_net_kg');
    expect(p.energie_primaire_evitee_kwh).toBe(9000);
    expect(p.caps_appliques).toEqual({ verre: 0.95, carton: 0.85 });
    expect(p.equivalences).toEqual({ km_voiture: 1431, foyer: 2 });
    expect(p.forfait_transport).toEqual({ km: 25, fe_camion_kg_km: 0.4 });
    expect(p.options).toEqual({ benchmark: false });
    expect(p).not.toHaveProperty('benchmark_flux');
  });

  it('C5 + C4 : les 5 flux du référentiel, non pesé = 0 kg, avec code déchet, exutoire habituel et sa commune, code R/D et filière', async () => {
    const { r } = await payload();
    if (!r.ok) throw new Error('attendu ok');
    const flux = r.payload.flux as Record<string, unknown>[];
    expect(flux.map((f) => [f.code, f.poids_kg])).toEqual([
      ['biodechet', 12],
      ['emballage', 0],
      ['carton', 0],
      ['verre', 0],
      ['dechet_residuel', 4],
    ]);
    expect(flux[1]).toEqual({
      nom: 'Emballages',
      code: 'emballage',
      poids_kg: 0,
      code_dechet_europeen: '15 01 06',
      exutoire: 'CENTRE DE TRI SELECTIF PAPREC TRIVALO 93',
      exutoire_commune: 'Le Blanc-Mesnil',
      code_traitement: 'R3/R5',
      filiere_valorisation: 'recyclage',
    });
    expect(flux[0]).toMatchObject({
      exutoire_commune: 'Villeneuve-Saint-Georges',
      code_traitement: 'R3',
      filiere_valorisation: 'methanisation',
    });
  });

  it('C1 + C2 : numéro et date d’émission du bordereau pour l’annexe, lus en service-role quel que soit le demandeur ; plus aucune copie du bordereau de pesée', async () => {
    const { r, selects } = await payload();
    if (!r.ok) throw new Error('attendu ok');
    expect(r.payload.bordereau_numero).toBe('BSAV-2026-00012');
    expect(r.payload.bordereau_date_emission).toBe('14/06/2026');
    expect(r.payload).not.toHaveProperty('bordereau');
    expect(selects.bordereaux_savr).toBe(
      'numero, date_emission, date_collecte',
    );
    expect(r.dateCollecte).toBe('13/06/2026');
    // La fonction ne reçoit plus de client du demandeur : aucune lecture sous
    // sa RLS ne peut retirer l'annexe.
    expect(construirePayloadRapport.length).toBe(2);
  });

  it('convives de LA collecte ; 0 convive (inconnu) → null, mention omise', async () => {
    // Événement de 1 200 convives, collecte de 250 : ci-dessus. Ici la lecture
    // demandée, puis une collecte reprise de Bubble à 0 convive.
    const { selects } = await payload();
    const [colonnesCollecte, embedEvenement] = String(selects.collectes).split(
      'evenements',
    );
    expect(colonnesCollecte).toMatch(/\bpax\b/);
    expect(embedEvenement).not.toMatch(/\bpax\b/);

    const { r } = await payload(tables(evenement(), {}, 0));
    if (!r.ok) throw new Error('attendu ok');
    expect(r.payload.nb_pax).toBeNull();
  });

  it('client : nom saisi à la programmation, sinon nom du compte client, sinon absent (le gabarit affiche l’événement)', async () => {
    const saisi = await payload(
      tables(
        evenement({
          nom_client_organisateur: '  Groupe Lumière ',
          client_organisateur: { nom: 'Lumière SAS', logo_url: null },
        }),
      ),
    );
    if (!saisi.r.ok) throw new Error('attendu ok');
    expect(saisi.r.payload.client_nom).toBe('Groupe Lumière');

    const compte = await payload(
      tables(
        evenement({
          nom_client_organisateur: '   ',
          client_organisateur: { nom: 'Lumière SAS', logo_url: null },
        }),
      ),
    );
    if (!compte.r.ok) throw new Error('attendu ok');
    expect(compte.r.payload.client_nom).toBe('Lumière SAS');

    const aucun = await payload();
    if (!aucun.r.ok) throw new Error('attendu ok');
    expect(aucun.r.payload.client_nom).toBeUndefined();
  });

  it('BL-P2-19 : agence programmatrice → son logo dans l’emplacement client ; traiteur opérationnel → le sien, et son nom', async () => {
    const { r } = await payload(
      tables(
        evenement({
          organisations: {
            nom: 'Agence Événement',
            type: 'agence',
            logo_url: LOGO_AGENCE,
          },
          traiteur_operationnel: {
            nom: 'Traiteur Op',
            logo_url: LOGO_TRAITEUR,
          },
        }),
      ),
    );
    if (!r.ok) throw new Error('attendu ok');
    expect(getObjectBytes).toHaveBeenCalledWith(LOGO_AGENCE);
    expect(getObjectBytes).toHaveBeenCalledWith(LOGO_TRAITEUR);
    expect(r.payload.logo_client_url).toMatch(/^data:image\/png;base64,/);
    expect(r.payload.logo_traiteur_url).toMatch(/^data:image\/png;base64,/);
    expect(r.payload.traiteur_nom).toBe('Traiteur Op');
    expect(r.payload).not.toHaveProperty('logo_url');
  });

  it('deux logos lourds → le traiteur cède sa place : le payload reste sous les 2 Mo acceptés par le renderer', async () => {
    // 900 Ko chacun : sous le plafond unitaire (1 Mo), mais 2,4 Mo de base64 à deux.
    getObjectBytes.mockResolvedValue(Buffer.alloc(900_000, 7));
    const { r } = await payload(
      tables(
        evenement({
          organisations: {
            nom: 'Agence Événement',
            type: 'agence',
            logo_url: LOGO_AGENCE,
          },
          traiteur_operationnel: {
            nom: 'Traiteur Op',
            logo_url: LOGO_TRAITEUR,
          },
        }),
      ),
    );
    if (!r.ok) throw new Error('attendu ok');
    expect(r.payload.logo_client_url).toMatch(/^data:image\/png;base64,/);
    expect(r.payload.logo_traiteur_url).toBeUndefined();
    expect(
      JSON.stringify({ type: 'rapport-recyclage-zd', data: r.payload }).length,
    ).toBeLessThan(2 * 1024 * 1024);
  });

  it('collecte sans événement ou sans bordereau → INCOMPLET ; lecture en échec → DB_ERROR (jamais un rapport vide)', async () => {
    expect((await payload(tables(null))).r).toEqual({
      ok: false,
      code: 'INCOMPLET',
    });
    expect(
      (
        await payload(
          tables(evenement(), { bordereaux_savr: { data: null, error: null } }),
        )
      ).r,
    ).toEqual({ ok: false, code: 'INCOMPLET' });
    for (const table of ['collecte_flux', 'flux_dechets']) {
      const panne = await payload(
        tables(evenement(), {
          [table]: { data: null, error: { message: 'timeout' } },
        }),
      );
      expect(panne.r).toMatchObject({ ok: false, code: 'DB_ERROR' });
    }
  });

  it('les colonnes lues existent dans les requêtes (embeds qualifiés par leur FK)', async () => {
    const { selects } = await payload();
    expect(selects.collectes).toContain('caps_appliques');
    expect(selects.collectes).toContain('nom_client_organisateur');
    expect(selects.collectes).toContain('organisations!organisation_id');
    expect(selects.collectes).toContain(
      'traiteur_operationnel:organisations!traiteur_operationnel_organisation_id',
    );
    expect(selects.flux_dechets).toBe(
      'code, nom, code_dechet_europeen, exutoire, exutoire_adresse, code_traitement, filiere_valorisation',
    );
    expect(selects.collecte_flux).toBe('poids_reel_kg, flux:flux_id ( code )');
  });
});

describe('M1.6 / annexe du rapport @4 : commune de l’exutoire et forfait transport', () => {
  it('commune = ce qui suit la dernière virgule, sans le code postal ; autre forme → null', () => {
    expect(
      communeDeLAdresse(
        'ZI des Graviers, 6 avenue Winston Churchill, 94190 Villeneuve-Saint-Georges',
      ),
    ).toBe('Villeneuve-Saint-Georges');
    expect(
      communeDeLAdresse('9 route du Môle Central, 92230 Gennevilliers'),
    ).toBe('Gennevilliers');
    expect(communeDeLAdresse('Paris')).toBeNull();
    expect(communeDeLAdresse(null)).toBeNull();
  });

  it('forfait transport lu dans le snapshot figé ; absent ou invalide → null (rien d’inventé)', () => {
    expect(
      forfaitTransport({ forfait_collecte: { km: 25, fe_camion: 0.4 } }),
    ).toEqual({
      km: 25,
      fe_camion_kg_km: 0.4,
    });
    expect(forfaitTransport({ forfait_collecte: { km: 25 } })).toBeNull();
    expect(forfaitTransport({ equivalences: {} })).toBeNull();
    expect(forfaitTransport(null)).toBeNull();
  });
});

describe('M1.6 / buildEquivalences (§12 §1.2)', () => {
  it('convertit les FACTEURS figés en comptes (km voiture, foyers) ; plus de repas bœuf', () => {
    expect(
      buildEquivalences(312, 9000, {
        equivalences: { km_voiture: 0.218, foyer_kwh: 4500, repas_boeuf: 7 },
      }),
    ).toEqual({ km_voiture: 1431, foyer: 2 });
  });

  it('retourne undefined sans CO₂ évité ou sans snapshot ; null par équivalence sans facteur', () => {
    expect(buildEquivalences(null, 1, { equivalences: {} })).toBeUndefined();
    expect(buildEquivalences(1, 1, null)).toBeUndefined();
    expect(
      buildEquivalences(100, null, { equivalences: { km_voiture: 0 } }),
    ).toEqual({ km_voiture: null, foyer: null });
  });
});
