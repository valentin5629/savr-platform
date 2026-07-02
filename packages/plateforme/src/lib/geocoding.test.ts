/**
 * M0.6 — Géocodage adresse (api-adresse.data.gouv.fr), utilisé par BL-P1-BOA-01/02/03.
 * Fail-open : jamais d'exception, retourne null si échec/timeout/adresse non trouvée.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { geocodeAdresse } from '@/lib/geocoding';

describe('M0.6 — geocodeAdresse', () => {
  afterEach(() => vi.restoreAllMocks());

  it('M0.6 — retourne lat/lng depuis la réponse BAN', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          features: [{ geometry: { coordinates: [2.3522, 48.8566] } }],
        }),
      }),
    );

    const result = await geocodeAdresse('1 rue de Paris', '75001', 'Paris');
    expect(result).toEqual({ latitude: 48.8566, longitude: 2.3522 });
  });

  it('M0.6 — retourne null si aucune feature trouvée (fail-open)', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue({ ok: true, json: async () => ({ features: [] }) }),
    );

    const result = await geocodeAdresse(
      'adresse inconnue',
      '00000',
      'Nulle part',
    );
    expect(result).toBeNull();
  });

  it('M0.6 — retourne null si l’API échoue (fail-open, pas d’exception)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network error')),
    );

    await expect(
      geocodeAdresse('1 rue de Paris', '75001', 'Paris'),
    ).resolves.toBeNull();
  });

  it('M0.6 — retourne null si réponse HTTP non-ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }),
    );

    const result = await geocodeAdresse('1 rue de Paris', '75001', 'Paris');
    expect(result).toBeNull();
  });

  it('M0.6 — retourne null si adresse vide', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await geocodeAdresse('', '', '');
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
