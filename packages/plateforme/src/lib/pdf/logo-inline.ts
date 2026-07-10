import { getObjectBytes } from './r2-client.js';

// Inline d'un logo (clé R2 « bucket/logos/<id>.ext ») en data URI base64 pour le
// rendu PDF Puppeteer (BL-P3-05).
//
// Le renderer Railway (apps/pdf-renderer) rend `<img src="…">` tel quel et ne
// présigne / ne télécharge RIEN : une clé R2 brute dans `src` ne s'afficherait pas
// (image cassée). On télécharge donc les octets côté serveur et on les inline en
// data URI avant `generatePdf`. Best-effort : `null` si clé absente/illisible →
// le template retombe sur l'en-tête « Savr » (jamais bloquant, comme le fallback
// logo standard §12 §1.2).

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};

export async function logoKeyToDataUri(
  storageKey: string | null | undefined,
): Promise<string | null> {
  if (!storageKey || !storageKey.trim()) return null;
  try {
    const bytes = await getObjectBytes(storageKey);
    const ext = storageKey.split('.').pop()?.toLowerCase() ?? '';
    const mime = MIME_BY_EXT[ext] ?? 'image/png';
    return `data:${mime};base64,${bytes.toString('base64')}`;
  } catch {
    // Logo manquant/illisible → fallback Savr côté template.
    return null;
  }
}

/**
 * Résolveur mémoïsé : évite de re-télécharger la même clé logo pour N rapports
 * d'un même batch (ex. tous les rapports d'une agence programmatrice partagent son
 * logo). À instancier une fois par run de batch.
 */
export function makeLogoResolver(): (
  key: string | null | undefined,
) => Promise<string | null> {
  const cache = new Map<string, string | null>();
  return async (key) => {
    if (!key || !key.trim()) return null;
    if (cache.has(key)) return cache.get(key)!;
    const uri = await logoKeyToDataUri(key);
    cache.set(key, uri);
    return uri;
  };
}
