/**
 * M1.6 / §06.02 §6 — seed_slug_rapport_disponible_pas_bordereau.
 * =============================================================================
 * Divergence M1.6 (tranchée Val 2026-09-14) : la base avait été seedée avec le slug
 * `bordereau_disponible` (bloc8), que rien n'appelle, alors que le batch ZD J+1
 * envoie `rapport_disponible` → TEMPLATE_NOT_FOUND, aucun email de rapport parti.
 * Vérifie, sans DB (lecture du SQL + du seed) :
 *   - la migration 20261002100000 renomme la ligne et reprend objet / corps /
 *     variables du CDC §06.02 §6 ;
 *   - EMAIL_TEMPLATE_CODES et seed_minimal ne connaissent plus `bordereau_disponible`.
 * Le contrôle « en base » (fraîche, toutes migrations) est le pgTAP
 * supabase/tests/email_template_rapport_disponible.test.sql.
 * =============================================================================
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { EMAIL_TEMPLATE_CODES } from './constants.js';

const lire = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const SQL = lire(
  '../../../../supabase/migrations/20261002100000_plateforme_email_template_rapport_disponible.sql',
);
const SEED_MINIMAL = lire('./minimal.ts');

// Liste figée du CDC §06.02 §6 (« Variables »).
const VARIABLES_CDC = [
  'prenom',
  'date_collecte',
  'lieu_nom',
  'poids_total',
  'co2_evite',
  'taux_recyclage',
  'lien_rapport',
];

describe('M1.6/seed_slug_rapport_disponible_pas_bordereau — migration 20261002100000', () => {
  it('renomme bordereau_disponible → rapport_disponible par UPDATE (data-only, idempotent)', () => {
    expect(SQL).toMatch(/UPDATE plateforme\.email_templates/);
    expect(SQL).toContain("code = 'rapport_disponible'");
    expect(SQL).toContain("WHERE code = 'bordereau_disponible'");
    // Jamais de doublon si la ligne cible existe déjà (code UNIQUE) → no-op.
    expect(SQL).toMatch(
      /NOT EXISTS \(\s*SELECT 1 FROM plateforme\.email_templates WHERE code = 'rapport_disponible'/,
    );
    // Aucune structure, aucun droit : data-only.
    expect(SQL).not.toMatch(/\b(ALTER|CREATE|GRANT|REVOKE|DROP)\b/i);
  });

  it('reprend l’objet du CDC §06.02 §6', () => {
    expect(SQL).toContain(
      'Votre rapport RSE est disponible — {{date_collecte}} à {{lieu_nom}}',
    );
  });

  it('déclare exactement les variables du CDC §06.02 §6 (contrôle MISSING_VARIABLE)', () => {
    const m = SQL.match(/variables = ARRAY\[([^\]]+)\]/);
    expect(m).not.toBeNull();
    const declarees = m![1]!.split(',').map((v) => v.trim().replace(/'/g, ''));
    expect(declarees).toEqual(VARIABLES_CDC);
    // Chaque variable déclarée est bien utilisée dans objet ou corps.
    for (const v of VARIABLES_CDC) expect(SQL).toContain(`{{${v}}}`);
  });

  it('corps fidèle au CDC : résumé impact, CTA « Voir le rapport », charte (signature, 0 emoji)', () => {
    expect(SQL).toContain(
      'Le rapport de votre collecte du {{date_collecte}} est prêt.',
    );
    expect(SQL).toContain('{{poids_total}} kg détournés');
    expect(SQL).toContain('{{co2_evite}} kg CO₂e évités');
    expect(SQL).toContain('Taux de recyclage : {{taux_recyclage}} %');
    expect(SQL).toContain('<a href="{{lien_rapport}}">Voir le rapport</a>');
    expect(SQL).toContain("L''équipe Savr");
    expect(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(SQL)).toBe(false);
  });
});

describe('M1.6/seed_slug_rapport_disponible_pas_bordereau — seed aligné', () => {
  it('EMAIL_TEMPLATE_CODES contient rapport_disponible et plus bordereau_disponible', () => {
    expect(EMAIL_TEMPLATE_CODES).toContain('rapport_disponible');
    expect(EMAIL_TEMPLATE_CODES).not.toContain('bordereau_disponible');
  });

  it('seed_minimal (emails_envoyes) ne référence plus bordereau_disponible', () => {
    expect(SEED_MINIMAL).not.toContain("'bordereau_disponible'");
    expect(SEED_MINIMAL).toContain("'rapport_disponible'");
  });
});
