/**
 * Enveloppe commune des emails Savr (décision Val 2026-10-29, revue des emails).
 *
 * Les gabarits en base ne portent que le texte : ni style ni classe. L'enveloppe
 * ajoute, à l'envoi, la même présentation à tous :
 *  - le vrai logo Savr (PNG joint à l'email, référencé `cid:` : cf. logo-savr.ts
 *    et transport.ts), texte de remplacement « Savr » si l'image est bloquée ;
 *  - le lien principal en bouton : tout paragraphe qui ne contient qu'un lien
 *    (`<p><a href="…">Texte</a></p>`) devient un bouton bleu marine arrondi,
 *    texte blanc et flèche. Un lien au milieu d'une phrase reste un lien ;
 *  - un pied de page avec le contact et la raison de l'envoi ;
 *  - une version texte, pour les messageries qui n'affichent pas le HTML.
 *
 * Mise en page en tableaux et styles en ligne : c'est ce que les messageries
 * (Outlook en tête) affichent de façon fiable.
 */

import { escapeHtml } from './html.js';
import { LOGO_CID, LOGO_HAUTEUR, LOGO_LARGEUR } from './logo-savr.js';

const MARINE = '#223870'; // savr-primary-700
const ORANGE = '#ff9b00'; // savr-accent-500
const TEXTE = '#161a26';
const DISCRET = '#6e7790';
const FOND = '#f7f8fb';
const BORD = '#dde1ea';
const POLICE = 'Arial, Helvetica, sans-serif';

/** Un paragraphe qui ne contient qu'un lien. */
const PARAGRAPHE_LIEN = /<p>\s*<a href="([^"]+)">([^<]+)<\/a>\s*<\/p>/g;

// Bouton « à l'épreuve des messageries » : fond porté par la cellule ET par le
// lien, bordure de la même couleur (Outlook ignore le padding d'un <a>). Le lien
// porte son style EN PREMIER attribut : la coloration des liens ordinaires
// (`<a href="`) ne le touche pas — sinon Gmail retient la couleur des liens et
// le texte devient bleu sur bleu (constaté par Val le 2026-10-29).
function bouton(href: string, libelle: string): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 20px">` +
    `<tr><td align="center" bgcolor="${MARINE}" style="border-radius:8px;background:${MARINE};mso-padding-alt:14px 28px">` +
    `<a style="display:inline-block;padding:14px 28px;border:1px solid ${MARINE};border-radius:8px;background:${MARINE};font:600 15px/20px ${POLICE};color:#ffffff;text-decoration:none;letter-spacing:0.2px" href="${href}">` +
    `<span style="color:#ffffff">${libelle}&nbsp;&nbsp;<span style="color:${ORANGE}">&rarr;</span></span></a>` +
    `</td></tr></table>`
  );
}

/** Corps du gabarit déjà interpolé → corps présenté (boutons, liens, paragraphes). */
export function presenterCorps(corps: string): string {
  return corps
    .replace(PARAGRAPHE_LIEN, (_t, href: string, libelle: string) =>
      bouton(href, libelle),
    )
    .replace(
      /<a href="/g,
      `<a style="color:${MARINE};text-decoration:underline" href="`,
    )
    .replace(/<p>/g, '<p style="margin:0 0 14px">')
    .replace(/<ul>/g, '<ul style="margin:0 0 14px;padding-left:22px">');
}

/** Document HTML complet envoyé à la messagerie. */
export function envelopperHtml(corps: string, sujet: string): string {
  return (
    `<!doctype html><html lang="fr"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${escapeHtml(sujet)}</title></head>` +
    `<body style="margin:0;padding:0;background:${FOND}">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${FOND}">` +
    `<tr><td align="center" style="padding:24px 12px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid ${BORD};border-radius:8px">` +
    `<tr><td style="padding:28px 32px 8px">` +
    `<img src="cid:${LOGO_CID}" width="${LOGO_LARGEUR}" height="${LOGO_HAUTEUR}" alt="Savr" style="display:block;border:0;outline:none;text-decoration:none;height:auto;max-width:${LOGO_LARGEUR}px;font:800 24px ${POLICE};color:${MARINE}">` +
    `</td></tr>` +
    `<tr><td style="padding:12px 32px 24px;font:15px/1.6 ${POLICE};color:${TEXTE}">${presenterCorps(corps)}</td></tr>` +
    `</table>` +
    `<p style="max-width:560px;margin:16px auto 0;font:12px/1.5 ${POLICE};color:${DISCRET}">` +
    `Savr — collecte et valorisation des surplus d'événements · contact@gosavr.io<br>` +
    `Vous recevez cet email parce que vous utilisez la plateforme Savr.</p>` +
    `</td></tr></table></body></html>`
  );
}

const ENTITES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

/** Version texte du corps (avant enveloppe) : liens « libellé : adresse ». */
export function versionTexte(corps: string): string {
  const texte = corps
    .replace(/<a href="([^"]+)">([^<]*)<\/a>/g, '$2 : $1')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<li>/g, '- ')
    .replace(/<\/(p|li|ul|div|tr|table)>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (e) => ENTITES[e] ?? e)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return (
    `${texte}\n\n--\nSavr — collecte et valorisation des surplus d'événements · contact@gosavr.io\n` +
    `Vous recevez cet email parce que vous utilisez la plateforme Savr.`
  );
}
