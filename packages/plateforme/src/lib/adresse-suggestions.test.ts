/**
 * M0.6 — Suggestions d'adresse BAN (Géoplateforme) pour le quick-add lieu (§06.01).
 * Fail-open : jamais d'exception, [] si échec / saisie trop courte.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { suggererAdresses } from '@/lib/adresse-suggestions';

const reponse = (features: unknown[]) =>
  vi.fn().mockResolvedValue({ ok: true, json: async () => ({ features }) });

describe('M0.6 — suggererAdresses', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('M0.6 — mappe numéro + voie, code postal et ville depuis la BAN', async () => {
    const fetchMock = reponse([
      {
        properties: {
          id: '75117_9933_00039',
          label: '39 Avenue de Wagram 75017 Paris',
          name: '39 Avenue de Wagram',
          postcode: '75017',
          city: 'Paris',
          type: 'housenumber',
        },
      },
    ]);
    vi.stubGlobal('fetch', fetchMock);

    const result = await suggererAdresses('39 avenue de wagram');

    expect(result).toEqual([
      {
        id: '75117_9933_00039',
        label: '39 Avenue de Wagram 75017 Paris',
        adresse: '39 Avenue de Wagram',
        codePostal: '75017',
        ville: 'Paris',
      },
    ]);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('https://data.geopf.fr/geocodage/search?');
    expect(url).toContain('q=39%20avenue%20de%20wagram');
    expect(url).toContain('autocomplete=1');
  });

  it("M0.6 — écarte une commune seule (son nom écraserait l'adresse)", async () => {
    vi.stubGlobal(
      'fetch',
      reponse([
        {
          properties: {
            id: '75056',
            label: 'Paris',
            name: 'Paris',
            postcode: '75001',
            city: 'Paris',
            type: 'municipality',
          },
        },
      ]),
    );
    expect(await suggererAdresses('Paris')).toEqual([]);
  });

  it("M0.6 — n'appelle pas l'API sous 3 caractères", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await suggererAdresses(' 39 ')).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('M0.6 — retourne [] sur erreur réseau ou HTTP (fail-open)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('réseau')));
    expect(await suggererAdresses('39 avenue')).toEqual([]);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    expect(await suggererAdresses('39 avenue')).toEqual([]);
  });
});
