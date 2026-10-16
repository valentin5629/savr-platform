/**
 * M1.6 — Données du rapport de recyclage ZD (gabarit @3), rassemblées au clic
 * (décision Val 2026-10-16 : plus de rapport fabriqué par le batch).
 *
 * Données mesurées = celles figées à la clôture (collecte, collecte_flux) ;
 * page 2 = l'instantané `bordereaux_savr` du batch J+1 ; noms et logos lus au
 * moment du clic (BL-P2-18, BL-P2-19).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Logo = clé R2 de la cascade, inlinée en data URI via getObjectBytes.
const getObjectBytes = vi.fn();
vi.mock('@/lib/pdf/r2-client.js', () => ({
  getObjectBytes: (...a: unknown[]) => getObjectBytes(...a),
}));

import {
  buildEquivalences,
  construirePayloadRapport,
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
  pax: 250,
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
  producteur_raison_sociale: 'Kaspia SAS',
  producteur_siret: '12345678900012',
  producteur_adresse: '2 rue Y, Paris',
  transporteur_nom: 'Strike Transport',
  exutoire_nom: 'Prestataire Savr',
  detail_flux: [
    { nom: 'Biodéchets', poids_kg: 12, nb_bacs: 3, equivalent_roll: null },
    { nom: 'Déchet résiduel', poids_kg: 4, nb_bacs: 1, equivalent_roll: null },
  ],
  poids_total_kg: 16,
};

function tables(
  evt: Record<string, unknown> | null = evenement(),
  surcharge: Record<string, Res> = {},
): Record<string, Res> {
  return {
    collectes: {
      data: {
        date_collecte: '2026-06-13',
        taux_recyclage: 72.5,
        co2_evite_kg: 312,
        co2_induit_kg: 41,
        co2_net_kg: -271,
        energie_primaire_evitee_kwh: 9000,
        co2_facteurs_snapshot: {
          equivalences: { km_voiture: 0.218, foyer_kwh: 4500 },
        },
        caps_appliques: { verre: 0.95, carton: 0.85 },
        evenements: evt,
      },
      error: null,
    },
    bordereaux_savr: { data: BORDEREAU, error: null },
    collecte_flux: {
      data: [
        { poids_reel_kg: 12, flux: { nom: 'Biodéchets', code: 'biodechet' } },
        {
          poids_reel_kg: 4,
          flux: { nom: 'Déchet résiduel', code: 'dechet_residuel' },
        },
        { poids_reel_kg: null, flux: { nom: 'Verre', code: 'verre' } },
      ],
      error: null,
    },
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

describe('M1.6 / données du rapport @3 rassemblées au clic', () => {
  it('mesures figées à la clôture, flux pesés avec leur code, taux de captation, équivalences ; version sans radar', async () => {
    const { r } = await payload();
    if (!r.ok) throw new Error('attendu ok');
    const p = r.payload;
    expect(p.nom_evenement).toBe('Gala Kaspia');
    expect(p.traiteur_nom).toBe('Kaspia Réceptions');
    expect(p.date_evenement).toBe('13/06/2026');
    expect(p.lieu_nom).toBe('Grand Palais');
    expect(p.lieu_adresse).toBe('3 avenue 75008 Paris');
    expect(p.nb_pax).toBe(250);
    expect(p.taux_recyclage).toBe(72.5);
    // Flux non pesé (poids NULL) absent ; total = somme des pesées.
    expect(p.flux).toEqual([
      { nom: 'Biodéchets', code: 'biodechet', poids_kg: 12 },
      { nom: 'Déchet résiduel', code: 'dechet_residuel', poids_kg: 4 },
    ]);
    expect(p.poids_total_kg).toBe(16);
    expect(p.co2_evite_kg).toBe(312);
    expect(p.co2_net_kg).toBe(-271);
    expect(p.caps_appliques).toEqual({ verre: 0.95, carton: 0.85 });
    expect(p.equivalences).toEqual({ km_voiture: 1431, foyer: 2 });
    expect(p.options).toEqual({ benchmark: false });
    expect(p).not.toHaveProperty('benchmark_flux');
  });

  it('page 2 = instantané du bordereau émis par le batch (numéro, dates, producteur, transporteur, pesées)', async () => {
    const { r } = await payload();
    if (!r.ok) throw new Error('attendu ok');
    expect(r.payload.bordereau).toEqual({
      numero: 'BSAV-2026-00012',
      date_emission: '14/06/2026',
      date_collecte: '13/06/2026',
      date_evenement: '13/06/2026',
      nom_evenement: 'Gala Kaspia',
      lieu_nom: 'Grand Palais',
      lieu_adresse: '3 avenue 75008 Paris',
      producteur_raison_sociale: 'Kaspia SAS',
      producteur_siret: '12345678900012',
      producteur_adresse: '2 rue Y, Paris',
      transporteur_nom: 'Strike Transport',
      exutoire_nom: 'Prestataire Savr',
      nb_pax: 250,
      flux: BORDEREAU.detail_flux,
      poids_total_kg: 16,
    });
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
    const panne = await payload(
      tables(evenement(), {
        collecte_flux: { data: null, error: { message: 'timeout' } },
      }),
    );
    expect(panne.r).toMatchObject({ ok: false, code: 'DB_ERROR' });
  });

  it('les colonnes lues existent dans les requêtes (embeds qualifiés par leur FK)', async () => {
    const { selects } = await payload();
    expect(selects.collectes).toContain('caps_appliques');
    expect(selects.collectes).toContain('nom_client_organisateur');
    expect(selects.collectes).toContain('organisations!organisation_id');
    expect(selects.collectes).toContain(
      'traiteur_operationnel:organisations!traiteur_operationnel_organisation_id',
    );
    expect(selects.bordereaux_savr).toContain('detail_flux');
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
