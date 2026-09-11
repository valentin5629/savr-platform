/**
 * M1.6 / Renderer PDF — durcissement du service Railway :
 *   - auth X-Internal-Token en temps constant, fail-closed si secret absent,
 *     /health seule route exemptée, 401 AVANT tout parsing du corps ;
 *   - erreurs 422/500 génériques (code court + ref), détail uniquement en log.
 *
 * Chromium n'est pas lancé : `renderPdf` est injecté. Le rendu réel est prouvé
 * par le build/run de l'image Docker (cf. PR).
 *
 * Exécuté UNIQUEMENT par le vitest racine (exclu du build Docker, cf. tsconfig.json).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import { createApp, type RenderPdf } from './app.js';
import { tokenMatches } from './auth.js';

const SECRET = 'test-test-test-test';
const FAKE_PDF = new TextEncoder().encode('%PDF-1.4\n%fake\n');

const BORDEREAU = {
  numero: 'BSAV-2026-00001',
  date_emission: '02/07/2026',
  date_collecte: '01/07/2026',
  date_evenement: '01/07/2026',
  nom_evenement: 'Gala',
  lieu_nom: 'Pavillon',
  lieu_adresse: '1 rue X, Paris',
  producteur_raison_sociale: 'Traiteur SA',
  producteur_adresse: '2 rue Y, Paris',
  transporteur_nom: 'Strike',
  exutoire_nom: 'Veolia',
  flux: [{ nom: 'Biodéchets', poids_kg: 12, nb_bacs: 3 }],
  poids_total_kg: 12,
};

let server: Server | undefined;

async function start(
  secret: string | undefined,
  renderPdf: RenderPdf = async () => FAKE_PDF,
): Promise<string> {
  const app = createApp(secret, renderPdf);
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function post(
  base: string,
  body: string,
  token?: string,
): Promise<globalThis.Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token !== undefined) headers['X-Internal-Token'] = token;
  return fetch(`${base}/generate-pdf`, { method: 'POST', headers, body });
}

const validBody = JSON.stringify({ type: 'bordereau-zd', data: BORDEREAU });

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
  consoleError.mockRestore();
  if (server) await new Promise((r) => server!.close(r));
  server = undefined;
});

describe('M1.6 / renderer PDF — tokenMatches (comparaison en temps constant)', () => {
  it('accepte le jeton exact', () => {
    expect(tokenMatches(SECRET, SECRET)).toBe(true);
  });

  it('refuse un jeton de même longueur mais différent', () => {
    const wrong = SECRET.slice(0, -1) + (SECRET.endsWith('f') ? 'e' : 'f');
    expect(wrong).toHaveLength(SECRET.length);
    expect(tokenMatches(wrong, SECRET)).toBe(false);
  });

  it('refuse un jeton de longueur différente (préfixe, suffixe) sans lever', () => {
    expect(tokenMatches(SECRET.slice(0, 5), SECRET)).toBe(false);
    expect(tokenMatches(SECRET + 'x', SECRET)).toBe(false);
  });

  it('refuse header absent, vide ou multi-valué (tableau)', () => {
    expect(tokenMatches(undefined, SECRET)).toBe(false);
    expect(tokenMatches('', SECRET)).toBe(false);
    expect(tokenMatches([SECRET], SECRET)).toBe(false);
    expect(tokenMatches([SECRET, SECRET], SECRET)).toBe(false);
  });
});

describe('M1.6 / renderer PDF — auth X-Internal-Token', () => {
  it('/health répond 200 sans jeton', async () => {
    const base = await start(SECRET);
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('POST /generate-pdf sans jeton → 401', async () => {
    const render = vi.fn<RenderPdf>(async () => FAKE_PDF);
    const base = await start(SECRET, render);
    const res = await post(base, validBody);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(render).not.toHaveBeenCalled();
  });

  it('POST /generate-pdf avec un mauvais jeton → 401', async () => {
    const base = await start(SECRET);
    expect((await post(base, validBody, 'nope')).status).toBe(401);
    expect((await post(base, validBody, SECRET + 'x')).status).toBe(401);
  });

  it('fail-closed : secret absent ou vide → 401 même avec un jeton', async () => {
    for (const secret of [undefined, '']) {
      const base = await start(secret);
      expect((await post(base, validBody, 'anything')).status).toBe(401);
      expect((await post(base, validBody, '')).status).toBe(401);
      // /health reste joignable (sonde Railway).
      expect((await fetch(`${base}/health`)).status).toBe(200);
      await new Promise((r) => server!.close(r));
      server = undefined;
    }
  });

  it('seule /health est exemptée : une route inconnue sans jeton → 401', async () => {
    const base = await start(SECRET);
    expect((await fetch(`${base}/health/../admin`)).status).toBe(401);
    expect((await fetch(`${base}/metrics`)).status).toBe(401);
  });

  it('401 AVANT parsing : JSON invalide sans jeton → 401 (pas 400)', async () => {
    const base = await start(SECRET);
    const res = await post(base, '{not json');
    expect(res.status).toBe(401);
  });

  it('bon jeton → 200 application/pdf', async () => {
    const render = vi.fn<RenderPdf>(async () => FAKE_PDF);
    const base = await start(SECRET, render);
    const res = await post(base, validBody, SECRET);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('x-powered-by')).toBeNull();
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    expect(render).toHaveBeenCalledOnce();
    expect(render.mock.calls[0]![0]).toContain('BSAV-2026-00001');
  });
});

describe('M1.6 / renderer PDF — erreurs génériques (pas de détail interne exposé)', () => {
  it('type inconnu → 400', async () => {
    const base = await start(SECRET);
    const res = await post(
      base,
      JSON.stringify({ type: 'inconnu', data: {} }),
      SECRET,
    );
    expect(res.status).toBe(400);
  });

  it('erreur de template → 422 {error:"template_error", ref}, détail en log seulement', async () => {
    const base = await start(SECRET);
    const res = await post(
      base,
      JSON.stringify({ type: 'bordereau-zd', data: null }),
      SECRET,
    );
    expect(res.status).toBe(422);
    const text = await res.text();
    const body = JSON.parse(text) as { error: string; ref: string };
    expect(body.error).toBe('template_error');
    expect(body.ref).toMatch(/^[0-9a-f-]{36}$/);
    expect(Object.keys(body).sort()).toEqual(['error', 'ref']);
    expect(text).not.toMatch(/TypeError|Cannot read|null/);
    // Le détail + la ref sont loggés côté serveur (retrouvables dans Railway).
    const logged = consoleError.mock.calls.flat().map(String).join(' ');
    expect(logged).toContain(body.ref);
    expect(logged).toMatch(/TypeError/);
  });

  it('erreur Chromium → 500 {error:"render_error", ref}, message interne non renvoyé', async () => {
    const base = await start(SECRET, async () => {
      throw new Error('Failed to launch /tmp/chromium: libnss3.so missing');
    });
    const res = await post(base, validBody, SECRET);
    expect(res.status).toBe(500);
    const text = await res.text();
    const body = JSON.parse(text) as { error: string; ref: string };
    expect(body.error).toBe('render_error');
    expect(body.ref).toMatch(/^[0-9a-f-]{36}$/);
    expect(text).not.toContain('chromium');
    expect(text).not.toContain('libnss3');
    const logged = consoleError.mock.calls.flat().map(String).join(' ');
    expect(logged).toContain(body.ref);
    expect(logged).toContain('libnss3.so missing');
  });

  it('JSON invalide avec bon jeton → 400 {error:"bad_request"} sans stack', async () => {
    const base = await start(SECRET);
    const res = await post(base, '{not json', SECRET);
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: 'bad_request' });
    expect(text).not.toMatch(/SyntaxError|at /);
  });

  it('corps sans Content-Type JSON → 400 (type absent), pas de crash 500', async () => {
    const base = await start(SECRET);
    const res = await fetch(`${base}/generate-pdf`, {
      method: 'POST',
      headers: { 'X-Internal-Token': SECRET },
    });
    expect(res.status).toBe(400);
  });
});
