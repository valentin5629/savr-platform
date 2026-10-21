/**
 * M3.2 — bilan consolidé d'un événement du gestionnaire (§06.05 §2, page
 * Événements remise par Val le 2026-10-18 : « une vision consolidée d'un
 * événement sur lequel il y a plusieurs collectes »).
 */
import { describe, expect, it } from 'vitest';
import {
  co2EviteTotal,
  consoliderEvenement,
  type CollecteAConsolider,
} from './evenements-gestionnaire';

const flux = (code: string, kg: number | null) => ({
  poids_reel_kg: kg,
  flux_dechets: { code },
});

function zd(
  statut: string,
  pesees: NonNullable<CollecteAConsolider['collecte_flux']>,
  extra: Partial<CollecteAConsolider> = {},
): CollecteAConsolider {
  return {
    type: 'zero_dechet',
    statut,
    date_collecte: '2026-09-10',
    taux_recyclage: null,
    co2_evite_kg: null,
    collecte_flux: pesees,
    ...extra,
  };
}

function ag(
  statut: string,
  repas: number | null,
  association: string | null,
  extra: Partial<CollecteAConsolider> = {},
): CollecteAConsolider {
  return {
    type: 'anti_gaspi',
    statut,
    date_collecte: '2026-09-10',
    taux_recyclage: null,
    co2_evite_kg: null,
    attributions_antgaspi:
      repas == null && association == null
        ? null
        : {
            volume_repas_realise: repas,
            association_id: association ? `id-${association}` : null,
            association_nom: association,
            association_ville: association ? 'Paris' : null,
          },
    ...extra,
  };
}

