/**
 * Code de vérification à la connexion (TOTP, Supabase Auth MFA) — règle unique.
 *
 * Décision Val 2026-11-04 (questionnaire sécurité VIPARIS, exigence IAM1) : le
 * code est obligatoire pour l'équipe Savr, demandé une fois par session (nouvel
 * appareil, déconnexion, fin des 30 jours de `[auth.sessions].timebox`), jamais
 * à chaque page. Aucun code pour les clients. Avance le CDC §15 (« 2FA V1.1 ») :
 * fiche `_Divergences/` du 2026-11-04.
 *
 * EN PRODUCTION SEULEMENT (Val 2026-11-04, pour ne pas le saisir sans cesse
 * pendant le développement) : sur les aperçus Vercel, `dev.app.gosavr.io`, en
 * local et en CI, aucun code n'est demandé (`codeVerificationActif`).
 *
 * Le niveau atteint est le claim `aal` du JWT, posé par Supabase Auth : `aal1`
 * après le mot de passe, `aal2` après le code. Il survit au rafraîchissement du
 * jeton, d'où « une fois par session ».
 *
 * Tenu côté serveur, en trois points qui appellent tous cette règle :
 *  - `middleware.ts` (toute page hors pages publiques) ;
 *  - `getVerifiedClaims` (`lib/api-auth.ts`), sur lequel reposent toutes les
 *    gardes d'API : une session de l'équipe Savr sans code n'y est pas valide ;
 *  - les gardes de page (`lib/page-auth.ts`) et les routes qui lisent elles-mêmes
 *    le rôle (`api/health/*`, `api/auth/update-password`).
 *
 * Comptes VIPARIS (non construit, en attente de leur réponse sur le SAML) : il
 * suffira d'étendre `exigeCodeVerification` à leur organisation, en lui passant
 * le claim `organisation_id` (déjà présent dans chaque JWT) ; les trois points
 * ci-dessus n'auront pas à changer.
 *
 * ⚠ Module PUR (seulement `./roles`, lui-même pur) : importé par le middleware
 * (Edge runtime).
 */
import { isStaff } from './roles';

/**
 * Vrai sur le déploiement Vercel de production seulement (`app.gosavr.io`).
 *
 * Deux sources, l'une OU l'autre suffit : `VERCEL_ENV` est lue à l'exécution ;
 * `NEXT_PUBLIC_VERCEL_ENV` est figée au build, donc présente aussi dans le
 * middleware (Edge) si l'exécution ne fournissait pas la première. Écritures
 * LITTÉRALES obligatoires (`process.env.X`, jamais `process.env['X']`) : Vercel
 * et Next ne fournissent au code Edge que les variables qu'ils y lisent.
 * Absentes (local, CI) ou toute autre valeur (`preview`, `development`) : hors
 * production, aucun code.
 */
export function codeVerificationActif(): boolean {
  return (
    process.env.VERCEL_ENV === 'production' ||
    process.env.NEXT_PUBLIC_VERCEL_ENV === 'production'
  );
}

/** Vrai si ce rôle doit passer le code de vérification à chaque session. */
export function exigeCodeVerification(
  role: string | null | undefined,
): boolean {
  return codeVerificationActif() && isStaff(role);
}

/**
 * Vrai si la session doit encore passer le code : rôle soumis au code ET niveau
 * `aal` différent de `aal2` (absent, `aal1`, ou toute autre valeur : refus).
 */
export function codeVerificationManquant(
  role: string | null | undefined,
  aal: unknown,
): boolean {
  return exigeCodeVerification(role) && aal !== 'aal2';
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
