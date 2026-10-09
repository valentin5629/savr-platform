// Seul point d'appel du SDK Resend : tout email émis VIA RESEND passe ici (règle
// ESLint `no-restricted-imports` sur 'resend' partout ailleurs).
// Deux canaux n'y passent pas et ne sont donc PAS couverts par la garde :
//   - Supabase Auth, qui envoie lui-même l'email de réinitialisation de mot de
//     passe (`resetPasswordForEmail`) ;
//   - Pennylane, qui envoie les factures et avoirs à l'adresse qu'il connaît du
//     client (`send_email`).
// Ce fichier porte trois garanties, et il est le seul à les porter :
//   - l'expéditeur vient de RESEND_FROM, jamais du code ni de l'appelant ;
//   - hors production, aucun email n'atteint un vrai destinataire ;
//   - le SDK rend { data, error } au lieu de lever : `error` est toujours lu.
// Rien n'est lu ni validé à l'import : la configuration est contrôlée à l'envoi,
// pour qu'un build sans variables d'environnement reste possible.
import { Resend } from 'resend';
import { logger } from '../logger/index.js';
import { escapeHtml } from './html.js';
import {
  throttleOutbound,
  honorRetryAfter,
  parseRetryAfter,
} from '../rate-limit/outbound-throttle.js';

export interface EmailMessage {
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string | string[];
  subject: string;
  html: string;
}

// 'skipped' = rien n'est parti et ce n'est pas un échec (hors production sans
// adresse de redirection) : l'appelant poursuit, il n'y a rien à retenter.
export type SendOutcome = {
  resendId: string | null;
  statut: 'sent' | 'failed' | 'skipped';
  erreur: string | null;
};

const ENDPOINT = 'resend.send';

// Production = déploiement Vercel de production, rien d'autre. NODE_ENV vaut
// 'production' en Preview comme en Production : seul VERCEL_ENV les distingue.
// VERCEL_ENV absent (local, CI) ou toute autre valeur = hors production — dans
// le doute, rien ne part vers un vrai destinataire.
function isProduction(): boolean {
  return process.env['VERCEL_ENV'] === 'production';
}

const lister = (adresses: string | string[]): string =>
  [adresses].flat().join(', ');

