/**
 * Tri serveur des listes paginées (lib/tri-liste) : la colonne demandée part
 * dans `.order()`, elle ne passe QUE si elle est en liste blanche.
 */
import { describe, it, expect } from 'vitest';
import { lireTri } from '@/lib/tri-liste';

const COLONNES = ['nom', 'ville'] as const;
const DEFAUT = { colonne: 'nom', ascendant: true };
const sp = (qs: string) => new URLSearchParams(qs);

describe('lireTri', () => {
  it('sans paramètre → tri par défaut', () => {
    expect(lireTri(sp(''), COLONNES, DEFAUT)).toEqual(DEFAUT);
  });

  it('colonne en liste blanche + ordre explicite', () => {
    expect(lireTri(sp('tri=ville&ordre=desc'), COLONNES, DEFAUT)).toEqual({
      colonne: 'ville',
      ascendant: false,
    });
    expect(lireTri(sp('tri=ville&ordre=asc'), COLONNES, DEFAUT)).toEqual({
      colonne: 'ville',
      ascendant: true,
    });
  });

  it('colonne hors liste blanche (injection, colonne sensible) → tri par défaut', () => {
    for (const tri of ['siren', 'nom.desc,id', 'nom;drop', '']) {
      expect(
        lireTri(
          sp(`tri=${encodeURIComponent(tri)}&ordre=desc`),
          COLONNES,
          DEFAUT,
        ),
      ).toEqual(DEFAUT);
    }
  });

  it('ordre invalide → sens par défaut', () => {
    expect(
      lireTri(sp('tri=ville&ordre=n_importe'), COLONNES, {
        colonne: 'nom',
        ascendant: false,
      }),
    ).toEqual({ colonne: 'ville', ascendant: false });
  });
});
