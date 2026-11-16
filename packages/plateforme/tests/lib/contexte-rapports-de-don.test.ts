/**
 * Contexte visuel des deux « Rapport de don » (gabarits attestation-don@5 et
 * rapport-evenement-sans-excedent@3, maquettes validées par Val le 2026-11-16),
 * lu par le worker PDF au rendu : lieu, convives, logos, association, photo
 * cochée, facteur CO₂e ; mandant et associations les plus proches.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const logoKeyToDataUri = vi.hoisted(() =>
  vi.fn(async (cle: string | null | undefined) =>
    cle ? `data:image/png;base64,${cle}` : null,
  ),
);
const getObjectBytes = vi.hoisted(() =>
  vi.fn(async (_cle: string) => Buffer.from('photo')),
);
vi.mock('../../src/lib/pdf/logo-inline.js', async (orig) => ({
  ...(await orig<object>()),
  logoKeyToDataUri,
  makeLogoResolver: () => logoKeyToDataUri,
}));
vi.mock('../../src/lib/pdf/r2-client.js', () => ({ getObjectBytes }));

import {
  MAX_PHOTO_BYTES,
  associationsLesPlusProches,
  completerRapportDeDon,
  completerRapportSansExcedent,
  photoCochee,
} from '../../src/lib/pdf/contexte-rapports-de-don.js';

type Reponse = { data?: unknown; error?: unknown };

/** Client Supabase factice : une réponse par table, chaînes de filtres ignorées. */
function sb(par: Record<string, Reponse>) {
  const lectures: string[] = [];
  const requete = (table: string) => {
    lectures.push(table);
    const r = par[table] ?? { data: null };
    const reponse = { data: r.data ?? null, error: r.error ?? null };
    const c: Record<string, unknown> = {
      maybeSingle: () => Promise.resolve(reponse),
      then: (ok: (v: unknown) => unknown) => Promise.resolve(reponse).then(ok),
    };
    for (const m of ['select', 'eq', 'is', 'not', 'order', 'limit', 'in'])
      c[m] = () => c;
    return c;
  };
  return {
    lectures,
    from: vi.fn(requete),
    schema: () => ({ from: requete }),
  };
}

const evenement = {
  logo_client_organisateur_url: 'cle-client',
  organisations: {
    nom: 'Maison Exemple',
    type: 'traiteur',
    logo_url: 'cle-traiteur',
  },
  traiteur_operationnel: null,
  client_organisateur: null,
};

const PHOTO = {
  bucket: 'savr-dev',
  key: 'photos/collectes/c1/p1.jpg',
  content_type: 'image/jpeg',
};

beforeEach(() => {
  logoKeyToDataUri.mockClear();
  getObjectBytes.mockReset();
  getObjectBytes.mockImplementation(async () => Buffer.from('photo'));
});

describe('completerRapportDeDon — contexte visuel du rapport de don', () => {
  const base = (over: Record<string, Reponse> = {}) =>
    sb({
      attestations_don: {
        data: { collecte_id: 'c1', association_id: 'a1', poids_kg: '20.000' },
      },
      collectes: {
        data: {
          pax: 420,
          co2_facteurs_snapshot: { facteur_co2_evite_par_repas_kg: '2.04' },
          evenements: { ...evenement, lieux: { nom: 'Pavillon des Lilas' } },
        },
      },
      associations: {
        data: {
          nom: 'Solidarité',
          ville: 'Paris 11e',
          logo_url: 'cle-asso',
          description_rapport_impact: 'Repas chauds.',
        },
      },
      fichiers: { data: [PHOTO] },
      ...over,
    });

  it('lieu, convives, logos client et traiteur, association, photo, facteur de la collecte', async () => {
    const p = await completerRapportDeDon(base() as never, 'att-1', {
      numero: 'x',
      logo_client_url: null,
      poids_kg: 18.9,
    });
    expect(p).toMatchObject({
      numero: 'x',
      lieu_nom: 'Pavillon des Lilas',
      nb_pax: 420,
      logo_client_url: 'data:image/png;base64,cle-client',
      logo_traiteur_url: 'data:image/png;base64,cle-traiteur',
      association_ville: 'Paris 11e',
      association_description: 'Repas chauds.',
      association_logo_url: 'data:image/png;base64,cle-asso',
      photo_url: `data:image/jpeg;base64,${Buffer.from('photo').toString('base64')}`,
      co2_facteur_repas_kg: 2.04,
    });
    // Contenu préparé par le lot (champ logo présent) : son poids est gardé.
    expect(p.poids_kg).toBe(18.9);
  });

  it('poids corrigé : contenu du trigger (sans champ logo) → poids de la nouvelle version', async () => {
    const p = await completerRapportDeDon(base() as never, 'att-2', {
      poids_kg: 18.9,
    });
    expect(p.poids_kg).toBe(20);
  });

  it('poids corrigé gardé même si la lecture de la collecte échoue', async () => {
    const p = await completerRapportDeDon(
      base({ collectes: { error: { message: 'x' } } }) as never,
      'att-2',
      { poids_kg: 18.9 },
    );
    expect(p.poids_kg).toBe(20);
    expect(p).not.toHaveProperty('lieu_nom');
  });

  it('attestation introuvable ou lecture en échec → contenu inchangé, jamais d’erreur', async () => {
    const payload = { numero: 'x' };
    expect(
      await completerRapportDeDon(
        sb({ attestations_don: { error: { message: 'x' } } }) as never,
        'att-3',
        payload,
      ),
    ).toBe(payload);
    expect(await completerRapportDeDon(sb({}) as never, 'att-3', payload)).toBe(
      payload,
    );
  });

  it('convives 0 (reprise Bubble) → aucune pastille ; facteur absent → null', async () => {
    const p = await completerRapportDeDon(
      base({
        collectes: {
          data: { pax: 0, co2_facteurs_snapshot: null, evenements: null },
        },
      }) as never,
      'att-1',
      { logo_client_url: null },
    );
    expect(p.nb_pax).toBeNull();
    expect(p.co2_facteur_repas_kg).toBeNull();
  });
});

