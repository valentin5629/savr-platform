/**
 * Tri serveur des listes paginées (lib/tri-liste) : seules les colonnes SQL de
 * la liste blanche de la route partent dans `.order()` ; une clé `tri` hors
 * liste blanche retombe sur le tri par défaut.
 */
import { describe, it, expect } from 'vitest';
import { lireTri } from '@/lib/tri-liste';

const TRIS = { nom: ['nom'], ville: ['ville', 'nom'] };
const DEFAUT = { tri: 'nom', ascendant: true } as const;
const sp = (qs: string) => new URLSearchParams(qs);

describe('lireTri', () => {
  it('sans paramètre → tri par défaut', () => {
    expect(lireTri(sp(''), TRIS, DEFAUT)).toEqual({
      colonnes: ['nom'],
      ascendant: true,
    });
    expect(lireTri(sp(''), TRIS, { tri: 'ville', ascendant: false })).toEqual({
      colonnes: ['ville', 'nom'],
      ascendant: false,
    });
  });

  it('clé en liste blanche + ordre explicite → ses colonnes, dans l’ordre', () => {
    expect(lireTri(sp('tri=ville&ordre=desc'), TRIS, DEFAUT)).toEqual({
      colonnes: ['ville', 'nom'],
      ascendant: false,
    });
    expect(lireTri(sp('tri=ville&ordre=asc'), TRIS, DEFAUT)).toEqual({
      colonnes: ['ville', 'nom'],
      ascendant: true,
    });
  });

  it('clé en liste blanche SANS ordre → sens par défaut', () => {
    expect(
      lireTri(sp('tri=ville'), TRIS, { tri: 'nom', ascendant: false }),
    ).toEqual({ colonnes: ['ville', 'nom'], ascendant: false });
  });

  it('clé hors liste blanche (injection, colonne sensible, clé héritée) → tri par défaut', () => {
    for (const tri of [
      'siren',
      'nom.desc,id',
      'nom;drop',
      '',
      'toString',
      '__proto__',
    ]) {
      expect(
        lireTri(sp(`tri=${encodeURIComponent(tri)}&ordre=desc`), TRIS, DEFAUT),
      ).toEqual({ colonnes: ['nom'], ascendant: true });
    }
  });

  it('ordre invalide → sens par défaut', () => {
    expect(
      lireTri(sp('tri=ville&ordre=n_importe'), TRIS, {
        tri: 'nom',
        ascendant: false,
      }),
    ).toEqual({ colonnes: ['ville', 'nom'], ascendant: false });
  });
});
