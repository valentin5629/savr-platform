import { describe, it, expect } from 'vitest';
import { typesEvenementDesCollectes } from './types-evenement-collectes';

const col = (
  id: string,
  type: 'zero_dechet' | 'anti_gaspi',
  date: string | null,
  libelle: string | null,
  statut = 'validee',
  heure: string | null = '20:00:00',
) => ({
  id,
  type,
  statut,
  date_collecte: date,
  heure_collecte: heure,
  created_at: '2026-10-01T00:00:00Z',
  type_evenement: libelle == null ? null : { libelle },
});

describe('M3.2 / types d’événement au niveau de l’événement (lot C1, Q2 Val 2026-10-24)', () => {
  it('C1/types_evenement_ordre_collecte_n1 — Zéro-Déchet avant Anti-Gaspi, puis date et heure : le premier type est celui de la collecte n°1', () => {
    expect(
      typesEvenementDesCollectes(
        [
          col('a', 'anti_gaspi', '2026-11-01', 'Autre'),
          col(
            'b',
            'zero_dechet',
            '2026-11-02',
            'Repas assis',
            'validee',
            '22:00:00',
          ),
          col(
            'c',
            'zero_dechet',
            '2026-11-02',
            'Cocktail apéritif',
            'validee',
            '18:00:00',
          ),
        ],
        'Copie',
      ),
    ).toBe('Cocktail apéritif, Repas assis, Autre');
  });

  it('C1/types_evenement_sans_doublon_ni_annulee — un type répété est nommé une fois, une collecte annulée n’en apporte aucun', () => {
    expect(
      typesEvenementDesCollectes(
        [
          col('a', 'zero_dechet', '2026-11-01', 'Repas assis'),
          col('b', 'anti_gaspi', '2026-11-01', 'Repas assis'),
          col('c', 'zero_dechet', '2026-10-30', 'Autre', 'annulee'),
        ],
        null,
      ),
    ).toBe('Repas assis');
  });

  it('C1/types_evenement_toutes_annulees_ou_sans_type — toutes annulées : leurs types ; aucun type lisible : le repli', () => {
    expect(
      typesEvenementDesCollectes(
        [col('a', 'zero_dechet', '2026-11-01', 'Autre', 'annulee')],
        'Copie',
      ),
    ).toBe('Autre');
    expect(
      typesEvenementDesCollectes(
        [col('a', 'zero_dechet', '2026-11-01', null)],
        'Copie',
      ),
    ).toBe('Copie');
    expect(typesEvenementDesCollectes([], null)).toBeNull();
  });
});
