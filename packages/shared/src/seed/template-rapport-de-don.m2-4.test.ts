/**
 * M2.4 / §12 §1.3-bis — gabarit d'email « Votre rapport de don est disponible »
 * (couche modèle).
 * =============================================================================
 * Vérifie, sans DB (lecture du SQL de la migration 20261013180000 + moteur
 * d'interpolation réel) :
 *   - chaque variable écrite dans l'objet ou le corps est déclarée, ou placée
 *     dans un bloc conditionnel : une variable non déclarée partirait en trou
 *     dans l'email sans qu'aucun contrôle ne la refuse ;
 *   - le jeu de variables que fournit le batch AG rend l'email sans variable
 *     manquante ni accolade restante ;
 *   - le corps ouvre par « Bonjour Prénom, », ou « Bonjour, » sans prénom.
 * Le contrôle « en base » (fraîche, toutes migrations) est le pgTAP
 * supabase/tests/email_template_rapport_de_don.test.sql ; le contrôle « le batch
 * fournit les variables déclarées » est dans
 * packages/plateforme/tests/api/batch-pdf-j1-ag.m2-4.test.ts.
 * =============================================================================
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { findMissingVariables, interpolate } from '../email/index.js';

const SQL = readFileSync(
  fileURLToPath(
    new URL(
      '../../../../supabase/migrations/20261013180000_plateforme_email_template_rapport_de_don.sql',
      import.meta.url,
    ),
  ),
  'utf8',
);

function extraire(motif: RegExp, quoi: string): string {
  const m = motif.exec(SQL);
  if (!m) throw new Error(`${quoi} introuvable dans la migration`);
  return m[1]!;
}

const OBJET = extraire(/SET sujet = '([^']+)'/, 'objet');
const CORPS = extraire(/corps_html = \$tpl\$([\s\S]*?)\$tpl\$/, 'corps');
const DECLAREES = extraire(/variables = ARRAY\[([^\]]+)\]/, 'variables')
  .split(',')
  .map((v) => v.trim().replace(/'/g, ''));

// Ce que le batch AG fournit (batch-pdf-j1-ag.ts, étape 10).
const DU_BATCH = {
  prenom: 'Julie',
  nom_evenement: 'Gala de la Fondation',
  date_evenement: '09/10/2026',
  lien_rapport: 'https://app.example.test/traiteur/collectes/c1',
};

/** Le jeu du batch privé d'une variable. */
function sans(cle: keyof typeof DU_BATCH): Record<string, string> {
  return Object.fromEntries(
    Object.entries(DU_BATCH).filter(([nom]) => nom !== cle),
  );
}

describe('M2.4 / gabarit « rapport de don disponible » — migration 20261013180000', () => {
  it('objet : « Votre rapport de don est disponible — <événement> »', () => {
    expect(OBJET).toBe(
      'Votre rapport de don est disponible — {{nom_evenement}}',
    );
    expect(interpolate(OBJET, DU_BATCH)).toBe(
      'Votre rapport de don est disponible — Gala de la Fondation',
    );
  });

  it('toute variable écrite dans l’objet ou le corps est déclarée, ou conditionnelle', () => {
    const ecrites = new Set(
      [...`${OBJET} ${CORPS}`.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!),
    );
    expect([...ecrites].sort()).toEqual(
      ['date_evenement', 'lien_rapport', 'nom_evenement', 'prenom'].sort(),
    );
    // `prenom` n'est lu que dans son bloc conditionnel : il n'est pas déclaré.
    expect(DECLAREES).toEqual([
      'nom_evenement',
      'date_evenement',
      'lien_rapport',
    ]);
    expect(CORPS).toContain('{{#if prenom}} {{prenom}}{{/if}}');
    // Aucune accolade hors du motif reconnu par le moteur (`{{lien-rapport}}`
    // ne serait pas interpolé et partirait tel quel dans l'email).
    const hors = `${OBJET} ${CORPS}`
      .replace(/\{\{#if \w+\}\}|\{\{\/if\}\}|\{\{\w+\}\}/g, '')
      .match(/[{}]/g);
    expect(hors).toBeNull();
  });

  it('jeu du batch : aucune variable manquante, aucune accolade dans l’email rendu', () => {
    expect(
      findMissingVariables(DECLAREES, DU_BATCH, `${OBJET} ${CORPS}`),
    ).toEqual([]);
    const html = interpolate(CORPS, DU_BATCH);
    expect(html).not.toMatch(/[{}]/);
    expect(html).toContain(
      'Le rapport de don de votre événement « Gala de la Fondation » du 09/10/2026 est prêt.',
    );
    expect(html).toContain(
      '<a href="https://app.example.test/traiteur/collectes/c1">Voir le rapport de don</a>',
    );
    expect(html).toContain("<p>Belle suite,<br>L'équipe Savr</p>");
  });

  it('formule d’appel : « Bonjour Julie, », ou « Bonjour, » sans prénom — jamais « Bonjour , »', () => {
    expect(interpolate(CORPS, DU_BATCH).split('\n')[0]).toBe(
      '<p>Bonjour Julie,</p>',
    );
    expect(interpolate(CORPS, { ...DU_BATCH, prenom: '' }).split('\n')[0]).toBe(
      '<p>Bonjour,</p>',
    );
    // Un appelant qui n'envoie pas de prénom n'est pas refusé.
    const sansPrenom = sans('prenom');
    expect(
      findMissingVariables(DECLAREES, sansPrenom, `${OBJET} ${CORPS}`),
    ).toEqual([]);
    expect(interpolate(CORPS, sansPrenom).split('\n')[0]).toBe(
      '<p>Bonjour,</p>',
    );
  });

  it('une variable déclarée absente fait refuser l’envoi (le défaut d’origine)', () => {
    expect(
      findMissingVariables(
        DECLAREES,
        sans('lien_rapport'),
        `${OBJET} ${CORPS}`,
      ),
    ).toEqual(['lien_rapport']);
  });

  it('charte : ni l’objet ni le corps ne disent « attestation », aucun emoji', () => {
    expect(`${OBJET} ${CORPS}`.toLowerCase()).not.toContain('attestation');
    expect(
      /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(`${OBJET} ${CORPS}`),
    ).toBe(false);
  });
});
