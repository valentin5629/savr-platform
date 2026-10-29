/**
 * Enveloppe commune des emails (revue des emails, Val 2026-10-29) : logo, lien
 * principal en bouton, pied de page, version texte.
 */
import { describe, it, expect } from 'vitest';
import { envelopperHtml, presenterCorps, versionTexte } from './enveloppe.js';

const CORPS =
  '<p>Bonjour Jeanne,</p>' +
  '<p>Votre événement a plusieurs collectes ? <a href="https://app.gosavr.io/e/1">Programmez-les</a>.</p>' +
  '<ul><li>Collecte : le 12/11/2026</li></ul>' +
  '<p><a href="https://app.gosavr.io/c">Voir mes collectes</a></p>' +
  '<p>Traiteur &amp; Fils &lt;Paris&gt;</p>' +
  "<p>L'équipe Savr</p>";

describe('enveloppe commune', () => {
  it('un lien seul dans son paragraphe devient un bouton ; un lien dans une phrase reste un lien', () => {
    const html = presenterCorps(CORPS);
    expect(html).toContain(
      'href="https://app.gosavr.io/c" style="display:inline-block;padding:12px 22px',
    );
    expect(html).toContain('background:#223870');
    expect(html).not.toContain('<p><a href="https://app.gosavr.io/c">');
    expect(html).toContain(
      '<a style="color:#223870" href="https://app.gosavr.io/e/1">Programmez-les</a>',
    );
  });

  it('document complet : logo, corps, pied de page avec le contact', () => {
    const html = envelopperHtml(CORPS, 'Objet');
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<span style="color:#ff9b00">+</span>savr');
    expect(html).toContain('Bonjour Jeanne');
    expect(html).toContain('contact@gosavr.io');
    expect(html).toContain('Vous recevez cet email parce que');
  });

  it("l'objet est neutralisé dans le titre du document", () => {
    expect(envelopperHtml('<p>x</p>', 'A <b> & B')).toContain(
      '<title>A &lt;b&gt; &amp; B</title>',
    );
  });

  it('version texte : liens « libellé : adresse », listes, entités décodées, pied de page', () => {
    const t = versionTexte(CORPS);
    expect(t).toContain('Bonjour Jeanne,');
    expect(t).toContain('Programmez-les : https://app.gosavr.io/e/1');
    expect(t).toContain('Voir mes collectes : https://app.gosavr.io/c');
    expect(t).toContain('- Collecte : le 12/11/2026');
    expect(t).toContain('Traiteur & Fils <Paris>');
    expect(t).not.toMatch(/<\/?(p|a|ul|li|br|strong)\b/i);
    expect(t).toContain('contact@gosavr.io');
  });
});
