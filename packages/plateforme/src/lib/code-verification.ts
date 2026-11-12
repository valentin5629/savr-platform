/**
 * Code de vérification à la connexion (TOTP, Supabase Auth MFA) — règle unique.
 *
 * Décision Val 2026-11-04 (questionnaire sécurité VIPARIS, exigence IAM1) : le
 * code est obligatoire pour l'équipe Savr, demandé une fois par session (nouvel
 * appareil, déconnexion, fin des 30 jours de `[auth.sessions].timebox`), jamais
 * à chaque page. Avance le CDC §15 (« 2FA V1.1 ») : fiche `_Divergences/` du
 * 2026-11-04.
 *
 * Décision Val 2026-11-10 (exigence IAM3, pas de SAML) : il est aussi exigé des
 * utilisateurs d'une organisation cochée par l'Admin (VIPARIS), et d'eux seuls
 * parmi les clients. Le hook du jeton pose alors le claim
 * `code_verification_obligatoire: true` (migration 20261110200000). Une session
 * impersonée n'y est pas soumise : l'administrateur a passé son propre code pour
 * la lancer. Fiche `_Divergences/` du 2026-11-10.
 *
 * EN PRODUCTION SEULEMENT (Val 2026-11-04, pour ne pas le saisir sans cesse
 * pendant le développement) : sur les aperçus Vercel, `dev.app.gosavr.io`, en
 * local et en CI, aucun code n'est demandé (`codeVerificationActif`).
 *
 * Le niveau atteint est le claim `aal` du JWT, posé par Supabase Auth : `aal1`
 * après le mot de passe, `aal2` après le code. Il survit au rafraîchissement du
 * jeton, d'où « une fois par session ».
 *
 * Tenu côté serveur, en trois points qui appellent tous cette règle avec les
 * claims du jeton :
 *  - `middleware.ts` (toute page hors pages publiques) ;
 *  - `getVerifiedClaims` (`lib/api-auth.ts`), sur lequel reposent toutes les
 *    gardes d'API : une session soumise au code et sans code n'y est pas valide ;
 *  - les gardes de page (`lib/page-auth.ts`) et les routes qui lisent elles-mêmes
 *    le rôle (`api/health/*`, `api/auth/update-password`).
 *
 * La base applique la même règle (`plateforme.f_code_verification_ok`).
 *
 * ⚠ Module PUR (seulement `./roles`, lui-même pur) : importé par le middleware
 * (Edge runtime).
 */
import { isStaff } from './roles';

/**
 * Vrai sur le déploiement Vercel de production seulement (`app.gosavr.io`).
 *
 * Deux sources, l'une OU l'autre suffit : `VERCEL_ENV`, lue à l'exécution
 * (fournie par Vercel ; sa présence dans le middleware Edge n'est pas mesurée) ;
 * `NEXT_PUBLIC_VERCEL_ENV`, que Next remplace au build par sa valeur, y compris
 * dans le middleware, mais seulement sous forme littérale (`process.env.X`,
 * jamais `process.env['X']`). Les deux dépendent vraisemblablement du même
 * réglage Vercel (exposition des variables système, non mesuré) : s'il était
 * coupé, le code le serait aussi, sans signal (doc, « Limites connues »).
 * Absentes (local, CI) ou toute autre valeur (`preview`, `development`) : hors
 * production, aucun code.
 */
export function codeVerificationActif(): boolean {
  return (
    process.env.VERCEL_ENV === 'production' ||
    process.env.NEXT_PUBLIC_VERCEL_ENV === 'production'
  );
}

/** Claims du jeton tels que les rendent `parseJwtClaims` et `claimsJeton`. */
export type ClaimsJeton = Readonly<Record<string, unknown>>;

/**
 * Vrai si cette session doit passer le code de vérification : équipe Savr, ou
 * organisation qui l'exige (claim `code_verification_obligatoire` à `true`
 * exactement) hors session impersonée.
 */
export function exigeCodeVerification(claims: ClaimsJeton): boolean {
  if (!codeVerificationActif()) return false;
  const role = claims['user_role'];
  if (isStaff(typeof role === 'string' ? role : undefined)) return true;
  const impersonee =
    typeof claims['impersonator_id'] === 'string' &&
    claims['impersonator_id'] !== '';
  return claims['code_verification_obligatoire'] === true && !impersonee;
}

/**
 * Vrai si la session doit encore passer le code : session soumise au code ET
 * niveau `aal` différent de `aal2` (absent, `aal1`, ou toute autre valeur :
 * refus).
 */
export function codeVerificationManquant(claims: ClaimsJeton): boolean {
  return exigeCodeVerification(claims) && claims['aal'] !== 'aal2';
}

/** Un facteur tel que Supabase Auth le rend dans `user.factors`. */
export interface FacteurAuth {
  id: string;
  factor_type: string;
  status: string;
}

/** Facteurs TOTP de l'utilisateur, vérifiés d'abord. */
export function facteursTotp(factors: readonly FacteurAuth[] | undefined): {
  verifies: FacteurAuth[];
  enAttente: FacteurAuth[];
} {
  const totp = (factors ?? []).filter((f) => f.factor_type === 'totp');
  return {
    verifies: totp.filter((f) => f.status === 'verified'),
    enAttente: totp.filter((f) => f.status !== 'verified'),
  };
}

/** Code à 6 chiffres, espaces tolérés à la saisie (« 123 456 »). */
export function normaliserCode(saisie: unknown): string | null {
  if (typeof saisie !== 'string') return null;
  const code = saisie.replace(/\s+/g, '');
  return /^\d{6}$/.test(code) ? code : null;
}
