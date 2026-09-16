/**
 * Sentry serveur réellement initialisé + filtrage des secrets (revue #338).
 *
 * Constat 2026-09-16 : aucun `instrumentation.ts` → `sentry.server.config.ts`
 * jamais chargé par Next 15 / @sentry/nextjs 10 → le sink restait le no-op et
 * tout `captureException` serveur (emitCronFailed, slack.send_failed…) était perdu.
 *
 * Le test passe par le VRAI SDK : `register()` est appelé comme Next le fait, et
 * l'enveloppe est lue au hook `beforeEnvelope` du client, juste avant l'envoi.
 * Le DSN vise un port local fermé : rien ne sort de la machine.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Breadcrumb, ErrorEvent } from '@sentry/nextjs';

import {
  assainirUrl,
  filtrerBreadcrumb,
  filtrerEvenement,
} from '@/lib/sentry-filtrage';

const RACINE_PKG = path.resolve(__dirname, '../..');
// Valeurs sensibles construites au runtime : l'intégration ContextLines du SDK
// recopie les lignes de source autour des frames, un littéral écrit près de
// l'appel apparaîtrait dans l'enveloppe et fausserait l'assertion.
const JETON = ['JETON', 'SECRET', 'xyz123'].join('');
const ADRESSE = ['rue', 'de', 'Paris'].join('+');
const URL_SLACK = `https://hooks.slack.com/services/T0AAA/B0BBB/${JETON}`;

describe('M0.9 — instrumentation.ts : emplacement chargé par Next', () => {
  it('vit dans src/ (app dans src/app), jamais à la racine du package', () => {
    expect(fs.existsSync(path.join(RACINE_PKG, 'src/instrumentation.ts'))).toBe(
      true,
    );
    for (const ext of ['ts', 'js', 'mjs']) {
      expect(
        fs.existsSync(path.join(RACINE_PKG, `instrumentation.${ext}`)),
      ).toBe(false);
    }
  });
});

describe('M0.9 — Sentry serveur via register() (SDK réel)', () => {
  const enveloppes: string[] = [];
  let Sentry: typeof import('@sentry/nextjs');
  let shared: typeof import('@savr/shared/src/alerting/sentry.js');
  const envAvant = {
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    runtime: process.env.NEXT_RUNTIME,
    environnement: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
  };

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'http://cle@127.0.0.1:9/1';
    process.env.NEXT_RUNTIME = 'nodejs';
    process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT = 'preview';
    Sentry = await import('@sentry/nextjs');
    shared = await import('@savr/shared/src/alerting/sentry.js');
  });

  afterAll(async () => {
    await Sentry.close(0).catch(() => undefined);
    if (envAvant.dsn === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    else process.env.NEXT_PUBLIC_SENTRY_DSN = envAvant.dsn;
    if (envAvant.runtime === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = envAvant.runtime;
    if (envAvant.environnement === undefined)
      delete process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT;
    else process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT = envAvant.environnement;
  });

  it('M0.9-4 — Sentry Next.js intégration via sentry.client.config.ts + sentry.server.config.ts', async () => {
    // Avant register() : aucun client, le sink partagé est le no-op.
    expect(Sentry.getClient()).toBeUndefined();

    const instrumentation = await import('@/instrumentation');
    expect(instrumentation.onRequestError).toBe(Sentry.captureRequestError);
    await instrumentation.register();

    const client = Sentry.getClient();
    expect(client).toBeDefined();
    // Pas d'IP ni de cookies ajoutés par le SDK (intégration RequestData).
    expect(client!.getOptions().sendDefaultPii).toBe(false);
    // Preview et Production distingués (NODE_ENV vaut production dans les deux).
    expect(client!.getOptions().environment).toBe('preview');
    client!.on('beforeEnvelope', (env) => {
      enveloppes.push(JSON.stringify(env));
    });

    // Breadcrumb tel que le produit l'intégration fetch sur un envoi Slack.
    Sentry.addBreadcrumb({
      category: 'http',
      type: 'http',
      data: {
        url: URL_SLACK,
        'http.method': 'POST',
        'http.query': `?adresse=12+${ADRESSE}`,
        status_code: 500,
      },
    });

    // Filtré dès l'enregistrement (beforeBreadcrumb), pas seulement à l'envoi :
    // beforeSend refiltre aussi les breadcrumbs, l'enveloppe seule ne
    // distinguerait pas les deux gardes.
    const enregistres = Sentry.getIsolationScope().getScopeData().breadcrumbs;
    expect(enregistres.at(-1)?.data).toEqual({
      url: 'https://hooks.slack.com/[Filtered]',
      'http.method': 'POST',
      status_code: 500,
    });

    // Passe par le sink PARTAGÉ (celui des call-sites serveur), pas par Sentry.
    shared.captureException(new Error(`échec POST ${URL_SLACK}`), {
      role: 'admin_savr',
      organisation_id: 'org-1',
    });
    await Sentry.flush(2000);

    const evt = enveloppes.find((e) => e.includes('"type":"event"'));
    expect(
      evt,
      'le sink partagé doit atteindre le client Sentry',
    ).toBeDefined();
    expect(evt).toContain('"role":"admin_savr"');
    expect(evt).toContain('"environment":"preview"');
    expect(evt).toContain('hooks.slack.com/[Filtered]');
    expect(evt).not.toContain(JETON);
    expect(evt).not.toContain(ADRESSE);
  });
});

describe('M0.9 — filtrage Sentry : breadcrumbs', () => {
  it('masque le chemin d’un webhook Slack et retire query + fragment', () => {
    const b = filtrerBreadcrumb({
      category: 'http',
      data: {
        url: URL_SLACK,
        'http.query': '?a=1',
        'http.fragment': '#f',
        status_code: 200,
      },
    });
    expect(b.data).toEqual({
      url: 'https://hooks.slack.com/[Filtered]',
      status_code: 200,
    });
  });

  it('garde le chemin d’un hôte ordinaire mais jamais sa query', () => {
    const b = filtrerBreadcrumb({
      data: { url: 'https://s3.example.com/photos/p.jpg?X-Amz-Signature=abc' },
    });
    expect(b.data?.['url']).toBe('https://s3.example.com/photos/p.jpg');
  });

  it('navigation : fragment #access_token retiré de from/to', () => {
    const b: Breadcrumb = filtrerBreadcrumb({
      category: 'navigation',
      data: { from: '/login', to: '/reset#access_token=eyJ.secret' },
    });
    expect(b.data).toEqual({ from: '/login', to: '/reset' });
  });

  it('breadcrumb console : arguments bruts assainis comme le message', () => {
    const b = filtrerBreadcrumb({
      category: 'console',
      message: `envoi ${URL_SLACK}`,
      data: { arguments: ['envoi', URL_SLACK, 42], logger: 'console' },
    });
    expect(JSON.stringify(b)).not.toContain(JETON);
    expect(b.data?.['arguments']).toEqual([
      'envoi',
      'https://hooks.slack.com/[Filtered]',
      42,
    ]);
  });

  it('breadcrumb console : Error et objets imbriqués assainis (message, stack)', () => {
    const err = new Error(`échec POST ${URL_SLACK}`);
    const b = filtrerBreadcrumb({
      category: 'console',
      data: {
        arguments: [
          err,
          {
            contexte: { url: `https://photos.example.com/p.jpg?sig=${JETON}` },
          },
        ],
      },
    });
    const serialise = JSON.stringify(b);
    expect(serialise).not.toContain(JETON);
    const [e0] = b.data?.['arguments'] as Array<Record<string, unknown>>;
    expect(e0?.['message']).toBe(
      'échec POST https://hooks.slack.com/[Filtered]',
    );
    expect(typeof e0?.['stack']).toBe('string');
  });

  it('arguments console : cycle, largeur et binaire bornés, getter qui lève masqué', () => {
    const cyclique: Record<string, unknown> = { url: URL_SLACK };
    for (let i = 0; i < 30; i++) cyclique[`k${i}`] = cyclique;
    const largeur = Array.from({ length: 100_000 }, (_, i) => ({ i }));
    const binaire = Buffer.alloc(5 * 1024 * 1024, 1);
    const piege = {
      get url(): string {
        throw new Error(URL_SLACK);
      },
    };

    const debut = performance.now();
    const b = filtrerBreadcrumb({
      category: 'console',
      data: { arguments: [cyclique, largeur, binaire, piege] },
    });
    const duree = performance.now() - debut;

    expect(duree).toBeLessThan(200);
    expect(JSON.stringify(b)).not.toContain(JETON);
    const args = b.data?.['arguments'] as unknown[];
    expect(args[2]).toBe('[Filtered]');
    expect((args[1] as unknown[]).length).toBeLessThan(1000);
    expect(args[3]).toEqual({ url: '[Filtered]' });
  });

  it('arguments console : primitives au budget, __proto__ conservé, Proxy qui lève masqué', () => {
    const urls = Array.from({ length: 1_000_000 }, () => URL_SLACK);
    const json = JSON.parse(
      `{"__proto__": {"url": "${URL_SLACK}"}}`,
    ) as unknown;
    const proxy = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error(URL_SLACK);
        },
      },
    );

    const debut = performance.now();
    const b = filtrerBreadcrumb({
      category: 'console',
      data: { arguments: [urls, json, proxy] },
    });
    const duree = performance.now() - debut;

    expect(duree).toBeLessThan(200);
    expect(JSON.stringify(b)).not.toContain(JETON);
    const args = b.data?.['arguments'] as unknown[];
    expect((args[0] as unknown[]).length).toBeLessThanOrEqual(501);
    expect(JSON.stringify(args[1])).toBe(
      '{"__proto__":{"url":"https://hooks.slack.com/[Filtered]"}}',
    );
    expect(args[2]).toBe('[Filtered]');
  });

  it('SIRET / n° TVA dans le chemin INSEE / VIES : chemin masqué', () => {
    const siret = ['732', '829', '320', '00074'].join('');
    const b = filtrerBreadcrumb({
      data: {
        url: `https://api.insee.fr/entreprises/sirene/V3.11/siret/${siret}`,
      },
    });
    expect(b.data?.['url']).toBe('https://api.insee.fr/[Filtered]');
    expect(
      assainirUrl(
        `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/FR/vat/${siret}`,
      ),
    ).toBe('https://ec.europa.eu/[Filtered]');
  });

  it('message console contenant une URL Slack : chemin masqué', () => {
    const b = filtrerBreadcrumb({ message: `POST ${URL_SLACK} -> 404` });
    expect(b.message).toBe('POST https://hooks.slack.com/[Filtered] -> 404');
  });
});

describe('M0.9 — filtrage Sentry : events', () => {
  it('requête entrante : en-têtes, cookies, query et corps retirés', () => {
    const e = filtrerEvenement({
      type: undefined,
      request: {
        url: 'https://app.gosavr.io/api/webhooks/transporteur?token=SECRET',
        method: 'POST',
        headers: { 'x-webhook-token': 'SECRET', 'x-internal-token': 'SECRET' },
        cookies: { 'sb-access-token': 'SECRET' },
        query_string: 'token=SECRET',
        data: 'mission_id=1',
      },
      contexts: {
        nextjs: { request_path: '/api/webhooks/transporteur?token=SECRET' },
      },
    } as ErrorEvent);
    expect(JSON.stringify(e)).not.toContain('SECRET');
    expect(e.request).toEqual({
      url: 'https://app.gosavr.io/api/webhooks/transporteur',
      method: 'POST',
    });
    expect(e.contexts?.['nextjs']?.['request_path']).toBe(
      '/api/webhooks/transporteur',
    );
  });

  it('message et valeur d’exception : URL Slack masquée', () => {
    const e = filtrerEvenement({
      type: undefined,
      message: `x ${URL_SLACK}`,
      exception: { values: [{ type: 'Error', value: `y ${URL_SLACK}` }] },
    } as ErrorEvent);
    expect(JSON.stringify(e)).not.toContain(JETON);
  });

  it('breadcrumbs portés par l’event : refiltrés à l’envoi (beforeSend)', () => {
    const e = filtrerEvenement({
      type: undefined,
      breadcrumbs: [{ category: 'http', data: { url: URL_SLACK } }],
    } as ErrorEvent);
    expect(e.breadcrumbs?.[0]?.data?.['url']).toBe(
      'https://hooks.slack.com/[Filtered]',
    );
  });

  it('texte libre : port, identifiants, casse et query de toute URL', () => {
    const texte = [
      `a https://hooks.slack.com:443/services/T/B/${JETON}`,
      `b https://u:p@HOOKS.slack.com/services/T/B/${JETON}`,
      `c https://photos.example.com/p/1.jpg?X-Amz-Signature=${JETON}`,
    ].join('\n');
    const e = filtrerEvenement({
      type: undefined,
      exception: { values: [{ type: 'Error', value: texte }] },
    } as ErrorEvent);
    const valeur = e.exception?.values?.[0]?.value ?? '';
    expect(valeur).not.toContain(JETON);
    expect(valeur).not.toContain('u:p@');
    expect(valeur).toContain('https://photos.example.com/p/1.jpg');
  });

  it('assainirUrl : sous-domaine Slack, identifiants et URL non parsable', () => {
    expect(assainirUrl('https://u:p@x.hooks.slack.com/a/b?c')).toBe(
      'https://x.hooks.slack.com/[Filtered]',
    );
    expect(assainirUrl('https://u:p@api.example.com/v3/tours?x=1')).toBe(
      'https://api.example.com/v3/tours',
    );
    expect(assainirUrl(`::: ${URL_SLACK}`)).not.toContain(JETON);
  });
});
