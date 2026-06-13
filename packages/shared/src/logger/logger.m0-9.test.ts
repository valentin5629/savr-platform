import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  logger,
  sanitizePayload,
  setLogContext,
  clearLogContext,
} from './index.js';

describe('M0.9 — Logger structuré', () => {
  beforeEach(() => {
    clearLogContext();
  });

  it('émet une ligne JSON conforme au schéma figé sur stdout', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logger.info('collecte.scheduled', { collecte_id: 'abc', type: 'zd' });

    expect(spy).toHaveBeenCalledOnce();
    const raw = spy.mock.calls[0]![0]! as string;
    const entry = JSON.parse(raw);

    expect(entry).toMatchObject({
      level: 'info',
      service: 'platform',
      event: 'collecte.scheduled',
      payload: { collecte_id: 'abc', type: 'zd' },
    });
    expect(typeof entry.ts).toBe('string');
    expect(entry.actor_id).toBeNull();
    expect(entry.actor_role).toBeNull();
    expect(entry.org_id).toBeNull();

    spy.mockRestore();
  });

  it('émet level warn correctement', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logger.warn('pesee.hors_seuil', {
      pesee_id: '1',
      collecte_id: '2',
      type_depassement: 'max',
    });

    const entry = JSON.parse(spy.mock.calls[0]![0]! as string);
    expect(entry.level).toBe('warn');

    spy.mockRestore();
  });

  it('émet level error correctement', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logger.error('pdf.job_failed', {
      job_id: '1',
      type_doc: 'bordereau',
      collecte_id: '2',
      retry_count: 3,
    });

    const entry = JSON.parse(spy.mock.calls[0]![0]! as string);
    expect(entry.level).toBe('error');

    spy.mockRestore();
  });

  it('propage le contexte global (actor_id, org_id, actor_role)', () => {
    setLogContext({
      actor_id: 'user-1',
      actor_role: 'admin_savr',
      org_id: 'org-1',
    });
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logger.info('organisation.created', { org_id: 'org-1' });

    const entry = JSON.parse(spy.mock.calls[0]![0]! as string);
    expect(entry.actor_id).toBe('user-1');
    expect(entry.actor_role).toBe('admin_savr');
    expect(entry.org_id).toBe('org-1');

    spy.mockRestore();
  });

  it("permet un override de contexte au niveau de l'appel", () => {
    setLogContext({ actor_id: 'user-global', actor_role: 'admin_savr' });
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logger.info(
      'user.invited',
      {},
      { actor_id: 'user-override', actor_role: 'traiteur_manager' },
    );

    const entry = JSON.parse(spy.mock.calls[0]![0]! as string);
    expect(entry.actor_id).toBe('user-override');
    expect(entry.actor_role).toBe('traiteur_manager');

    spy.mockRestore();
  });
});

describe('M0.9 — sanitizePayload (RGPD)', () => {
  it('ne laisse jamais un email en clair', () => {
    const result = sanitizePayload({ email: 'valentin@gosavr.io' });
    expect(result.email).not.toBe('valentin@gosavr.io');
    expect(result.email).toContain('***');
  });

  it('masque les champs sensibles (password, token)', () => {
    const result = sanitizePayload({
      password: 'secret123',
      token: 'jwt.xxx.yyy',
    });
    expect(result.password).toBe('[REDACTED]');
    expect(result.token).toBe('[REDACTED]');
  });

  it('laisse passer les champs non sensibles', () => {
    const result = sanitizePayload({ collecte_id: 'abc', poids_kg: 42 });
    expect(result.collecte_id).toBe('abc');
    expect(result.poids_kg).toBe(42);
  });
});
