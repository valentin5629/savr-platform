/**
 * Lecture et écriture CSV (RFC 4180 : guillemets doublés, retours à la ligne
 * dans une cellule, BOM en tête). Pas de dépendance : les exports Bubble n'ont
 * besoin de rien d'autre.
 */

export type Ligne = Record<string, string>;

/**
 * Séparateur d'un fichier rempli à la main : la virgule, ou le point-virgule
 * qu'Excel en français met à la place. Lu sur la ligne d'en-tête.
 */
export function separateurEntete(texte: string): ',' | ';' {
  const entete = texte.split(/\r?\n/, 1)[0] ?? '';
  const compte = (c: string) => entete.split(c).length - 1;
  return compte(';') > compte(',') ? ';' : ',';
}

export function lireCsv(
  texte: string,
  separateur: ',' | ';' = ',',
): {
  colonnes: string[];
  lignes: Ligne[];
  /** Lignes non vides dont le nombre de cellules n'est pas celui de l'en-tête. */
  irregulieres: number;
  /** Un guillemet ouvert n'a jamais été fermé : la fin du fichier a été lue comme une seule cellule. */
  guillemetOuvert: boolean;
  /** Un guillemet au milieu d'une cellule non entourée de guillemets : des lignes ont pu être fusionnées. */
  guillemetMalPlace: boolean;
} {
  const brut = texte.charCodeAt(0) === 0xfeff ? texte.slice(1) : texte;
  const tableau: string[][] = [];
  let ligne: string[] = [];
  let cellule = '';
  let entreGuillemets = false;
  let guillemetMalPlace = false;
  for (let i = 0; i < brut.length; i++) {
    const c = brut[i]!;
    if (entreGuillemets) {
      if (c === '"' && brut[i + 1] === '"') {
        cellule += '"';
        i++;
      } else if (c === '"') entreGuillemets = false;
      else cellule += c;
    } else if (c === '"') {
      if (cellule !== '') guillemetMalPlace = true;
      entreGuillemets = true;
    } else if (c === separateur) {
      ligne.push(cellule);
      cellule = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && brut[i + 1] === '\n') i++;
      ligne.push(cellule);
      cellule = '';
      tableau.push(ligne);
      ligne = [];
    } else cellule += c;
  }
  if (cellule !== '' || ligne.length > 0) {
    ligne.push(cellule);
    tableau.push(ligne);
  }
  const colonnes = tableau[0] ?? [];
  const nonVides = tableau.slice(1).filter((l) => l.some((v) => v !== ''));
  const lignes = nonVides.map((l) =>
    Object.fromEntries(colonnes.map((nom, i) => [nom, l[i] ?? ''])),
  );
  return {
    colonnes,
    lignes,
    irregulieres: nonVides.filter((l) => l.length !== colonnes.length).length,
    guillemetOuvert: entreGuillemets,
    guillemetMalPlace,
  };
}

/**
 * Injection de formules (OWASP « CSV Injection ») : Val ouvre les fichiers
 * écrits ici dans Google Sheets, qui exécute une cellule commençant par `=`,
 * `+`, `-`, `@`, une tabulation ou un retour chariot (IMPORTXML, IMAGE… peuvent
 * envoyer la feuille ailleurs). Une telle cellule (nom ou adresse saisis dans
 * Bubble, clé de lieu tirée d'une adresse) est écrite précédée d'une apostrophe,
 * de même qu'une cellule qui commence déjà par des apostrophes suivies d'un de
 * ces caractères : `restaurerCellule` retrouve le texte d'origine d'un fichier
 * relu tel qu'écrit. Si Google Sheets a retiré une apostrophe, deux textes
 * peuvent se relire identiques (`'-x` et `-x`) : `lireDecisions` bloque alors
 * sur la clé présente deux fois. Un nombre négatif (longitude) reste un nombre.
 * Une cellule qui contient un point-virgule est mise entre guillemets : Excel
 * en français découpe à ce caractère.
 */
const DEBUT_DE_FORMULE = /^'*[=+\-@\t\r]/;

function neutraliserFormule(t: string): string {
  return DEBUT_DE_FORMULE.test(t) && !/^-\d+(\.\d+)?$/.test(t) ? `'${t}` : t;
}

/** Inverse de la neutralisation, pour une cellule relue (Google Sheets peut aussi avoir retiré l'apostrophe). */
export function restaurerCellule(t: string): string {
  return /^'+[=+\-@\t\r]/.test(t) ? t.slice(1) : t;
}

export function ecrireCsv(
  colonnes: string[],
  lignes: Record<string, unknown>[],
): string {
  const cellule = (v: unknown) => {
    const t = neutraliserFormule(
      v === null || v === undefined ? '' : String(v),
    );
    return /[",;\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return (
    [
      colonnes.map(cellule).join(','),
      ...lignes.map((l) => colonnes.map((c) => cellule(l[c])).join(',')),
    ].join('\n') + '\n'
  );
}
