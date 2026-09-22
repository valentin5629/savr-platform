import { describe, it, expect } from 'vitest';
import {
  distanceKm,
  trierAssociationsParDistance,
  type AssociationCandidate,
} from './associations-par-distance';

const asso = (
  id: string,
  nom: string,
  latitude: number | null,
  longitude: number | null,
): AssociationCandidate => ({
  id,
  nom,
  ville: 'Paris',
  region: 'idf',
  capacite_max_beneficiaires: 100,
  habilitee_attestation_fiscale: false,
  latitude,
  longitude,
});

describe('M2.3 / associations par distance au lieu de la collecte', () => {
  it('distanceKm : Paris → Rouen ≈ 111 km (Haversine), null si coordonnée manquante', () => {
    const d = distanceKm(
      { latitude: 48.8566, longitude: 2.3522 },
      { latitude: 49.4431, longitude: 1.0993 },
    );
    expect(d).toBeGreaterThan(108);
    expect(d).toBeLessThan(114);
    expect(
      distanceKm(
        { latitude: null, longitude: 2 },
        { latitude: 48, longitude: 2 },
      ),
    ).toBeNull();
  });

  it('trie par distance croissante, distance inconnue en fin puis ordre alphabétique', () => {
    const lieu = { latitude: 48.8566, longitude: 2.3522 };
    const res = trierAssociationsParDistance(lieu, [
      asso('rouen', 'Rouen', 49.4431, 1.0993),
      asso('z', 'Zèbre sans GPS', null, null),
      asso('proche', 'Proche', 48.86, 2.36),
      asso('a', 'Abeille sans GPS', null, null),
      asso('moyen', 'Moyen', 48.95, 2.5),
    ]);
    expect(res.map((a) => a.id)).toEqual([
      'proche',
      'moyen',
      'rouen',
      'a',
      'z',
    ]);
    expect(res[0]!.distance_km).toBeLessThan(1);
    expect(res[3]!.distance_km).toBeNull();
    expect(res[0]).not.toHaveProperty('latitude');
  });

  it('lieu sans coordonnées : toutes les distances inconnues, ordre alphabétique', () => {
    const res = trierAssociationsParDistance(
      { latitude: null, longitude: null },
      [asso('b', 'Bravo', 48.85, 2.33), asso('a', 'Alpha', 48.85, 2.33)],
    );
    expect(res.map((a) => a.nom)).toEqual(['Alpha', 'Bravo']);
    expect(res.every((a) => a.distance_km === null)).toBe(true);
  });
});
