import { parseCleLogo } from '../logo-key.js';
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
//
// La clé vient de la base, écrite par un client (PostgREST compris) : seule une
// clé du bucket applicatif sous `logos/` est lue (lib/logo-key.ts), sinon le PDF
// servirait à exfiltrer n'importe quel objet R2 (revue sécurité 2026-09-18).

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};

// Plafond de taille du logo inliné. Le renderer Railway borne le corps JSON à 2 Mo
// (apps/pdf-renderer/src/server.ts) ; la base64 gonfle de ~33 %. Au-delà de 1 Mo brut
// (~1,33 Mo base64) on risque de dépasser la limite AVEC le reste du payload → on
// retombe sur l'en-tête Savr (best-effort, jamais bloquant) plutôt que de faire échouer
// TOUTE la génération PDF pour un logo simplement trop lourd (revue conformité R23b-2).
const MAX_LOGO_BYTES = 1_000_000;

export async function logoKeyToDataUri(
  storageKey: string | null | undefined,
): Promise<string | null> {
  const cle = parseCleLogo(storageKey);
  if (!cle) return null;
  try {
    const bytes = await getObjectBytes(`${cle.bucket}/${cle.key}`);
    if (bytes.byteLength > MAX_LOGO_BYTES) return null;
    const ext = cle.key.split('.').pop() ?? '';
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
