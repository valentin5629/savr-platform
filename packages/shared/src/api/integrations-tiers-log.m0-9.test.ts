import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// logIntegration mocké : on capture la ligne integrations_logs sans toucher la DB.
vi.mock('./integrations-log.js', () => ({
  logIntegration: vi.fn(async () => {}),
}));

import { logIntegration } from './integrations-log.js';
import {
  verifySiret,
  classifyInseeStatus,
  buildInseeLogEntry,
  _setInseeMock,
} from './siret.js';
import { classifyViesResult, buildViesLogEntry } from './tva.js';

const logSpy = vi.mocked(logIntegration);

describe('M0.9 — logs tiers INSEE/VIES (BL-P2-33)', () => {
  describe('classifyInseeStatus', () => {
    it('200 → verifie', () =>
      expect(classifyInseeStatus(200).result).toBe('verifie'));
    it('404 → echec', () =>
      expect(classifyInseeStatus(404).result).toBe('echec'));
    it('429 → down (rate-limit, JAMAIS echec — VOLET 3)', () => {
      const c = classifyInseeStatus(429);
      expect(c.result).toBe('down');
      expect(c.erreur).toContain('429');
    });
    it('400 → echec', () =>
      expect(classifyInseeStatus(400).result).toBe('echec'));
    it('503 → down', () =>
      expect(classifyInseeStatus(503).result).toBe('down'));
  });

  describe('classifyViesResult', () => {
    it('ok + isValid true → verifie', () =>
      expect(classifyViesResult(true, true, 200).result).toBe('verifie'));
    it('ok + isValid false → echec', () =>
      expect(classifyViesResult(true, false, 200).result).toBe('echec'));
    it('!ok 429 → down (rate-limit)', () => {
      const c = classifyViesResult(false, undefined, 429);
      expect(c.result).toBe('down');
      expect(c.erreur).toContain('429');
    });
    it('!ok 500 → down', () =>
      expect(classifyViesResult(false, undefined, 500).result).toBe('down'));
  });

  describe('build*LogEntry : forme integrations_logs SANS secret', () => {
    it('INSEE : intégration/direction/correlation_id, aucun en-tête/secret', () => {
      const e = buildInseeLogEntry({
        statut_http: 429,
        duree_ms: 12,
        siret: '12345678900001',
        erreur: 'INSEE rate-limited (429)',
      });
      expect(e.integration).toBe('insee');
      expect(e.direction).toBe('sortant');
      expect(e.methode).toBe('GET');
      expect(e.correlation_id).toBe('12345678900001');
      expect(e.statut_http).toBe(429);
      const keys = Object.keys(e);
      expect(keys).not.toContain('request_headers');
      expect(keys).not.toContain('headers');
      const blob = JSON.stringify(e).toLowerCase();
      expect(blob).not.toContain('authorization');
      expect(blob).not.toContain('bearer');
    });
    it('VIES : integration=vies, correlation_id = n° TVA', () => {
      const e = buildViesLogEntry({
        statut_http: 200,
        duree_ms: 5,
        tva: 'FR12345678900',
        erreur: null,
      });
      expect(e.integration).toBe('vies');
      expect(e.correlation_id).toBe('FR12345678900');
    });
  });

  describe('verifySiret : journalise le chemin réel (best-effort, non bloquant)', () => {
    beforeEach(() => {
      logSpy.mockClear();
      _setInseeMock(null); // force le chemin réel (pas de mock verdict)
      vi.stubEnv('INSEE_API_TOKEN', 'tok-test');
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    });

    it('200 → verifie + 1 log integration=insee statut_http=200', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ status: 200 }) as Response),
      );
      const r = await verifySiret('12345678900001');
      expect(r).toBe('verifie');
      expect(logSpy).toHaveBeenCalledTimes(1);
      const entry = logSpy.mock.calls[0]![0];
      expect(entry.integration).toBe('insee');
      expect(entry.statut_http).toBe(200);
      expect(entry.correlation_id).toBe('12345678900001');
    });

    it('429 → down + log statut_http=429', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ status: 429 }) as Response),
      );
      const r = await verifySiret('12345678900001');
      expect(r).toBe('down');
      const entry = logSpy.mock.calls[0]![0];
      expect(entry.statut_http).toBe(429);
    });

    it('timeout/réseau → down + log statut_http null', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new Error('network');
        }),
      );
      const r = await verifySiret('12345678900001');
      expect(r).toBe('down');
      expect(logSpy).toHaveBeenCalledTimes(1);
      const entry = logSpy.mock.calls[0]![0];
      expect(entry.statut_http).toBeNull();
    });
  });
});