// Un message d'erreur Resend peut citer une adresse (destinataire refusé, titulaire
// du compte) : masquée avant journalisation. La base, elle, garde le message brut.
// Le message vient d'un tiers : rien n'y est garanti. Autre chose qu'une chaîne
// n'est pas journalisé, et le texte est borné avant la recherche (sur un long mot
// sans espace, elle coûterait un temps quadratique).
const masquerAdresses = (texte: unknown): string =>
  typeof texte === 'string'
    ? texte
        .slice(0, 500)
        .replace(/[^\s<>()"',;:]+@[^\s<>()"',;:]+/g, '[adresse masquée]')
    : '';

// Seuls ces champs partent vers Resend, quel que soit l'objet reçu : un `from`,
// des en-têtes ou une pièce jointe portés par l'appelant ne traversent pas.
function champsConnus(message: EmailMessage): EmailMessage {
  const connu: EmailMessage = {
    to: message.to,
    subject: message.subject,
    html: message.html,
  };
  if (message.cc !== undefined) connu.cc = message.cc;
  if (message.bcc !== undefined) connu.bcc = message.bcc;
  if (message.replyTo !== undefined) connu.replyTo = message.replyTo;
  return connu;
}

// Le message redirigé est reconstruit champ par champ (pas de recopie en bloc) :
// un champ destinataire ajouté plus tard à EmailMessage ne traverse pas la garde
// tant qu'il n'est pas traité ici. `replyTo` est repris tel quel.
function redirigerHorsProduction(
  message: EmailMessage,
  redirectTo: string,
): EmailMessage {
  const origine = [
    lister(message.to),
    message.cc !== undefined ? `cc : ${lister(message.cc)}` : null,
    message.bcc !== undefined ? `cci : ${lister(message.bcc)}` : null,
  ]
    .filter((partie) => partie !== null)
    .join(' ; ');
  const prefixe = process.env['VERCEL_ENV'] ? '[PREVIEW]' : '[DEV]';
  const bandeau = `<div style="margin:0 0 16px;padding:8px 12px;border:1px solid #b45309;font:13px sans-serif;color:#92400e">Destinataires d'origine : ${escapeHtml(origine)}</div>`;

  const redirige: EmailMessage = {
    to: redirectTo,
    subject: `${prefixe} ${message.subject}`,
    html: bandeau + message.html,
  };
  if (message.cc !== undefined) redirige.cc = redirectTo;
  if (message.bcc !== undefined) redirige.bcc = redirectTo;
  if (message.replyTo !== undefined) redirige.replyTo = message.replyTo;
  return redirige;
}

// Rendu déjà fait : émet vers Resend (ou no-op sink si RESEND_API_KEY='test').
// Réutilisé par sendEmail (envoi initial) ET runEmailRetryWorker (retries).
export async function dispatchToResend(
  message: EmailMessage,
): Promise<SendOutcome> {
  // Puits de test : valeur exacte, comme avant ce fichier (pas de tolérance d'espaces).
  if (process.env['RESEND_API_KEY'] === 'test') {
    return { resendId: null, statut: 'sent', erreur: null };
  }

  // La garde passe AVANT le contrôle de configuration : un envoi qui n'aura pas
  // lieu n'a besoin ni de clé ni d'expéditeur, et le parcours doit continuer.
  let aEnvoyer = champsConnus(message);
  if (!isProduction()) {
    const redirectTo = process.env['EMAIL_REDIRECT_TO']?.trim();
    if (!redirectTo) {
      logger.warn('email.envoi_ignore', {
        raison: 'hors_production_sans_redirection',
        detail:
          "EMAIL_REDIRECT_TO absent : hors production (VERCEL_ENV différent de 'production'), aucun email n'est envoyé.",
        vercel_env: process.env['VERCEL_ENV'] ?? null,
      });
      return { resendId: null, statut: 'skipped', erreur: null };
    }
    aEnvoyer = redirigerHorsProduction(message, redirectTo);
  }

  const apiKey = (process.env['RESEND_API_KEY'] ?? '').trim();
  const from = (process.env['RESEND_FROM'] ?? '').trim();
  // Seule une clé en ASCII imprimable, sans espace, est acceptée. Le SDK recopie
  // dans le message de son exception une clé contenant un saut de ligne : une clé
  // hors de cette règle ne lui parvient jamais, et n'est jamais citée ici.
  const cleUtilisable = /^[\x21-\x7E]+$/.test(apiKey);
  const enDefaut = [
    ...(cleUtilisable ? [] : ['RESEND_API_KEY']),
    ...(from ? [] : ['RESEND_FROM']),
  ];
  if (enDefaut.length > 0) {
    logger.error('email.configuration_manquante', {
      variables_en_defaut: enDefaut,
    });
    // Un échec, pas une exception (décision Val 2026-10-07) : l'appelant poursuit,
    // l'envoi est historisé en échec et le worker le reprend une fois la variable posée.
    return {
      resendId: null,
      statut: 'failed',
      erreur: `Configuration email incomplète — variable(s) d'environnement absente(s) ou invalide(s) : ${enDefaut.join(', ')}. Aucun email envoyé.`,
    };
  }

  // VOLET 3 R22g — espacement défensif (§08 l.655, Resend 10 req/s) : borne le débit
  // des envois groupés (batch / retries) sous le plafond de l'éditeur. Chemin réel
  // uniquement (le sink 'test' ci-dessus court-circuite → aucun impact sur les tests).
  await throttleOutbound('resend');
  const debut = Date.now();
  const resend = new Resend(apiKey);
  // `from` en dernier : rien de ce que porte le message ne peut le remplacer.
  const result = await resend.emails.send({ ...aEnvoyer, from });

  if (result.error) {
    // 429 Resend : honore Retry-After (décale le prochain envoi) — l'échec est ensuite
    // retenté par le worker email-retry (§08 §6, paliers 5 min/1 h/24 h) (VOLET 3 R22g).
    if (result.error.name === 'rate_limit_exceeded') {
      honorRetryAfter(
        'resend',
        parseRetryAfter(result.headers?.['retry-after'] ?? null),
      );
    }
    // §07/01 api.external.failed — ni la clé, ni le contenu, ni une adresse.
    logger.error('api.external.failed', {
      service: 'resend',
      endpoint: ENDPOINT,
      http_status: result.error.statusCode,
      error_code: result.error.name,
      message: masquerAdresses(result.error.message),
    });
    return { resendId: null, statut: 'failed', erreur: result.error.message };
  }

  const resendId = result.data?.id ?? null;
  logger.info('api.external.called', {
    service: 'resend',
    endpoint: ENDPOINT,
    latency_ms: Date.now() - debut,
    resend_id: resendId,
  });
  return { resendId, statut: 'sent', erreur: null };
}
