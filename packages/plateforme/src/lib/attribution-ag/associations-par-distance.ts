// Liste déroulante « Association » de l'écran d'attribution AG (décision Val
// 2026-09-17, remplace la recherche libre) : toutes les associations actives,
// triées par distance croissante au lieu de la collecte. Même formule Haversine
// que fn_calculer_algo_attribution_ag. Distance inconnue (coordonnées manquantes)
// → en fin de liste, puis ordre alphabétique.

export interface Coordonnees {
  latitude: number | null;
  longitude: number | null;
}

export interface AssociationCandidate extends Coordonnees {
  id: string;
  nom: string;
  ville: string | null;
  region: string | null;
  capacite_max_beneficiaires: number | null;
  habilitee_attestation_fiscale: boolean;
}

export interface AssociationParDistance {
  id: string;
  nom: string;
  ville: string | null;
  region: string | null;
  capacite_max_beneficiaires: number | null;
  habilitee_attestation_fiscale: boolean;
  distance_km: number | null;
}

export function distanceKm(a: Coordonnees, b: Coordonnees): number | null {
  if (
    a.latitude == null ||
    a.longitude == null ||
    b.latitude == null ||
    b.longitude == null
  )
    return null;
  const rad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(b.latitude - a.latitude) / 2) ** 2 +
    Math.cos(rad(a.latitude)) *
      Math.cos(rad(b.latitude)) *
      Math.sin(rad(b.longitude - a.longitude) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export function trierAssociationsParDistance(
  lieu: Coordonnees,
  associations: AssociationCandidate[],
): AssociationParDistance[] {
  return associations
    .map(({ latitude, longitude, ...a }) => {
      const d = distanceKm(lieu, { latitude, longitude });
      return {
        ...a,
        distance_km: d == null ? null : Math.round(d * 100) / 100,
      };
    })
    .sort((x, y) => {
      if (x.distance_km == null && y.distance_km != null) return 1;
      if (x.distance_km != null && y.distance_km == null) return -1;
      if (
        x.distance_km != null &&
        y.distance_km != null &&
        x.distance_km !== y.distance_km
      )
        return x.distance_km - y.distance_km;
      return x.nom.localeCompare(y.nom, 'fr');
    });
}
