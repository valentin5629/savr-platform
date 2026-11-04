import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { enTetesSecurite, politiqueDeContenu } from './en-tetes-securite';

const valeur = (cle: string, supabaseUrl?: string) =>
  enTetesSecurite(true, supabaseUrl).find((e) => e.key === cle)?.value;

describe('en-têtes de sécurité', () => {
  it('pose les cinq en-têtes attendus, avec leurs valeurs', () => {
    expect(enTetesSecurite(true).map((e) => e.key)).toEqual([
      'Content-Security-Policy',
      'X-Frame-Options',
      'X-Content-Type-Options',
      'Referrer-Policy',
      'Permissions-Policy',
    ]);
    expect(valeur('X-Frame-Options')).toBe('DENY');
    expect(valeur('X-Content-Type-Options')).toBe('nosniff');
    expect(valeur('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(valeur('Permissions-Policy')).toBe(
      'camera=(), microphone=(), geolocation=(), payment=()',
    );
  });

  it('politique de production exacte (projet Supabase hébergé)', () => {
    expect(politiqueDeContenu(true, 'https://abcdefgh.supabase.co')).toBe(
      "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline'; " +
        "style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: blob: https:; " +
        "font-src 'self' data:; " +
        "connect-src 'self' https://*.supabase.co https://*.ingest.de.sentry.io; " +
        "frame-src 'self'; " +
        "object-src 'none'; " +
        "base-uri 'self'; " +
        "form-action 'self'; " +
        "frame-ancestors 'none'",
    );
  });

  it('autorise la base Supabase locale de l’E2E, ignore une URL invalide', () => {
    expect(politiqueDeContenu(true, 'http://localhost:54321')).toContain(
      "connect-src 'self' https://*.supabase.co http://localhost:54321 https://*.ingest.de.sentry.io;",
    );
    expect(politiqueDeContenu(true, 'pas une url')).toBe(
      politiqueDeContenu(true),
    );
  });

  it('en local : garde le rechargement à chaud de next dev', () => {
    const csp = politiqueDeContenu(false);
    expect(csp).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval';");
    expect(csp).toContain('https://*.ingest.de.sentry.io ws:;');
  });

  it('next.config.ts les applique à toutes les routes', () => {
    const config = readFileSync(
      join(__dirname, '..', '..', 'next.config.ts'),
      'utf8',
    );
    expect(config).toContain("source: '/:path*'");
    expect(config).toMatch(
      /headers: enTetesSecurite\(\s*process\.env\.NODE_ENV === 'production',\s*process\.env\.NEXT_PUBLIC_SUPABASE_URL,?\s*\)/,
    );
  });
});
