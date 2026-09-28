/**
 * M0.6 — Relais serveur des suggestions d'adresse BAN (quick-add lieu §06.01).
 * Arbitrage Val 2026-09-28 : l'appel IGN part du serveur, jamais du navigateur.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const requireProgrammateurOuAdmin = vi.fn();
vi.mock('@/lib/api-auth.js', () => ({
  requireProgrammateurOuAdmin: (req: NextRequest) =>
    requireProgrammateurOuAdmin(req),
}));

import { GET } from '@/app/api/v1/programmation/adresses/route';

const req = (q: string) =>
  new NextRequest(
    `http://localhost/api/v1/programmation/adresses?q=${encodeURIComponent(q)}`,
  );

const BAN = {
  features: [
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
  ],
};

describe('M0.6 — GET /api/v1/programmation/adresses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireProgrammateurOuAdmin.mockResolvedValue({
      ctx: { userId: 'u-1', isAdmin: false },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('M0.6 — refuse sans session, sans appeler la BAN', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    requireProgrammateurOuAdmin.mockResolvedValue({
      error: NextResponse.json({ error: 'Non autorisé' }, { status: 401 }),
    });

    const res = await GET(req('39 avenue de wagram'));

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('M0.6 — relaie la saisie à la BAN et renvoie les suggestions mappées', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => BAN });
    vi.stubGlobal('fetch', fetchMock);

    const res = await GET(req('39 avenue de wagram'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
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
  });

  it('M0.6 — tronque une saisie démesurée à 200 caractères', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ features: [] }) });
    vi.stubGlobal('fetch', fetchMock);

    await GET(req('a'.repeat(5000)));

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain(`q=${'a'.repeat(200)}&`);
  });

  it('M0.6 — BAN en panne → 200 et liste vide (fail-open)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('réseau')));

    const res = await GET(req('39 avenue de wagram'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});
