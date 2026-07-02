// Géocodage adresse → lat/lng, appelé en background au save côté serveur (routes admin
// association/transporteur/lieu). Pas de carte, pas de saisie manuelle lat/lng — même
// pattern que le geocoding Nominatim documenté côté TMS V2 (M06 Référentiel prestataires),
// via l'API Adresse gouvernementale (api-adresse.data.gouv.fr, FR, sans clé) plutôt que
// Nominatim public : évite d'envoyer des adresses françaises à un tiers non-FR (réserve
// RGPD déjà notée côté CDC TMS pour le fallback géocodage externe).
//
// Fail-open : une erreur réseau ou une adresse non trouvée renvoie null (pas d'exception).
// L'appelant persiste latitude/longitude = null et affiche "Non géolocalisé — vérifier
// l'adresse" (jamais bloquant pour la création/édition de la fiche).

export interface Coordonnees {
  latitude: number;
  longitude: number;
}

export async function geocodeAdresse(
  adresse: string,
  codePostal: string,
  ville: string,
): Promise<Coordonnees | null> {
  const q = [adresse, codePostal, ville].filter(Boolean).join(' ');
  if (!q.trim()) return null;

  try {
    const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;

    const body = (await res.json()) as {
      features?: Array<{ geometry?: { coordinates?: [number, number] } }>;
    };
    const coords = body.features?.[0]?.geometry?.coordinates;
    if (!coords || coords.length !== 2) return null;

    const [longitude, latitude] = coords;
    if (typeof latitude !== 'number' || typeof longitude !== 'number')
      return null;

    return { latitude, longitude };
  } catch {
    return null;
  }
}
