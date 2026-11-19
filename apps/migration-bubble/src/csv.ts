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
} {
  const brut = texte.charCodeAt(0) === 0xfeff ? texte.slice(1) : texte;
  const tableau: string[][] = [];
  let ligne: string[] = [];
  let cellule = '';
  let entreGuillemets = false;
  for (let i = 0; i < brut.length; i++) {
    const c = brut[i]!;
    if (entreGuillemets) {
      if (c === '"' && brut[i + 1] === '"') {
        cellule += '"';
        i++;
      } else if (c === '"') entreGuillemets = false;
      else cellule += c;
    } else if (c === '"') entreGuillemets = true;
    else if (c === separateur) {
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
  const lignes = tableau
    .slice(1)
    .filter((l) => l.some((v) => v !== ''))
    .map((l) =>
      Object.fromEntries(colonnes.map((nom, i) => [nom, l[i] ?? ''])),
    );
  return { colonnes, lignes };
}

export function ecrireCsv(
  colonnes: string[],
  lignes: Record<string, unknown>[],
): string {
  const cellule = (v: unknown) => {
    const t = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return (
    [
      colonnes.map(cellule).join(','),
      ...lignes.map((l) => colonnes.map((c) => cellule(l[c])).join(',')),
    ].join('\n') + '\n'
  );
}
