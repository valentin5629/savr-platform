/**
 * M0.7 / BL-P2-22 — Présence + fidélité du seed des 4 templates tiers/conditionnels.
 * =============================================================================
 * Vérifie que la migration R22f INSÈRE les 4 codes CDC §06.02 (20/21/22/9) avec
 * leur objet, leurs phrases-clés et leurs blocs {{#if}} — sans DB (lecture du SQL).
 * Vérifie aussi qu'ils figurent dans EMAIL_TEMPLATE_CODES (dé-stalé R22f).
 * =============================================================================
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { EMAIL_TEMPLATE_CODES } from './constants.js';

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      '../../../../supabase/migrations/20260708150000_plateforme_r22f_seed_templates_tiers_conditionnels.sql',
      import.meta.url,
    ),
  ),
  'utf8',
);

const CODES = [
  'collecte_programmee_tiers',
  'collecte_modifiee_tiers',
  'admin_collecte_annulee',
  'admin_pack_ag_etat',
] as const;

describe('M0.7/bl-p2-22-templates-seedes — présence des 4 codes', () => {
  it('la migration seed insère les 4 codes dans email_templates (ON CONFLICT DO NOTHING)', () => {
    expect(SQL).toContain('INSERT INTO plateforme.email_templates');
    expect(SQL).toContain('ON CONFLICT (code) DO NOTHING');
    for (const code of CODES) expect(SQL).toContain(`'${code}'`);
  });

  it('les 4 codes figurent dans EMAIL_TEMPLATE_CODES', () => {
    for (const code of CODES) expect(EMAIL_TEMPLATE_CODES).toContain(code);
  });

  it('les blocs conditionnels {{#if}} du CDC sont présents dans les corps', () => {
    // tpl 21 : deux branches (modification / annulation)
    expect(SQL).toContain('{{#if est_modification}}');
    expect(SQL).toContain('{{#if est_annulation}}');
    // tpl 22 : annulation tardive (<12h)
    expect(SQL).toContain('{{#if annulation_tardive}}');
    // tpl 9 : niveau bas / épuisé
    expect(SQL).toContain('{{#if niveau_bas}}');
    expect(SQL).toContain('{{#if niveau_epuise}}');
    // chaque ouverture a sa fermeture
    const opens = (SQL.match(/\{\{#if /g) ?? []).length;
    const closes = (SQL.match(/\{\{\/if\}\}/g) ?? []).length;
    expect(opens).toBe(closes);
    expect(opens).toBeGreaterThanOrEqual(5);
  });

  it('objets fidèles au CDC §06.02', () => {
    expect(SQL).toContain(
      'Une collecte a été programmée chez vous — {{date_collecte}} à {{lieu_nom}}',
    );
    expect(SQL).toContain(
      'Collecte {{type_changement_libelle}} — {{date_collecte}} à {{lieu_nom}}',
    );
    expect(SQL).toContain(
      '[Admin] Collecte annulée — {{organisation_nom}} — {{date_collecte}}',
    );
    expect(SQL).toContain(
      '[Admin] Pack AG {{etat_libelle}} — {{organisation_nom}}',
    );
  });

  it('charte : signature « L’équipe Savr », aucun emoji', () => {
    expect(SQL).toContain("L''équipe Savr");
    // pas d'emoji (plage pictogrammes courante)
    expect(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(SQL)).toBe(false);
  });
});
