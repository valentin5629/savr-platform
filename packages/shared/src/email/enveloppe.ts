/**
 * Enveloppe commune des emails Savr (décision Val 2026-10-29, revue des emails).
 *
 * Les gabarits en base ne portent que le texte : ni style ni classe. L'enveloppe
 * ajoute, à l'envoi, la même présentation à tous :
 *  - le logo « + savr » en texte stylé (aucune image à héberger, rendu partout) ;
 *  - le lien principal en bouton : tout paragraphe qui ne contient qu'un lien
 *    (`<p><a href="…">Texte</a></p>`) devient un bouton bleu marine. Un lien au
 *    milieu d'une phrase reste un lien ;
 *  - un pied de page avec le contact et la raison de l'envoi ;
 *  - une version texte, pour les messageries qui n'affichent pas le HTML.
 *
 * Mise en page en tableaux et styles en ligne : c'est ce que les messageries
 * (Outlook en tête) affichent de façon fiable.
 */

import { escapeHtml } from './html.js';

const MARINE = '#223870'; // savr-primary-700
const ORANGE = '#ff9b00'; // savr-accent-500
const TEXTE = '#161a26';
const DISCRET = '#6e7790';
const FOND = '#f7f8fb';
const BORD = '#dde1ea';
const POLICE = 'Arial, Helvetica, sans-serif';

/** Un paragraphe qui ne contient qu'un lien. */
const PARAGRAPHE_LIEN = /<p>\s*<a href="([^"]+)">([^<]+)<\/a>\s*<\/p>/g;

function bouton(href: string, libelle: string): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0">` +
    `<tr><td style="border-radius:6px;background:${MARINE}">` +
    `<a href="${href}" style="display:inline-block;padding:12px 22px;font:bold 15px ${POLICE};color:#ffffff;text-decoration:none;border-radius:6px">${libelle}</a>` +
    `</td></tr></table>`
  );
}

/** Corps du gabarit déjà interpolé → corps présenté (boutons, liens, paragraphes). */
export function presenterCorps(corps: string): string {
  return corps
    .replace(PARAGRAPHE_LIEN, (_t, href: string, libelle: string) =>
      bouton(href, libelle),
    )
    .replace(/<a href="/g, `<a style="color:${MARINE}" href="`)
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
    `<tr><td style="padding:24px 28px 4px;font:800 26px ${POLICE};color:${MARINE};letter-spacing:-0.5px">` +
    `<span style="color:${ORANGE}">+</span>savr</td></tr>` +
    `<tr><td style="padding:12px 28px 20px;font:15px/1.55 ${POLICE};color:${TEXTE}">${presenterCorps(corps)}</td></tr>` +
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