describe('photoCochee — photo choisie par Savr pour le client', () => {
  it('lit l’objet du dossier de la collecte, en data URI', async () => {
    const uri = await photoCochee(
      sb({ fichiers: { data: [PHOTO] } }) as never,
      'c1',
    );
    expect(getObjectBytes).toHaveBeenCalledWith(
      'savr-dev/photos/collectes/c1/p1.jpg',
    );
    expect(uri).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('aucune photo cochée → null', async () => {
    expect(
      await photoCochee(sb({ fichiers: { data: [] } }) as never, 'c1'),
    ).toBeNull();
  });

  it('clé hors du dossier de CETTE collecte ou type non image → null, sans lecture R2', async () => {
    for (const ligne of [
      { ...PHOTO, key: 'photos/collectes/c2/p1.jpg' },
      { ...PHOTO, key: 'factures/c1/f.pdf' },
      { ...PHOTO, content_type: 'application/pdf' },
      { ...PHOTO, content_type: 'image/svg+xml' },
    ]) {
      expect(
        await photoCochee(sb({ fichiers: { data: [ligne] } }) as never, 'c1'),
      ).toBeNull();
    }
    expect(getObjectBytes).not.toHaveBeenCalled();
  });

  it('photo trop lourde pour le corps du renderer → null ; lecture R2 en échec → null', async () => {
    getObjectBytes.mockResolvedValueOnce(Buffer.alloc(MAX_PHOTO_BYTES + 1));
    expect(
      await photoCochee(sb({ fichiers: { data: [PHOTO] } }) as never, 'c1'),
    ).toBeNull();
    getObjectBytes.mockRejectedValueOnce(new Error('bucket refusé'));
    expect(
      await photoCochee(sb({ fichiers: { data: [PHOTO] } }) as never, 'c1'),
    ).toBeNull();
  });
});

describe('associationsLesPlusProches — rapport sans excédent (Val 2026-11-16)', () => {
  const asso = (
    nom: string,
    lat: number | null,
    lon: number | null,
    region = 'idf',
  ) => ({
    nom,
    ville: null,
    logo_url: null,
    description_rapport_impact: null,
    latitude: lat,
    longitude: lon,
    region,
  });
  // Pavillon des Lilas (Paris 12e) environ.
  const lieu = { latitude: 48.84, longitude: 2.4, region: 'idf' };

  it('les deux plus proches du lieu, dans l’ordre de distance', () => {
    const r = associationsLesPlusProches(lieu, [
      asso('Lyon', 45.76, 4.84),
      asso('Montreuil', 48.86, 2.44),
      asso('Saint-Denis', 48.93, 2.36),
      asso('Paris 11e', 48.858, 2.38),
    ]);
    expect(r.map((a) => a.nom)).toEqual(['Paris 11e', 'Montreuil']);
  });

  it('associations sans coordonnées écartées du classement par distance', () => {
    const r = associationsLesPlusProches(lieu, [
      asso('Sans coordonnées', null, null),
      asso('Lyon', 45.76, 4.84),
    ]);
    expect(r.map((a) => a.nom)).toEqual(['Lyon']);
  });

  it('lieu sans coordonnées → associations de sa région, par nom ; sans région → aucune', () => {
    const assos = [
      asso('Zèbre', null, null, 'idf'),
      asso('Abri', 48.9, 2.3, 'idf'),
      asso('Hors région', 45.7, 4.8, 'ara'),
    ];
    expect(
      associationsLesPlusProches(
        { latitude: null, longitude: null, region: 'idf' },
        assos,
      ).map((a) => a.nom),
    ).toEqual(['Abri', 'Zèbre']);
    expect(
      associationsLesPlusProches(
        { latitude: null, longitude: null, region: null },
        assos,
      ),
    ).toEqual([]);
    expect(associationsLesPlusProches(null, assos)).toEqual([]);
  });
});

describe('completerRapportSansExcedent — mandant, logos et associations proches', () => {
  it('mandant = organisation de la collecte ; deux associations actives les plus proches, logos inlinés', async () => {
    const s = sb({
      rapports_rse: { data: { collecte_id: 'c1' } },
      collectes: {
        data: {
          evenements: {
            ...evenement,
            lieux: { latitude: 48.84, longitude: 2.4, region: 'idf' },
          },
        },
      },
      associations: {
        data: [
          {
            nom: 'Loin',
            ville: 'Lyon',
            logo_url: null,
            description_rapport_impact: null,
            latitude: 45.76,
            longitude: 4.84,
            region: 'ara',
          },
          {
            nom: 'Proche',
            ville: 'Paris 11e',
            logo_url: 'cle-proche',
            description_rapport_impact: 'Repas chauds.',
            latitude: 48.858,
            longitude: 2.38,
            region: 'idf',
          },
        ],
      },
    });
    const p = await completerRapportSansExcedent(s as never, 'rse-1', {
      nom_evenement: 'Gala',
    });
    expect(p).toMatchObject({
      nom_evenement: 'Gala',
      mandant_nom: 'Maison Exemple',
      logo_client_url: 'data:image/png;base64,cle-client',
      logo_traiteur_url: 'data:image/png;base64,cle-traiteur',
      associations_proches: [
        {
          nom: 'Proche',
          ville: 'Paris 11e',
          logo_url: 'data:image/png;base64,cle-proche',
          description: 'Repas chauds.',
        },
        { nom: 'Loin', ville: 'Lyon', logo_url: null, description: null },
      ],
    });
  });

  it('rapport introuvable ou lecture en échec → contenu inchangé', async () => {
    const payload = { nom_evenement: 'Gala' };
    expect(
      await completerRapportSansExcedent(sb({}) as never, 'rse-2', payload),
    ).toBe(payload);
    expect(
      await completerRapportSansExcedent(
        sb({ rapports_rse: { error: { message: 'x' } } }) as never,
        'rse-2',
        payload,
      ),
    ).toBe(payload);
  });

  it('lecture des associations en échec → rapport sans associations, mandant gardé', async () => {
    const p = await completerRapportSansExcedent(
      sb({
        rapports_rse: { data: { collecte_id: 'c1' } },
        collectes: { data: { evenements: { ...evenement, lieux: null } } },
        associations: { error: { message: 'x' } },
      }) as never,
      'rse-1',
      {},
    );
    expect(p.mandant_nom).toBe('Maison Exemple');
    expect(p).not.toHaveProperty('associations_proches');
  });
});

describe('worker PDF — contexte lu au rendu pour les deux rapports de don', () => {
  it('attestation-don et rapport sans excédent complétés avant generatePdf', () => {
    const src = readFileSync(
      fileURLToPath(
        new URL('../../src/lib/pdf/pdf-worker.ts', import.meta.url),
      ),
      'utf8',
    );
    expect(src).toMatch(
      /pdfType === 'attestation-don'\s*\?\s*await completerRapportDeDon\(supabase, job\.entity_id, job\.payload\)/,
    );
    expect(src).toMatch(
      /pdfType === 'rapport-evenement-sans-excedent'\s*\?\s*await completerRapportSansExcedent\(\s*supabase,\s*job\.entity_id,\s*job\.payload,?\s*\)/,
    );
    expect(src).toContain('await generatePdf(pdfType, payload)');
  });
});
