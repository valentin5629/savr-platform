/**
 * Attributions Anti-Gaspi des chargeurs de dashboards, par rôle — §04 « Vue SQL :
 * v_attributions_gestionnaire », arbitrage Val 2026-09-22 (option A).
 *
 * La vue est VIDE pour tout rôle autre que gestionnaire_lieux (garde de rôle) et
 * la table est refusée au gestionnaire sur un traiteur tiers (aa_select, C-1) :
 * un rôle envoyé sur le mauvais chemin lit zéro repas sans aucune erreur. Ces
 * tests tiennent le branchement.
 */
import { describe, it, expect } from 'vitest';
import {
  attributionsAgOf,
  embedAttributionsAg,
  embedRepasAg,
} from './attributions-ag.js';

const VUE = 'attributions_antgaspi:v_attributions_gestionnaire(';
const TABLE = /attributions_antgaspi\s*\(/;

describe('M3.2 / attributions AG par rôle — embed PostgREST', () => {
  it('M3.2/attributions_embed_gestionnaire_vue — gestionnaire_lieux : la vue, sous la clé attributions_antgaspi', () => {
    expect(embedRepasAg('gestionnaire_lieux')).toBe(
      'attributions_antgaspi:v_attributions_gestionnaire(volume_repas_realise)',
    );
    const complet = embedAttributionsAg('gestionnaire_lieux');
    expect(complet).toContain(VUE);
    for (const col of [
      'volume_repas_realise',
      'association_id',
      'association_nom',
      'association_ville',
    ])
      expect(complet).toContain(col);
    expect(complet).not.toMatch(TABLE);
    // L'embed imbriqué de la table n'existe pas sur la vue.
    expect(complet).not.toContain('associations!association_id');
  });

  it.each(['traiteur_manager', 'traiteur_commercial', 'agence'])(
    'M3.1/attributions_embed_autres_roles_table — %s : la table, jamais la vue',
    (role) => {
      expect(embedRepasAg(role)).toBe(
        'attributions_antgaspi(volume_repas_realise)',
      );
      const complet = embedAttributionsAg(role);
      expect(complet).toMatch(TABLE);
      expect(complet).toContain('associations!association_id(id, nom, ville)');
      expect(complet).not.toContain('v_attributions_gestionnaire');
    },
  );
});

describe('M3.2 / attributions AG par rôle — forme commune', () => {
  it('M3.2/attributions_forme_commune_vue — la ligne à plat de la vue devient la forme imbriquée de la table', () => {
    // Embed to-one : PostgREST rend un OBJET.
    expect(
      attributionsAgOf({
        volume_repas_realise: 120,
        association_id: 'a1',
        association_nom: 'VAG Asso',
        association_ville: 'Pantin',
      }),
    ).toEqual([
      {
        volume_repas_realise: 120,
        association_id: 'a1',
        associations: { id: 'a1', nom: 'VAG Asso', ville: 'Pantin' },
      },
    ]);
  });

  it('M3.2/attributions_forme_commune_table — la forme de la table sort inchangée, objet ou tableau', () => {
    const ligne = {
      volume_repas_realise: 80,
      association_id: 'a2',
      associations: { id: 'a2', nom: 'Asso Deux', ville: null },
    };
    expect(attributionsAgOf(ligne)).toEqual([ligne]);
    expect(attributionsAgOf([ligne, ligne])).toEqual([ligne, ligne]);
  });

  it('M3.2/attributions_forme_commune_vide — aucune attribution : tableau vide', () => {
    expect(attributionsAgOf(null)).toEqual([]);
    expect(attributionsAgOf(undefined)).toEqual([]);
    expect(attributionsAgOf([])).toEqual([]);
  });
});
