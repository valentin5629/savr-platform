/**
 * M1.2 / §06.02 §3 — email_recap_bonjour_prenom (couche modèle).
 * =============================================================================
 * Demande Val 2026-10-08 : l'email récapitulatif de programmation s'adresse au
 * programmeur par son prénom (« Bonjour Julie, »), vouvoiement conservé.
 * Vérifie, sans DB (lecture du SQL + moteur d'interpolation réel) :
 *   - la migration 20261008150000 ne change QUE la première ligne du corps posé
 *     par 20260708120000 ;
 *   - le corps rendu ouvre par « Bonjour Prénom, », ou « Bonjour, » sans prénom ;
 *   - `prenom` n'est pas exigé à l'envoi (un appelant qui ne l'envoie pas n'est
 *     pas refusé).
 * Le contrôle « en base » (fraîche, toutes migrations) est le pgTAP
 * supabase/tests/email_template_collecte_programmee.test.sql.
 * =============================================================================
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { findMissingVariables, interpolate } from '../email/index.js';

const lire = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const corpsDe = (sql: string): string => {
  const m = sql.match(/\$tpl\$([\s\S]*?)\$tpl\$/);
  if (!m) throw new Error('corps du template introuvable dans la migration');
  return m[1]!;
};

const SQL = lire(
  '../../../../supabase/migrations/20261008150000_plateforme_email_recap_programmation_prenom.sql',
);
const SQL_PRECEDENT = lire(
  '../../../../supabase/migrations/20260708120000_plateforme_r12b_programmation_e1_payload.sql',
);
// Les instructions seules : les commentaires de la migration citent l'état
// d'avant (« variables = … ») et ne doivent pas compter comme une écriture.
const INSTRUCTIONS = SQL.split('\n')
  .filter((ligne) => !ligne.trimStart().startsWith('--'))
  .join('\n');
const CORPS = corpsDe(SQL);
const CORPS_PRECEDENT = corpsDe(SQL_PRECEDENT);

// Liste posée par 20260708120000, que ce lot ne touche pas.
const VARIABLES_EXIGEES = ['nom_evenement', 'date_collecte', 'tarif_ligne'];

const METIER = {
  nom_evenement: 'Gala',
  date_collecte: '2030-01-15',
  tarif_ligne: 'Tarif Zéro Déchet applicable : 120.00 € HT.',
};

describe('M1.2/email_recap_bonjour_prenom — migration 20261008150000', () => {
  it('ne change que la formule d’appel du corps posé par 20260708120000', () => {
    const [appel, ...suite] = CORPS.split('\n');
    const [appelPrecedent, ...suitePrecedente] = CORPS_PRECEDENT.split('\n');
    expect(appelPrecedent).toBe('<p>Bonjour,</p>');
    expect(appel).toBe('<p>Bonjour{{#if prenom}} {{prenom}}{{/if}},</p>');
    expect(suite).toEqual(suitePrecedente);
  });

  it('data-only : une ligne mise à jour, ni objet ni variables réécrits, aucune structure, aucun droit', () => {
    expect(SQL).toMatch(/UPDATE plateforme\.email_templates/);
    expect(SQL).toContain("WHERE code = 'collecte_programmee'");
    expect(INSTRUCTIONS).not.toMatch(/\b(sujet|variables)\s*=/);
    expect(INSTRUCTIONS).not.toMatch(/\b(ALTER|CREATE|GRANT|REVOKE|DROP)\b/i);
  });

  it('se termine par un contrôle en forme positive (table en RLS forcée)', () => {
    expect(SQL).toMatch(/v_a_jour <> 1[\s\S]*RAISE EXCEPTION/);
    expect(SQL).toContain(
      "starts_with(corps_html, '<p>Bonjour{{#if prenom}} {{prenom}}{{/if}},</p>')",
    );
  });
});

describe('M1.2/email_recap_bonjour_prenom — corps rendu', () => {
  it('avec un prénom : « Bonjour Julie, »', () => {
    const html = interpolate(CORPS, { ...METIER, prenom: 'Julie' });
    expect(html.startsWith('<p>Bonjour Julie,</p>')).toBe(true);
  });

  it.each([
    ['prénom vide', { ...METIER, prenom: '' }],
    ['prénom absent', METIER],
  ])('%s : « Bonjour, », jamais d’espace orphelin', (_cas, variables) => {
    const html = interpolate(CORPS, variables);
    expect(html.startsWith('<p>Bonjour,</p>')).toBe(true);
    expect(html).not.toContain('Bonjour ,');
    expect(html).not.toContain('{{');
  });

  it('prenom n’est pas exigé à l’envoi : un appelant qui ne l’envoie pas n’est pas refusé', () => {
    expect(findMissingVariables(VARIABLES_EXIGEES, METIER, CORPS)).toEqual([]);
  });

  it('vouvoiement, signature « L’équipe Savr », 0 emoji', () => {
    const html = interpolate(CORPS, { ...METIER, prenom: 'Julie' });
    expect(html).toContain('Votre collecte');
    expect(html).toContain('Vous retrouverez');
    // Aucun pronom ni possessif de tutoiement, en mot entier.
    expect(html).not.toMatch(/(?<!\p{L})(tu|te|toi|ton|ta|tes)(?!\p{L})/iu);
    expect(html.endsWith("<p>L'équipe Savr</p>")).toBe(true);
    expect(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(html)).toBe(false);
  });
});
