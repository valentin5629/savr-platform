// Recadrage d'une photo de collecte par l'équipe Savr (décision Val 2026-11-20).
//
// L'original est gardé (C1) : la photo recadrée est un second objet, rangé à côté
// sous une clé DÉRIVÉE de celle de l'original, et la ligne shared.fichiers pointe
// sur l'une ou l'autre. Galerie, espace client et rapports lisent la clé de la
// ligne : ils montrent la version recadrée sans rien changer. « Revenir à
// l'original » remet la clé d'origine. Aucune colonne ajoutée : la clé suffit à
// dire si la photo est recadrée et où est son original.
//
//   original : photos/collectes/<collecte>/<nom>.<ext>
//   recadrée : photos/collectes/<collecte>/<nom>.<ext>.recadree.jpg

const SUFFIXE = '.recadree.jpg';

export function estRecadree(key: string): boolean {
  return key.endsWith(SUFFIXE);
}

/** Clé de l'original d'une photo, recadrée ou non. */
export function cleOriginale(key: string): string {
  return estRecadree(key) ? key.slice(0, -SUFFIXE.length) : key;
}

/** Clé de la version recadrée d'une photo (la même à chaque recadrage). */
export function cleRecadree(key: string): string {
  return `${cleOriginale(key)}${SUFFIXE}`;
}

const TYPES_PAR_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/** Type de l'original, lu sur l'extension de sa clé. */
export function typeDeLOriginal(key: string): string {
  const ext = cleOriginale(key).split('.').pop()?.toLowerCase() ?? '';
  return TYPES_PAR_EXTENSION[ext] ?? 'image/jpeg';
}
