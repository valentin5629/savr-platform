// Jusqu'à 3 adresses de livraison par lieu (Val 2026-11-19, migration
// 20261119150000). L'adresse n° 1 est l'adresse historique du lieu
// (`adresse_acces`, `code_postal`, `ville`) ; les n° 2 et n° 3 sont des colonnes
// suffixées `_2` / `_3`, chacune vide ou complète (CHECK en base).
//
// Tout le code qui lit ces emplacements passe par `adressesLivraisonDuLieu` : la
// fiche lieu Admin, le sélecteur du formulaire de programmation, et le calcul
// d'écart d'une collecte à son lieu (`ecartsAuLieu`), qui ne doit pas compter
// comme une « modification du lieu » le simple choix d'une de ses adresses.

export type NumeroAdresse = 1 | 2 | 3;

export interface AdresseLivraison {
  numero: NumeroAdresse;
  libelle: string | null;
  adresse_acces: string;
  code_postal: string;
  ville: string;
}

/** Colonnes d'un lieu lues par ce module (toutes facultatives à la lecture). */
export interface LieuAdresses {
  adresse_acces?: string | null;
  code_postal?: string | null;
  ville?: string | null;
  libelle_adresse_1?: string | null;
  libelle_adresse_2?: string | null;
  adresse_acces_2?: string | null;
  code_postal_2?: string | null;
  ville_2?: string | null;
  libelle_adresse_3?: string | null;
  adresse_acces_3?: string | null;
  code_postal_3?: string | null;
  ville_3?: string | null;
}

/** Colonnes de `lieux` (hors adresse n° 1) à sélectionner pour ce module. */
export const COLONNES_ADRESSES_LIVRAISON =
  'libelle_adresse_1, libelle_adresse_2, adresse_acces_2, code_postal_2, ville_2, libelle_adresse_3, adresse_acces_3, code_postal_3, ville_3';

function texte(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function emplacement(
  numero: NumeroAdresse,
  libelle: unknown,
  adresse: unknown,
  codePostal: unknown,
  ville: unknown,
): AdresseLivraison | null {
  const a = texte(adresse);
  const cp = texte(codePostal);
  const v = texte(ville);
  if (!a || !cp || !v) return null;
  return {
    numero,
    libelle: texte(libelle) || null,
    adresse_acces: a,
    code_postal: cp,
    ville: v,
  };
}

/** Emplacements remplis du lieu, dans l'ordre n° 1, n° 2, n° 3. */
export function adressesLivraisonDuLieu(
  lieu: LieuAdresses | null | undefined,
): AdresseLivraison[] {
  if (!lieu) return [];
  return [
    emplacement(
      1,
      lieu.libelle_adresse_1,
      lieu.adresse_acces,
      lieu.code_postal,
      lieu.ville,
    ),
    emplacement(
      2,
      lieu.libelle_adresse_2,
      lieu.adresse_acces_2,
      lieu.code_postal_2,
      lieu.ville_2,
    ),
    emplacement(
      3,
      lieu.libelle_adresse_3,
      lieu.adresse_acces_3,
      lieu.code_postal_3,
      lieu.ville_3,
    ),
  ].filter((a): a is AdresseLivraison => a !== null);
}

/** « Adresse n° 2 · Livraison » : nom affiché d'un emplacement. */
export function nomAdresseLivraison(a: AdresseLivraison): string {
  return a.libelle
    ? `Adresse n° ${a.numero} · ${a.libelle}`
    : `Adresse n° ${a.numero}`;
}

/** « 1 avenue du Général Lemonnier, 75001 Paris ». */
export function ligneAdresseLivraison(a: {
  adresse_acces: string;
  code_postal: string;
  ville: string;
}): string {
  return `${a.adresse_acces}, ${a.code_postal} ${a.ville}`;
}

// Comparaison tolérante à la casse et aux espaces : une saisie qui ne diffère
// que par une majuscule ou un double espace désigne la même adresse.
function normaliser(v: unknown): string {
  return texte(v).replace(/\s+/g, ' ').toLocaleLowerCase('fr');
}

/**
 * Adresse de la liste qui correspond à cette adresse, ou `null`. Sert à
 * reconnaître une adresse choisie parmi celles du lieu (formulaire,
 * `lieu_overrides`).
 */
export function adresseParmi(
  adresse: { adresse_acces?: unknown; code_postal?: unknown; ville?: unknown },
  adresses: AdresseLivraison[],
): AdresseLivraison | null {
  const a = normaliser(adresse.adresse_acces);
  const cp = normaliser(adresse.code_postal);
  const v = normaliser(adresse.ville);
  return (
    adresses.find(
      (e) =>
        normaliser(e.adresse_acces) === a &&
        normaliser(e.code_postal) === cp &&
        normaliser(e.ville) === v,
    ) ?? null
  );
}

/** Emplacement du lieu qui correspond à cette adresse, ou `null`. */
export function emplacementCorrespondant(
  adresse: { adresse_acces?: unknown; code_postal?: unknown; ville?: unknown },
  lieu: LieuAdresses | null | undefined,
): AdresseLivraison | null {
  return adresseParmi(adresse, adressesLivraisonDuLieu(lieu));
}

const CHAMPS_ADRESSE = ['adresse_acces', 'code_postal', 'ville'] as const;

/**
 * Écart réel d'une collecte à son lieu (CDC §04 « Modification d'un lieu au
 * formulaire » : la worklist Admin ne garde que les valeurs qui diffèrent encore
 * du lieu officiel). Rend les clés de `lieu_overrides` qui sont une vraie
 * modification :
 *  - une valeur nulle ou égale à celle du lieu n'est pas un écart ;
 *  - une adresse (adresse, code postal, ville) égale à l'une des adresses de
 *    livraison du lieu n'est pas un écart : c'est un choix, pas une correction.
 * Une collecte dont l'écart est vide n'entraîne ni signalement Admin, ni entrée
 * dans la worklist, ni « informations incomplètes ».
 */
export function ecartsAuLieu(
  overrides: Record<string, unknown> | null | undefined,
  lieu: LieuAdresses | null | undefined,
): Record<string, unknown> {
  if (!overrides) return {};
  const officiel = (lieu ?? {}) as Record<string, unknown>;
  const ecarts: Record<string, unknown> = {};
  for (const [cle, valeur] of Object.entries(overrides)) {
    if (valeur === null || valeur === undefined) continue;
    if (JSON.stringify(valeur) === JSON.stringify(officiel[cle] ?? null))
      continue;
    ecarts[cle] = valeur;
  }
  if (!CHAMPS_ADRESSE.some((c) => Object.hasOwn(ecarts, c))) return ecarts;

  // Adresse effective de la collecte = la surcharge, à défaut le lieu (même
  // fusion champ par champ que l'adapter logistique).
  const effective = Object.fromEntries(
    CHAMPS_ADRESSE.map((c) => [
      c,
      typeof overrides[c] === 'string' ? overrides[c] : officiel[c],
    ]),
  );
  if (emplacementCorrespondant(effective, lieu)) {
    for (const c of CHAMPS_ADRESSE) delete ecarts[c];
  }
  return ecarts;
}
