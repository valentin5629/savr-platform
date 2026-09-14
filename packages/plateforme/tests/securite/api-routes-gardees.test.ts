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
 *
 * Les route handlers HORS `/api` (ex. `src/app/auth/**`) sont soumis à la même
 * règle : `/auth` est aussi exclu du middleware (PUBLIC_PREFIXES), ils n'ont donc
 * pas davantage de filet en amont (revue sécurité #281 — callback d'impersonation).
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import { describe, it, expect } from 'vitest';

const APP = resolve(__dirname, '../../src/app');
const API = join(APP, 'api');
// Répertoires de routing que Next sert sans passer par src/app : Pages Router
// (`src/pages`), et les variantes à la racine du package quand `src/` n'est pas
// utilisé (`pages`, `app`). Tous sont hors du scan ci-dessous ET hors middleware
// (`api(?:/|$)` exclu) — un handler qui s'y glisse est un endpoint nu (#286).
const RACINES_HORS_SCAN = ['src/pages', 'pages', 'app'] as const;
// Next lit le PREMIER de ces trois fichiers : un `next.config.js` primerait sur
// le `.ts` et y cacherait un `pageExtensions` (revue sécurité #288, R1).
const CONFIGS_NEXT = ['next.config.js', 'next.config.mjs', 'next.config.ts'];

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

// Next.js reconnait un route handler sous ces quatre noms — le cliquet doit les
// couvrir tous, sinon un handler `route.tsx` échappe silencieusement à la règle
// (revue sécurité #284).
const FICHIER_ROUTE = /^route\.(?:t|j)sx?$/;

type Handler = { route: string; fichier: string };

function routes(racine: string, dir = racine): Handler[] {
  return readdirSync(dir).flatMap((nom) => {
    const p = join(dir, nom);
    if (statSync(p).isDirectory()) {
      // Sous-arbre /api couvert par TOUTES, pas par HORS_API.
      return racine === APP && p === API ? [] : routes(racine, p);
    }
    return FICHIER_ROUTE.test(nom)
      ? [{ route: relative(racine, dir).split(sep).join('/'), fichier: nom }]
      : [];
  });
}

const TOUTES = routes(API);
const CHEMINS = TOUTES.map((h) => h.route);

// Route handlers hors /api (chemin relatif à src/app). Aucune garde de session
// possible ici : chacun doit être listé avec la garde qui le protège.
const HORS_API = routes(APP);
const CHEMINS_HORS_API = HORS_API.map((h) => h.route);
const EXCEPTIONS_HORS_API: Record<string, { garde: RegExp; raison: string }> = {
  'auth/impersonate-callback': {
    garde: /\bverifyOtp\([\s\S]*\bverifierImpersonation\(/,
    raison:
      'OTP magiclink + impersonation enregistrée par /impersoner (jeton, admin, cible, usage unique)',
  },
};

describe('routes API — garde propre obligatoire (middleware exclut /api)', () => {
  it('le scan couvre les 4 noms de handler acceptés par Next', () => {
    // Sans cette garde, un retour à /^route\.ts$/ resterait vert tant que tous
    // les handlers du repo sont en .ts — soit exactement le trou corrigé ici.
    const acceptes = ['route.ts', 'route.tsx', 'route.js', 'route.jsx'];
    expect(acceptes.filter((n) => !FICHIER_ROUTE.test(n))).toEqual([]);
    for (const n of ['routes.ts', 'route.d.ts', 'route.test.ts', 'route.mts'])
      expect(FICHIER_ROUTE.test(n)).toBe(false);
  });

  it("le scan n'est pas contourné par un autre répertoire de routing", () => {
    // La convention V1 est App Router sous `src/` (CDC §07, 9.1.12) : on refuse
    // ces répertoires plutôt que de dupliquer la garde. Si l'un devient
    // nécessaire, étendre la racine du scan (routes()) en même temps.
    const presents = RACINES_HORS_SCAN.filter((r) =>
      existsSync(resolve(__dirname, '../..', r)),
    );
    expect(presents).toEqual([]);
  });

  it('les 4 extensions du scan restent celles que Next applique', () => {
    // FICHIER_ROUTE dérive du défaut Next (tsx|ts|jsx|js). Définir `pageExtensions`
    // changerait cette liste et désynchroniserait le scan en silence : soit on ne
    // le définit pas, soit FICHIER_ROUTE doit en être dérivé. Contrôlé sur TOUS
    // les fichiers de config présents, pas seulement celui que Next retiendra.
    const presents = CONFIGS_NEXT.map((n) =>
      resolve(__dirname, '../..', n),
    ).filter((p) => existsSync(p));
    expect(presents.length).toBeGreaterThan(0); // anti-vacuité
    const fautifs = presents.filter((p) =>
      /\bpageExtensions\b/.test(sansCommentaires(readFileSync(p, 'utf8'))),
    );
    expect(fautifs).toEqual([]);
  });

  it('garde anti-vacuité : les routes sont bien énumérées', () => {
    expect(TOUTES.length).toBeGreaterThan(150);
  });

  it('chaque exception pointe une route existante', () => {
    const inconnues = Object.keys(EXCEPTIONS).filter(
      (r) => !CHEMINS.includes(r),
    );
    expect(inconnues).toEqual([]);
  });

  it('chaque handler exporté appelle une garde reconnue', () => {
    const fautives: string[] = [];
    for (const { route, fichier } of TOUTES) {
      const src = sansCommentaires(
        readFileSync(join(API, route, fichier), 'utf8'),
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

describe('route handlers hors /api — garde propre obligatoire (middleware exclut /auth)', () => {
  it("garde anti-vacuité : le callback d'impersonation est énuméré", () => {
    expect(CHEMINS_HORS_API).toContain('auth/impersonate-callback');
  });

  it('chaque route hors /api appelle une garde reconnue', () => {
    const fautives: string[] = [];
    for (const { route, fichier } of HORS_API) {
      const exception = EXCEPTIONS_HORS_API[route];
      const src = sansCommentaires(
        readFileSync(join(APP, route, fichier), 'utf8'),
      );
      if (!exception) {
        const methodes = [...src.matchAll(METHODE)].length;
        const gardes = src.match(GARDE_SESSION)?.length ?? 0;
        if (methodes === 0 || gardes < methodes) {
          fautives.push(`${route} : ni garde de session ni exception listée`);
        }
        continue;
      }
      if (!exception.garde.test(src)) {
        fautives.push(`${route} : garde attendue ${exception.garde} absente`);
      }
    }
    expect(fautives).toEqual([]);
  });

  it('chaque exception pointe une route existante', () => {
    expect(
      Object.keys(EXCEPTIONS_HORS_API).filter(
        (r) => !CHEMINS_HORS_API.includes(r),
      ),
    ).toEqual([]);
  });
});
