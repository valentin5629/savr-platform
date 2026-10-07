// « Demander l'ajout d'un lieu » (§06.05 §3 « Ajout / retrait lieu », liste Lieux
// du gestionnaire — arbitrage Val 2026-10-07) : le rattachement d'un lieu à une
// organisation reste fait à la main par l'Admin Savr. Le bouton ouvre une
// alerte in-app dans la file Admin (`alertes_admin`), jamais un email ni Slack
// — même canal que la demande de modification (lib/lieux/demande-modification).
//
// Source unique du code d'alerte et des bornes des trois champs : routes,
// sévérité de l'écran Admin des alertes et formulaire du gestionnaire (module
// pur, importé aussi côté client).

import { nettoyerSaisie, porteCaractereInterdit } from './demande-modification';

/** `alertes_admin.code` ET `audit_log.action` de la demande. */
export const CODE_ALERTE_LIEU_AJOUT = 'lieu_ajout_demande';

/**
 * `alertes_admin.entity_type` : aucun lieu n'existe encore, l'alerte est
 * rattachée à l'organisation qui demande (`entiteHref` → sa fiche Admin).
 */
export const ENTITE_ALERTE_LIEU_AJOUT = 'organisations';

/** Bornes de longueur, après nettoyage ; `min: 0` = champ facultatif. */
export const BORNES_DEMANDE_AJOUT = {
  nom: { min: 2, max: 150 },
  adresse: { min: 5, max: 300 },
  precision: { min: 0, max: 1000 },
} as const;

type Champ = keyof typeof BORNES_DEMANDE_AJOUT;

// Sujet de la phrase de refus (422) de chaque champ.
const SUJET: Record<Champ, string> = {
  nom: 'Le nom du lieu',
  adresse: 'L’adresse',
  precision: 'La précision',
};

type ChampNormalise =
  | { ok: true; texte: string }
  | { ok: false; erreur: string };

function normaliserChamp(champ: Champ, valeur: unknown): ChampNormalise {
  const { min, max } = BORNES_DEMANDE_AJOUT[champ];
  const facultatif = min === 0;
  if (facultatif && (valeur === undefined || valeur === null))
    return { ok: true, texte: '' };
  if (typeof valeur !== 'string')
    return {
      ok: false,
      erreur: facultatif
        ? `${SUJET[champ]} doit être un texte.`
        : `${SUJET[champ]} est obligatoire.`,
    };
  // Nom et adresse tiennent sur une ligne : tabulation, saut de ligne ou autre
  // blanc collé depuis un document deviennent une espace, sans refus. La
  // précision, texte libre, garde ses sauts de ligne.
  const multiligne = champ === 'precision';
  const net = nettoyerSaisie(valeur);
  const texte = multiligne ? net : net.replace(/\s+/g, ' ');
  if (texte.length < min)
    return {
      ok: false,
      erreur: `${SUJET[champ]} est obligatoire (${min} caractères au minimum).`,
    };
  if (texte.length > max)
    return {
      ok: false,
      erreur: `${SUJET[champ]} ne doit pas dépasser ${max} caractères.`,
    };
  if (porteCaractereInterdit(texte))
    return {
      ok: false,
      erreur: `${SUJET[champ]} contient des caractères non autorisés.`,
    };
  return { ok: true, texte };
}

// `precision` : chaîne vide quand le champ facultatif n'est pas renseigné.
export type DemandeAjoutNormalisee =
  | { ok: true; nom: string; adresse: string; precision: string }
  | { ok: false; erreur: string };

/** Corps reçu du client → trois champs bornés, ou le motif du premier refus (422). */
export function normaliserDemandeAjout(corps: unknown): DemandeAjoutNormalisee {
  const source =
    typeof corps === 'object' && corps !== null && !Array.isArray(corps)
      ? (corps as Record<string, unknown>)
      : {};
  const nom = normaliserChamp('nom', source.nom);
  if (!nom.ok) return nom;
  const adresse = normaliserChamp('adresse', source.adresse);
  if (!adresse.ok) return adresse;
  const precision = normaliserChamp('precision', source.precision);
  if (!precision.ok) return precision;
  return {
    ok: true,
    nom: nom.texte,
    adresse: adresse.texte,
    precision: precision.texte,
  };
}
