// « Demande de modification d'information » d'un lieu (§06.05 §3, fiche lieu du
// gestionnaire — arbitrage Val 2026-10-06) : le gestionnaire ne modifie RIEN
// lui-même, le référentiel lieux reste écrit par l'Admin Savr seul (§04). Le
// bouton ouvre une alerte in-app dans la file Admin (`alertes_admin`), jamais un
// email ni Slack (§07 Observabilité /03 §3).
//
// Source unique du code d'alerte et des bornes du texte saisi : route POST,
// lecture de l'état « demande en cours », écran Admin des alertes, historique
// de la fiche lieu Admin et modale du gestionnaire.

/** `alertes_admin.code` ET `audit_log.action` de la demande. */
export const CODE_ALERTE_LIEU_MODIFICATION = 'lieu_modification_demandee';

/** `alertes_admin.entity_type` : celui que `entiteHref` relie à la fiche lieu Admin. */
export const ENTITE_ALERTE_LIEU = 'lieux';

export const LONGUEUR_MIN_DEMANDE = 10;
export const LONGUEUR_MAX_DEMANDE = 1000;

// Mêmes refus que `lib/champs-texte-libre` (champ multiligne) : caractères de
// contrôle C0/DEL/C1 hors tabulation et sauts de ligne — un NUL fait échouer
// l'écriture Postgres — et demi-surrogate orphelin, que l'analyse JSON de
// l'écriture rejetterait en 500 alors que la saisie mérite un 422. Les deux
// expressions sont recopiées : ce module est aussi importé côté client (borne
// minimale du champ), `champs-texte-libre` est un module serveur.
/* eslint-disable no-control-regex -- désigner ces plages EST l'objet de la garde. */
const CONTROLE_HORS_BLANCS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;
/* eslint-enable no-control-regex */
const SURROGATE_ORPHELIN = /\p{Surrogate}/u;

export type DemandeNormalisee =
  | { ok: true; texte: string }
  | { ok: false; erreur: string };

/** Texte libre reçu du client → texte borné, ou le motif du refus (422). */
export function normaliserDemande(valeur: unknown): DemandeNormalisee {
  if (typeof valeur !== 'string')
    return { ok: false, erreur: 'Précisez l’information à corriger.' };
  const texte = valeur.trim();
  if (texte.length < LONGUEUR_MIN_DEMANDE)
    return {
      ok: false,
      erreur: `Précisez l’information à corriger (${LONGUEUR_MIN_DEMANDE} caractères au minimum).`,
    };
  if (texte.length > LONGUEUR_MAX_DEMANDE)
    return {
      ok: false,
      erreur: `La demande ne doit pas dépasser ${LONGUEUR_MAX_DEMANDE} caractères.`,
    };
  if (CONTROLE_HORS_BLANCS.test(texte) || SURROGATE_ORPHELIN.test(texte))
    return {
      ok: false,
      erreur: 'La demande contient des caractères non autorisés.',
    };
  return { ok: true, texte };
}
