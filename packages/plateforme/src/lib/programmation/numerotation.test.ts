/**
 * M1.2 / numérotation des collectes d'un événement (refonte du formulaire,
 * lot B2) : « Collecte Zéro Déchet #1 », « Collecte Anti-Gaspi #2 »…, même
 * libellé dans l'email récapitulatif et sur la page de confirmation.
 */
import { describe, it, expect } from 'vitest';
import { numeroterCollectes } from './numerotation.js';

const c = (
  id: string,
  type: string,
  date_collecte: string,
  heure_collecte: string | null = '19:00:00',
  created_at: string | null = null,
) => ({ id, type, date_collecte, heure_collecte, created_at });

describe('M1.2/numerotation_collectes', () => {
  it('Zéro Déchet puis Anti-Gaspi, numérotées par type dans l’ordre de date, d’heure puis de création', () => {
    const libelles = numeroterCollectes([
      c('ag-tard', 'anti_gaspi', '2030-11-13'),
      c('zd-midi', 'zero_dechet', '2030-11-12', '12:00:00'),
      c('zd-soir-b', 'zero_dechet', '2030-11-12', '19:00:00', '2030-01-02'),
      c('ag-tot', 'ag', '2030-11-12'),
      c('zd-soir-a', 'zd', '2030-11-12', '19:00:00', '2030-01-01'),
    ]).map((l) => `${l.collecte.id}=${l.libelle}`);

    expect(libelles).toEqual([
      'zd-midi=Collecte Zéro Déchet #1',
      'zd-soir-a=Collecte Zéro Déchet #2',
      'zd-soir-b=Collecte Zéro Déchet #3',
      'ag-tot=Collecte Anti-Gaspi #1',
      'ag-tard=Collecte Anti-Gaspi #2',
    ]);
  });

  it('une collecte annulée garde son numéro : les autres ne changent pas de nom', () => {
    const avant = numeroterCollectes([
      c('a', 'zero_dechet', '2030-11-12'),
      c('b', 'zero_dechet', '2030-11-13'),
    ]);
    // Le statut n'entre pas dans la numérotation.
    const apres = numeroterCollectes([
      { ...c('a', 'zero_dechet', '2030-11-12'), statut: 'annulee' },
      c('b', 'zero_dechet', '2030-11-13'),
    ]);
    expect(apres.map((l) => l.libelle)).toEqual(avant.map((l) => l.libelle));
  });
});
