// Régression Lot C — helpers de durcissement (C1 / C2 / C4).
import { describe, expect, it, vi } from 'vitest';

import {
  readJsonBody,
  sanitizeOrTerm,
  serverError,
} from '../../src/lib/api-helpers.js';

describe('Lot C / C2 — sanitizeOrTerm', () => {
  it('retire les caractères de la grammaire PostgREST .or (virgule, parenthèses)', () => {
    expect(sanitizeOrTerm('a,b')).not.toContain(',');
    expect(sanitizeOrTerm('x)or(nom.ilike.*')).not.toMatch(/[()]/);
    expect(sanitizeOrTerm('a"b\\c')).not.toMatch(/["\\]/);
  });
  it('préserve un terme de recherche normal', () => {
    expect(sanitizeOrTerm('Du Pré')).toBe('Du Pré');
    expect(sanitizeOrTerm('  martin  ')).toBe('martin');
  });
});

describe('Lot C / C1 — serverError', () => {
  it('renvoie 500 + message générique, jamais le détail DB ; logge côté serveur', async () => {
    // R15 : serverError logge via le logger @savr/shared → puits console.log
    // (JSON structuré, event api_route.error). Le détail DB reste côté SERVEUR.
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const res = serverError(
      new Error('column "secret_interne" does not exist'),
      'test.event',
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Erreur serveur');
    // La RÉPONSE client ne fuite jamais le détail DB…
    expect(JSON.stringify(body)).not.toContain('secret_interne');
    // …mais le LOG serveur émet bien l'event api_route.error (debug d'incident).
    expect(spy).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(spy.mock.calls[0]![0] as string) as {
      event: string;
      payload: { route: string };
    };
    expect(entry.event).toBe('api_route.error');
    expect(entry.payload.route).toBe('test.event');
    spy.mockRestore();
  });
});

describe('Lot C / C4 — readJsonBody', () => {
  it('JSON valide → { data }', async () => {
    const req = new Request('http://x', {
      method: 'POST',
      body: JSON.stringify({ a: 1 }),
    });
    const r = await readJsonBody<{ a: number }>(req);
    expect('data' in r).toBe(true);
    if ('data' in r) expect(r.data.a).toBe(1);
  });
  it('JSON malformé → { error } 400 (pas de 500)', async () => {
    const req = new Request('http://x', { method: 'POST', body: '{not json' });
    const r = await readJsonBody(req);
    expect('error' in r).toBe(true);
    if ('error' in r) expect(r.error.status).toBe(400);
  });
});
