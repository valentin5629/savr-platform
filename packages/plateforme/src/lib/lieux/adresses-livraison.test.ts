import { describe, expect, it, vi } from 'vitest';
import {
  adressesLivraisonDuLieu,
  ecartsAuLieu,
  emplacementCorrespondant,
  nomAdresseLivraison,
} from './adresses-livraison';
import { lireAdressesLivraison } from './adresses-livraison-saisie';

vi.mock('@/lib/geocoding.js', () => ({
  geocodeAdresse: vi.fn(async () => ({ latitude: 48.86, longitude: 2.33 })),
}));

// Carrousel du Louvre : public rue de Rivoli, livraison av. du Général Lemonnier.
const CARROUSEL = {
  adresse_acces: '99 rue de Rivoli',
  code_postal: '75001',
  ville: 'Paris',
  libelle_adresse_1: 'Entrée public',
  libelle_adresse_2: 'Livraison',
  adresse_acces_2: '1 avenue du Général Lemonnier',
  code_postal_2: '75001',
  ville_2: 'Paris',
  libelle_adresse_3: null,
  adresse_acces_3: null,
  code_postal_3: null,
  ville_3: null,
  stationnement: 'facile',
};

describe('M1.1b / adressesLivraisonDuLieu', () => {
  it('rend les emplacements remplis dans l’ordre, n° 1 en tête', () => {
    expect(adressesLivraisonDuLieu(CARROUSEL)).toEqual([
      {
        numero: 1,
        libelle: 'Entrée public',
        adresse_acces: '99 rue de Rivoli',
        code_postal: '75001',
        ville: 'Paris',
      },
      {
        numero: 2,
        libelle: 'Livraison',
        adresse_acces: '1 avenue du Général Lemonnier',
        code_postal: '75001',
        ville: 'Paris',
      },
    ]);
  });

  it('ignore un emplacement incomplet et un lieu absent', () => {
    expect(
      adressesLivraisonDuLieu({ ...CARROUSEL, ville_2: '  ' }).map(
        (a) => a.numero,
      ),
    ).toEqual([1]);
    expect(adressesLivraisonDuLieu(null)).toEqual([]);
  });

  it('nomme un emplacement avec ou sans libellé', () => {
    const [n1, n2] = adressesLivraisonDuLieu({
      ...CARROUSEL,
      libelle_adresse_1: null,
    });
    expect(nomAdresseLivraison(n1!)).toBe('Adresse n° 1');
    expect(nomAdresseLivraison(n2!)).toBe('Adresse n° 2 · Livraison');
  });

  it('reconnaît une adresse aux espaces et à la casse près', () => {
    expect(
      emplacementCorrespondant(
        {
          adresse_acces: ' 1 AVENUE du  Général Lemonnier ',
          code_postal: '75001',
          ville: 'paris',
        },
        CARROUSEL,
      )?.numero,
    ).toBe(2);
    expect(
      emplacementCorrespondant(
        {
          adresse_acces: '2 rue ailleurs',
          code_postal: '75001',
          ville: 'Paris',
        },
        CARROUSEL,
      ),
    ).toBeNull();
  });
});

describe('M1.2 / ecartsAuLieu : pas de fausse alerte', () => {
  it('l’adresse n° 2 choisie n’est pas un écart', () => {
    expect(
      ecartsAuLieu(
        {
          adresse_acces: '1 avenue du Général Lemonnier',
          code_postal: '75001',
          ville: 'Paris',
        },
        CARROUSEL,
      ),
    ).toEqual({});
  });

  it('l’adresse n° 2 écrite seule (code postal et ville du lieu) n’est pas un écart', () => {
    expect(
      ecartsAuLieu(
        { adresse_acces: '1 avenue du Général Lemonnier' },
        CARROUSEL,
      ),
    ).toEqual({});
  });

  it('une adresse hors des emplacements reste un écart', () => {
    expect(
      ecartsAuLieu({ adresse_acces: '5 rue inconnue' }, CARROUSEL),
    ).toEqual({ adresse_acces: '5 rue inconnue' });
  });

  it('un autre champ modifié reste un écart, même avec une adresse du lieu', () => {
    expect(
      ecartsAuLieu(
        {
          adresse_acces: '1 avenue du Général Lemonnier',
          code_postal: '75001',
          ville: 'Paris',
          acces_details: 'Quai 2',
        },
        CARROUSEL,
      ),
    ).toEqual({ acces_details: 'Quai 2' });
  });

  it('une valeur égale au lieu ou nulle n’est pas un écart', () => {
    expect(
      ecartsAuLieu({ stationnement: 'facile', acces_office: null }, CARROUSEL),
    ).toEqual({});
  });

  it('sans lieu lisible, toute surcharge non nulle est un écart', () => {
    expect(ecartsAuLieu({ adresse_acces: '1 rue' }, null)).toEqual({
      adresse_acces: '1 rue',
    });
  });
});

describe('M1.1b / lireAdressesLivraison', () => {
  const corps = (o: Record<string, unknown>) => ({
    libelle_adresse_2: null,
    adresse_acces_2: null,
    code_postal_2: null,
    ville_2: null,
    libelle_adresse_3: null,
    adresse_acces_3: null,
    code_postal_3: null,
    ville_3: null,
    ...o,
  });

  it('ne rend rien quand le corps ne mentionne aucune adresse de livraison', async () => {
    expect(await lireAdressesLivraison({ nom: 'x' }, null)).toEqual({
      ok: true,
      valeurs: {},
    });
  });

  it('tasse une adresse n° 3 sans n° 2 en n° 2, géocodée', async () => {
    const r = await lireAdressesLivraison(
      corps({
        adresse_acces_3: ' 2 quai test ',
        code_postal_3: '75001',
        ville_3: 'Paris',
      }),
      null,
    );
    expect(r).toEqual({
      ok: true,
      valeurs: expect.objectContaining({
        adresse_acces_2: '2 quai test',
        code_postal_2: '75001',
        ville_2: 'Paris',
        latitude_2: 48.86,
        longitude_2: 2.33,
        adresse_acces_3: null,
        latitude_3: null,
        longitude_3: null,
      }),
    });
  });

  it('refuse un emplacement incomplet ou un libellé sans adresse (422)', async () => {
    for (const o of [
      { adresse_acces_2: '1 rue', ville_2: 'Paris' },
      { libelle_adresse_2: 'Livraison' },
      { adresse_acces_2: 'a'.repeat(201), code_postal_2: '1', ville_2: 'v' },
      { adresse_acces_2: 42, code_postal_2: '1', ville_2: 'v' },
    ]) {
      const r = await lireAdressesLivraison(corps(o), null);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reponse.status).toBe(422);
    }
  });

  it('ne regéocode pas une adresse inchangée', async () => {
    const r = await lireAdressesLivraison(
      corps({
        adresse_acces_2: '1 avenue du Général Lemonnier',
        code_postal_2: '75001',
        ville_2: 'Paris',
      }),
      CARROUSEL,
    );
    expect(r.ok && 'latitude_2' in r.valeurs).toBe(false);
  });
});
