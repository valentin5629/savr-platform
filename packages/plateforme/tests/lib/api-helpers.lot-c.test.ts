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
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = serverError(
      new Error('column "secret_interne" does not exist'),
      'test.event',
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Erreur serveur');
    expect(JSON.stringify(body)).not.toContain('secret_interne');
    expect(spy).toHaveBeenCalledTimes(1); // l'erreur réelle est loggée serveur
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