describe('M3.2 / bilan consolidé d’un événement', () => {
  it('M3.2/evenement_bilan_cumule_les_collectes_zd — tonnage, flux et CO₂ sommés sur les collectes réalisées', () => {
    const b = consoliderEvenement([
      zd('cloturee', [flux('biodechet', 100), flux('verre', 50)], {
        co2_evite_kg: 40,
      }),
      zd('cloturee', [flux('biodechet', 20), flux('carton', 30)], {
        co2_evite_kg: 15,
      }),
    ]);
    expect(b.nb_collectes_zd).toBe(2);
    expect(b.nb_realisees_zd).toBe(2);
    expect(b.tonnage_zd_kg).toBe(200);
    expect(b.flux_kg).toEqual({
      biodechet: 120,
      emballage: 0,
      carton: 30,
      verre: 50,
      dechet_residuel: 0,
    });
    expect(b.co2_evite_zd_kg).toBe(55);
  });

  it('M3.2/evenement_bilan_taux_pondere_par_tonnage — pas la moyenne simple des taux', () => {
    // 900 kg à 80 % et 100 kg à 20 % : moyenne simple 50 %, pondérée 74 %.
    const b = consoliderEvenement([
      zd('cloturee', [flux('biodechet', 900)], { taux_recyclage: 80 }),
      zd('cloturee', [flux('biodechet', 100)], { taux_recyclage: 20 }),
      // Collecte réalisée sans taux figé : hors du calcul du taux, comptée
      // dans le tonnage.
      zd('cloturee', [flux('verre', 50)]),
    ]);
    expect(b.taux_recyclage).toBeCloseTo(74, 6);
    expect(b.tonnage_zd_kg).toBe(1050);
  });

  it('M3.2/evenement_bilan_collectes_non_realisees_sans_resultat — avant clôture, rien ne compte', () => {
    // Pesées déjà reçues sur une collecte `realisee` (embargo non levé) : la
    // liste Collectes et la fiche n'en montrent rien, le bilan non plus.
    const b = consoliderEvenement([
      zd('realisee', [flux('biodechet', 500)], {
        taux_recyclage: 90,
        co2_evite_kg: 80,
      }),
      zd('programmee', []),
      ag('validee', null, null),
    ]);
    expect(b.nb_realisees_zd).toBe(0);
    expect(b.nb_realisees_ag).toBe(0);
    expect(b.tonnage_zd_kg).toBeNull();
    expect(b.taux_recyclage).toBeNull();
    expect(b.co2_evite_zd_kg).toBeNull();
    expect(b.repas_donnes).toBeNull();
    expect(b.flux_kg.biodechet).toBe(0);
  });

  it('M3.2/evenement_bilan_repas_et_associations — repas sommés, une ligne par association', () => {
    const b = consoliderEvenement([
      ag('cloturee', 120, 'Restos du Cœur', { co2_evite_kg: 300 }),
      ag('cloturee', 80, 'Linkee', { co2_evite_kg: 200 }),
      ag('cloturee', 30, 'Restos du Cœur', { co2_evite_kg: 75 }),
      // Sans excédent : réalisée, 0 repas, aucune association.
      ag('realisee_sans_collecte', null, null),
      // Annulée : comptée dans l'événement, sans résultat.
      ag('annulee', null, null),
    ]);
    expect(b.nb_collectes_ag).toBe(5);
    expect(b.nb_realisees_ag).toBe(4);
    expect(b.nb_sans_excedent).toBe(1);
    expect(b.repas_donnes).toBe(230);
    expect(b.co2_evite_ag_kg).toBe(575);
    expect(b.associations).toEqual([
      {
        id: 'id-Restos du Cœur',
        nom: 'Restos du Cœur',
        ville: 'Paris',
        repas: 150,
      },
      { id: 'id-Linkee', nom: 'Linkee', ville: 'Paris', repas: 80 },
    ]);
  });

  it('M3.2/evenement_bilan_sans_excedent_seul — 0 repas, pas « — »', () => {
    const b = consoliderEvenement([ag('realisee_sans_collecte', 40, 'X')]);
    expect(b.nb_realisees_ag).toBe(1);
    expect(b.nb_sans_excedent).toBe(1);
    expect(b.repas_donnes).toBe(0);
    expect(b.associations).toEqual([]);
  });

  it('M3.2/evenement_bilan_mixte_periode_et_statut — période de collecte et statut consolidé', () => {
    const b = consoliderEvenement([
      zd('cloturee', [flux('biodechet', 10)], {
        date_collecte: '2026-09-12',
        co2_evite_kg: 5,
      }),
      ag('cloturee', 10, 'Linkee', {
        date_collecte: '2026-09-10',
        co2_evite_kg: 25,
      }),
      ag('annulee', null, null, { date_collecte: '2026-09-14' }),
    ]);
    expect(b.premiere_collecte).toBe('2026-09-10');
    expect(b.derniere_collecte).toBe('2026-09-14');
    expect(b.statut_consolide).toBe('Terminé');
    expect(co2EviteTotal(b)).toBe(30);
  });

  it('M3.2/evenement_bilan_sans_collecte — tout à vide, « En cours »', () => {
    const b = consoliderEvenement([]);
    expect(b.nb_collectes_zd + b.nb_collectes_ag).toBe(0);
    expect(b.tonnage_zd_kg).toBeNull();
    expect(b.repas_donnes).toBeNull();
    expect(co2EviteTotal(b)).toBeNull();
    expect(b.premiere_collecte).toBeNull();
    expect(b.statut_consolide).toBe('En cours');
  });

  it('M3.2/evenement_bilan_embed_en_tableau — PostgREST rend parfois les embeds to-one en tableau', () => {
    const b = consoliderEvenement([
      {
        ...ag('cloturee', null, null),
        attributions_antgaspi: [
          {
            volume_repas_realise: 12,
            association_nom: 'Linkee',
            association_ville: null,
          },
        ],
      },
      zd('cloturee', [
        { poids_reel_kg: 7, flux_dechets: [{ code: 'verre' }] },
        { poids_reel_kg: null, flux_dechets: [{ code: 'carton' }] },
      ]),
    ]);
    expect(b.repas_donnes).toBe(12);
    expect(b.flux_kg.verre).toBe(7);
    expect(b.tonnage_zd_kg).toBe(7);
  });

  it('M3.2/evenement_bilan_associations_par_identifiant — deux associations homonymes restent deux lignes', () => {
    const homonyme = (id: string, repas: number): CollecteAConsolider => ({
      ...ag('cloturee', null, null),
      attributions_antgaspi: {
        volume_repas_realise: repas,
        association_id: id,
        association_nom: 'Croix-Rouge',
        association_ville: id === 'a1' ? 'Paris' : 'Lyon',
      },
    });
    const b = consoliderEvenement([
      homonyme('a1', 50),
      homonyme('a2', 30),
      homonyme('a1', 20),
    ]);
    expect(b.associations).toEqual([
      { id: 'a1', nom: 'Croix-Rouge', ville: 'Paris', repas: 70 },
      { id: 'a2', nom: 'Croix-Rouge', ville: 'Lyon', repas: 30 },
    ]);
  });
});
