/**
 * Enveloppe commune des emails (revue des emails, Val 2026-10-29) : logo, lien
 * principal en bouton, pied de page, version texte.
 */
import { describe, it, expect } from 'vitest';
import { envelopperHtml, presenterCorps, versionTexte } from './enveloppe.js';
import { piecesJointesLogo } from './transport.js';

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
    // Le bouton porte son propre style en PREMIER attribut : la couleur des
    // liens ordinaires ne s'y ajoute pas (texte bleu sur bleu dans Gmail,
    // constaté par Val le 2026-10-29).
    const b = html.slice(html.indexOf('<table'), html.indexOf('</table>'));
    expect(b).toMatch(
      /<a style="display:inline-block;[^"]*color:#ffffff[^"]*" href="https:\/\/app\.gosavr\.io\/c">/,
    );
    expect(b).not.toContain('style="color:#223870');
    expect(b.match(/<a /g)).toHaveLength(1);
    expect(b).toContain('Voir mes collectes');
    expect(html).not.toContain('<p><a href="https://app.gosavr.io/c">');
    expect(html).toContain(
      '<a style="color:#223870;text-decoration:underline" href="https://app.gosavr.io/e/1">Programmez-les</a>',
    );
  });

  it('document complet : logo, corps, pied de page avec le contact', () => {
    const html = envelopperHtml(CORPS, 'Objet');
    expect(html.startsWith('<!doctype html>')).toBe(true);
    // Vrai logo Savr, image intégrée (cid), texte de remplacement « Savr ».
    expect(html).toMatch(/<img src="cid:logo-savr"[^>]*alt="Savr"/);
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

  it('le logo est joint à l’envoi seulement quand le HTML l’affiche', () => {
    const avec = piecesJointesLogo(envelopperHtml('<p>x</p>', 'Objet'));
    expect(avec.attachments).toHaveLength(1);
    expect(avec.attachments![0]).toMatchObject({
      contentId: 'logo-savr',
      contentType: 'image/png',
    });
    expect(
      Buffer.from(avec.attachments![0]!.content, 'base64')
        .subarray(1, 4)
        .toString(),
    ).toBe('PNG');
    expect(piecesJointesLogo('<p>sans enveloppe</p>')).toEqual({});
  });
});
