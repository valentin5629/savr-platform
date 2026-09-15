/**
 * `validerChampsTexteLibre` — borne d'entrée des trois champs texte libre qui
 * partent au transporteur (`contact_secours_nom`, `contact_secours_telephone`,
 * `collectes.informations_supplementaires`).
 *
 * Ces colonnes sont des `text` sans aucune contrainte : 5 000 caractères y
 * passaient (mesuré). Deux d'entre elles transitent par le canal de texte libre
 * de l'adapter logistique, où toutes les informations d'exploitation sont
 * concaténées — un nom démesuré y évince les lignes suivantes, dont l'adresse
 * d'accès, du message lu par le chauffeur ; un nom multiligne y forge une fausse
 * ligne d'en-tête.
 */
import { describe, it, expect } from 'vitest';
import {
  BORNES_TEXTE_LIBRE,
  validerChampsTexteLibre,
} from './champs-texte-libre.js';

function valeurs(
  source: unknown,
): Partial<Record<string, string | null>> | null {
  const res = validerChampsTexteLibre(source);
  return 'error' in res ? null : res.valeurs;
}

async function refus(source: unknown): Promise<string[]> {
  const res = validerChampsTexteLibre(source);
  if (!('error' in res)) throw new Error('attendu : un refus 422');
  expect(res.error.status).toBe(422);
  const body = (await res.error.json()) as { champs_invalides: string[] };
  return body.champs_invalides;
}

describe('validerChampsTexteLibre — refus', () => {
  it('refuse le nom de contact de 5 000 caractères qui évinçait les lignes suivantes', async () => {
    expect(await refus({ contact_secours_nom: 'a'.repeat(5000) })).toEqual([
      'contact_secours_nom',
    ]);
  });

  it('refuse à UN caractère au-delà de la borne, et accepte pile à la borne', async () => {
    const max = BORNES_TEXTE_LIBRE.contact_secours_nom.max;
    expect(await refus({ contact_secours_nom: 'a'.repeat(max + 1) })).toEqual([
      'contact_secours_nom',
    ]);
    expect(valeurs({ contact_secours_nom: 'a'.repeat(max) })).toEqual({
      contact_secours_nom: 'a'.repeat(max),
    });
  });

  it('refuse un nom multiligne — il forgerait une fausse ligne d’en-tête chez le chauffeur', async () => {
    expect(
      await refus({ contact_secours_nom: 'Jean\nAccès : porte B' }),
    ).toEqual(['contact_secours_nom']);
  });

  it('refuse le NUL — Postgres le rejette en `text`, on veut le 422 et pas le 500', async () => {
    expect(
      await refus({ contact_secours_telephone: '06\u000012345678' }),
    ).toEqual(['contact_secours_telephone']);
  });

  it('refuse les contrôles C1 (U+0080-U+009F), que `[[:cntrl:]]` refuse aussi en base', async () => {
    expect(await refus({ contact_secours_nom: 'Jean\u0085Martin' })).toEqual([
      'contact_secours_nom',
    ]);
  });

  it('refuse une valeur non textuelle — sinon `p_updates->>champ` la coerce et la stocke', async () => {
    expect(
      await refus({
        contact_secours_nom: { $ne: 1 },
        contact_secours_telephone: 612345678,
        informations_supplementaires: ['a', 'b'],
      }),
    ).toEqual([
      'contact_secours_nom',
      'contact_secours_telephone',
      'informations_supplementaires',
    ]);
  });

  it('refuse le dépassement du plafond CDC de 1000 caractères (§06.01 l.167 / §08 E1)', async () => {
    expect(
      await refus({ informations_supplementaires: 'x'.repeat(1001) }),
    ).toEqual(['informations_supplementaires']);
    expect(BORNES_TEXTE_LIBRE.informations_supplementaires.max).toBe(1000);
  });

  it('refuse un caractère de contrôle NON blanc dans un champ pourtant multiligne', async () => {
    expect(
      await refus({ informations_supplementaires: 'Quai 2\u0007fermé' }),
    ).toEqual(['informations_supplementaires']);
  });

  it('refuse un demi-surrogate orphelin — il sortait en 500 à l’analyse jsonb, pas en 422', async () => {
    const orphelin = String.fromCharCode(0xd800) + 'Jean';
    expect(await refus({ contact_secours_nom: orphelin })).toEqual([
      'contact_secours_nom',
    ]);
  });

  it('nomme TOUS les champs fautifs, pas seulement le premier', async () => {
    expect(
      await refus({
        contact_secours_nom: 'a'.repeat(200),
        contact_secours_telephone: 'b'.repeat(200),
      }),
    ).toEqual(['contact_secours_nom', 'contact_secours_telephone']);
  });
});

describe('validerChampsTexteLibre — acceptations et normalisation', () => {
  it('accepte les sauts de ligne et la tabulation dans le champ `<textarea>`', () => {
    expect(
      valeurs({
        informations_supplementaires: 'Quai N°2 fermé\nSonner interphone\tB',
      }),
    ).toEqual({
      informations_supplementaires: 'Quai N°2 fermé\nSonner interphone\tB',
    });
  });

  it('accepte un emoji — une paire de surrogates BIEN FORMÉE n’est pas un orphelin', () => {
    expect(
      valeurs({ informations_supplementaires: 'Quai 2 😀 côté cour' }),
    ).toEqual({ informations_supplementaires: 'Quai 2 😀 côté cour' });
  });

  it('accepte les accents et l’espace insécable — U+00E9 et U+00A0 ne sont pas des contrôles', () => {
    expect(valeurs({ contact_secours_nom: 'Frédéric\u00A0Le Blan' })).toEqual({
      contact_secours_nom: 'Frédéric\u00A0Le Blan',
    });
  });

  it('trime, et rend `null` pour une saisie qui n’est que des blancs', () => {
    expect(valeurs({ contact_secours_nom: '  Jean Martin  ' })).toEqual({
      contact_secours_nom: 'Jean Martin',
    });
    expect(valeurs({ informations_supplementaires: '   \n  ' })).toEqual({
      informations_supplementaires: null,
    });
  });

  it('rend `null` pour `null` — c’est ainsi qu’on efface un champ facultatif', () => {
    expect(valeurs({ contact_secours_telephone: null })).toEqual({
      contact_secours_telephone: null,
    });
  });

  it('ne fabrique AUCUNE clé absente du corps — un PATCH partiel reste partiel', () => {
    expect(valeurs({ pax: 80, nom_evenement: 'Gala' })).toEqual({});
  });

  it('ignore un corps qui n’est pas un objet plutôt que de faire échouer la route', () => {
    expect(valeurs(null)).toEqual({});
    expect(valeurs(['12 rue Neuve'])).toEqual({});
  });
});
