/**
 * Cliquet — toute route API porte sa propre garde d'authentification.
 *
 * Le middleware Next (src/middleware.ts) exclut délibérément `/api/*` : les
 * appelants tiers (Vercel Cron, webhooks emails/logistique, Better Uptime) n'ont pas
 * de cookie de session, et une redirection 307 vers /login casserait le contrat
 * JSON 401/403 des routes. La contrepartie : aucune route API n'a de filet en
 * amont. Ce test l'impose mécaniquement — chaque handler HTTP exporté doit appeler
 * une garde reconnue, sauf exception listée ci-dessous avec sa justification.
 *
 * Nouvelle route publique ou garde d'un autre type → l'ajouter à EXCEPTIONS,
 * consciemment, avec la raison.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import { describe, it, expect } from 'vitest';

const API = resolve(__dirname, '../../src/app/api');

// Gardes de session applicatives (src/lib/api-auth.ts, src/lib/registre/guard.ts).
const GARDE_SESSION =
  /\brequire(?:Staff|Admin|User|AnyUser|Programmateur|ProgrammateurOuAdmin|RegistreUser)\s*\(/g;

// Chemin (relatif à src/app/api, sans /route.ts) → garde attendue + raison.
const EXCEPTIONS: Record<string, { garde: RegExp | null; raison: string }> = {
  // Authentification : publiques par nature (rate-limit/validation internes).
  'auth/login': { garde: null, raison: 'connexion' },
  'auth/signup': { garde: null, raison: 'inscription self-service' },
  'auth/reset-password': { garde: null, raison: 'demande de lien de reset' },
  'auth/verify-email': { garde: null, raison: 'lien de vérification email' },
  'auth/logout': {
    garde: null,
    raison: 'déconnexion (sans effet sans session)',
  },
  'auth/update-password': {
    garde: /auth\.getUser\(/,
    raison: 'session de recovery GoTrue',
  },
  'auth/exit-impersonation': {
    garde: /auth\.getUser\(/,
    raison: 'session impersonée',
  },
  // Sondes : liveness publique (Better Uptime), détail réservé staff.
  health: { garde: null, raison: 'liveness Better Uptime, sans donnée' },
  'health/full': { garde: /auth\.getUser\(/, raison: 'staff (claim vérifié)' },
  'health/logistique': {
    garde: /auth\.getUser\(/,
    raison: 'staff (claim vérifié)',
  },
  // Configuration de navigation statique, sans donnée utilisateur.
  nav: { garde: null, raison: 'NAV_CONFIG statique' },
  // Webhooks tiers : authentifiés par signature / jeton partagé.
  'webhooks/resend': {
    garde: /\bverifySvixSignature\(/,
    raison: 'signature Svix',
  },
  'webhooks/everest': {
    garde: /\btimingSafeEqual\(/,
    raison: 'jeton X-Webhook-Token',
  },
};

// Crons Vercel : Bearer CRON_SECRET (comportement 401 testé par
// tests/api/cron/cron-methode-get.test.ts).
const GARDE_CRON = /\b(?:withCronObservability|assertCronAuth)\s*\(/;

const METHODE =
  /export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g;

function sansCommentaires(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function routes(dir = API): string[] {
  return readdirSync(dir).flatMap((nom) => {
    const p = join(dir, nom);
    if (statSync(p).isDirectory()) return routes(p);
    return nom === 'route.ts' ? [relative(API, dir).split(sep).join('/')] : [];
  });
}

const TOUTES = routes();

describe('routes API — garde propre obligatoire (middleware exclut /api)', () => {
  it('garde anti-vacuité : les routes sont bien énumérées', () => {
    expect(TOUTES.length).toBeGreaterThan(150);
  });

  it('chaque exception pointe une route existante', () => {
    const inconnues = Object.keys(EXCEPTIONS).filter(
      (r) => !TOUTES.includes(r),
    );
    expect(inconnues).toEqual([]);
  });

  it('chaque handler exporté appelle une garde reconnue', () => {
    const fautives: string[] = [];
    for (const route of TOUTES) {
      const src = sansCommentaires(
        readFileSync(join(API, route, 'route.ts'), 'utf8'),
      );
      const methodes = [...src.matchAll(METHODE)].map((m) => m[1]);
      const exception = EXCEPTIONS[route];

      if (exception) {
        if (exception.garde && !exception.garde.test(src)) {
          fautives.push(`${route} : garde attendue ${exception.garde} absente`);
        }
        continue;
      }
      if (route.startsWith('cron/')) {
        if (!GARDE_CRON.test(src))
          fautives.push(`${route} : pas de garde cron`);
        continue;
      }
      // Autant d'appels de garde que de handlers : un GET gardé ne couvre pas
      // un POST ajouté sans garde dans le même fichier.
      const gardes = src.match(GARDE_SESSION)?.length ?? 0;
      if (methodes.length === 0 || gardes < methodes.length) {
        fautives.push(
          `${route} : ${gardes} garde(s) pour ${methodes.length} handler(s) [${methodes.join(',')}]`,
        );
      }
    }
    expect(fautives).toEqual([]);
  });
});
