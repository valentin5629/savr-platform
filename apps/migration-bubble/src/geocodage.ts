/**
 * Position des lieux par la Base Adresse Nationale (service public
 * d'adresses). Seul appel réseau de l'import.
 *
 * Ce qui part : l'adresse postale d'un LIEU, rien d'autre (jamais un nom de
 * personne, un email ou un téléphone). Débit modéré. Chaque réponse est gardée
 * dans un fichier de cache hors dépôt : une répétition suivante ne rappelle le
 * service que pour les adresses nouvelles.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { Geocode } from './plan';

export const SERVICE_ADRESSES = 'https://data.geopf.fr/geocodage/search';

type Recuperer = (url: string) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

interface ReponseService {
  features?: {
    geometry?: { coordinates?: [number, number] };
    properties?: {
      score?: number;
      type?: string;
      postcode?: string;
      city?: string;
    };
  }[];
}

export function lireReponse(reponse: unknown): Geocode | null {
  const f = (reponse as ReponseService).features?.[0];
  const [longitude, latitude] = f?.geometry?.coordinates ?? [];
  if (typeof latitude !== 'number' || typeof longitude !== 'number')
    return null;
  return {
    latitude,
    longitude,
    score: f?.properties?.score ?? 0,
    precis: f?.properties?.type === 'housenumber',
    codePostal: f?.properties?.postcode ?? null,
    ville: f?.properties?.city ?? null,
  };
}

export async function situerAdresses(
  /** Adresse normalisée (clé du cache) → adresse à envoyer. */
  adresses: Map<string, string>,
  options: {
    fichierCache: string;
    /** `false` : aucun appel, seules les réponses déjà en cache servent. */
    appeler: boolean;
    recuperer?: Recuperer;
    pauseMs?: number;
  },
): Promise<{
  geocodes: Map<string, Geocode | null>;
  appels: number;
  echecs: number;
  duCache: number;
}> {
  const cache: Record<string, Geocode | null> = existsSync(options.fichierCache)
    ? (JSON.parse(readFileSync(options.fichierCache, 'utf8')) as Record<
        string,
        Geocode | null
      >)
    : {};
  const recuperer = options.recuperer ?? ((url: string) => fetch(url));
  const geocodes = new Map<string, Geocode | null>();
  let appels = 0;
  let echecs = 0;
  let duCache = 0;
  for (const [cle, adresse] of adresses) {
    if (cle in cache) {
      geocodes.set(cle, cache[cle]!);
      duCache++;
      continue;
    }
    if (!options.appeler) continue;
    appels++;
    try {
      const reponse = await recuperer(
        `${SERVICE_ADRESSES}?${new URLSearchParams({ q: adresse.slice(0, 200), limit: '1', index: 'address' })}`,
      );
      if (!reponse.ok) throw new Error(`réponse ${reponse.status}`);
      cache[cle] = lireReponse(await reponse.json());
      geocodes.set(cle, cache[cle]!);
    } catch {
      // Panne ou refus : rien n'est mis en cache, l'adresse sera redemandée au passage suivant.
      echecs++;
    }
    if (options.pauseMs)
      await new Promise((r) => setTimeout(r, options.pauseMs));
  }
  if (appels > 0) {
    mkdirSync(dirname(options.fichierCache), { recursive: true });
    writeFileSync(options.fichierCache, JSON.stringify(cache, null, 1));
  }
  return { geocodes, appels, echecs, duCache };
}
