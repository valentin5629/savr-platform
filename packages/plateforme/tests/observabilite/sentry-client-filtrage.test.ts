/**
 * Câblage du filtrage dans `sentry.client.config.ts` (navigateur).
 *
 * Le SDK navigateur ne s'exécute pas sous vitest (node) : on capture les options
 * passées à `Sentry.init` par un mock, puis on exerce les callbacks RÉELLEMENT
 * câblés dans le fichier de config — pas les fonctions pures isolément.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Breadcrumb, BrowserOptions, ErrorEvent } from '@sentry/nextjs';

const JETON = ['JETON', 'CLIENT', '987'].join('');

describe('M0.9 — Sentry navigateur : filtrage câblé dans sentry.client.config.ts', () => {
  const dsnAvant = process.env.NEXT_PUBLIC_SENTRY_DSN;
  const environnementAvant = process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT;

  afterEach(() => {
    vi.doUnmock('@sentry/nextjs');
    vi.resetModules();
    if (dsnAvant === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    else process.env.NEXT_PUBLIC_SENTRY_DSN = dsnAvant;
    if (environnementAvant === undefined)
      delete process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT;
    else process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT = environnementAvant;
  });

  it('init avec sendDefaultPii false, beforeBreadcrumb et beforeSend filtrants', async () => {
    const init = vi.fn();
    vi.resetModules();
    vi.doMock('@sentry/nextjs', () => ({
      init,
      withScope: vi.fn(),
      captureException: vi.fn(),
    }));
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'http://cle@127.0.0.1:9/1';
    process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT = 'production';

    await import('../../sentry.client.config');

    expect(init).toHaveBeenCalledTimes(1);
    const options = init.mock.calls[0]![0] as BrowserOptions;
    expect(options.sendDefaultPii).toBe(false);
    expect(options.environment).toBe('production');

    const crumb = options.beforeBreadcrumb!(
      {
        category: 'navigation',
        data: { from: '/login', to: `/reset#access_token=${JETON}` },
      } as Breadcrumb,
      undefined,
    );
    expect(JSON.stringify(crumb)).not.toContain(JETON);

    const evt = (await options.beforeSend!(
      {
        type: undefined,
        request: {
          url: `https://app.gosavr.io/reset?code=${JETON}`,
          headers: { cookie: JETON },
        },
      } as ErrorEvent,
      {},
    )) as ErrorEvent;
    expect(JSON.stringify(evt)).not.toContain(JETON);
  });
});
