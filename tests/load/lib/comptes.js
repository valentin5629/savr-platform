// Comptes de test du jeu de données de dev (`pnpm seed:demo` + `pnpm seed:auth`).
// Module pur, testé par Vitest.
//
// Le frein de débit des espaces clients compte par ORGANISATION : les
// utilisateurs simulés sont donc répartis sur les 8 traiteurs du seed, deux
// comptes chacun (manager et commercial). L'équipe Savr n'est pas freinée.

const DOMAINE = 'savr-test.local';

export const TRAITEURS = [
  'kaspia',
  'fleurdemets',
  'cirette',
  'butard',
  'grandchemin',
  'lenotre',
  'potel',
  'nomad',
];

export const COMPTES_TRAITEUR = TRAITEURS.flatMap((t) => [
  { email: `manager.${t}@${DOMAINE}`, profil: 'traiteur', organisation: t },
  { email: `collab.${t}@${DOMAINE}`, profil: 'traiteur', organisation: t },
]);

export const COMPTES_EQUIPE = ['admin', 'ops1', 'ops2', 'ops3'].map((id) => ({
  email: `${id}@${DOMAINE}`,
  profil: 'equipe',
  organisation: 'savr',
}));

// Compte d'un utilisateur simulé (`vu` = __VU de k6, à partir de 1). Les
// `nbEquipe` premiers sont l'équipe Savr, les suivants tournent sur les comptes
// traiteur : deux utilisateurs simulés d'un même compte ont chacun leur session.
export function compteDuVu(vu, nbEquipe) {
  if (!Number.isInteger(vu) || vu < 1) throw new Error(`VU invalide : ${vu}`);
  if (vu <= nbEquipe) {
    return COMPTES_EQUIPE[(vu - 1) % COMPTES_EQUIPE.length];
  }
  return COMPTES_TRAITEUR[(vu - nbEquipe - 1) % COMPTES_TRAITEUR.length];
}
