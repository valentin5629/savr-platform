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
 *
 * Deux familles d'entrées HTTP ne s'écrivent PAS dans un fichier `route.*` et
 * échappent donc par construction au scan ci-dessus (revue sécurité #286) :
 *
 *  • Server Actions (`'use server'`) — Next les expose en POST sur le pathname de
 *    la page qui les appelle, adressées par identifiant d'action. Le middleware ne
 *    les filtre donc que si ce pathname l'est : appelée depuis une page sous un
 *    préfixe public (cf. `PUBLIC_PREFIXES` dans `src/middleware.ts` — ne pas en
 *    recopier la liste ici, elle dériverait), une action n'a aucun filet amont,
 *    exactement comme `/api`. Et sous une page NON publique le filet existe mais
 *    reste grossier : le middleware ne vérifie qu'un rôle par préfixe
 *    (`ROLE_PREFIXES`), jamais l'appartenance de l'objet visé — une action sous
 *    `/traiteur` est atteignable par tous les traiteurs, organisations confondues.
 *    Le repo n'en déclare aucune ; le 3e `describe` gèle ce statu quo pour que
 *    l'introduction d'une action soit une décision consciente. Il couvre les trois
 *    racines que Next compile (`plateforme/src`, `shared/src`, `adapters/src`) :
 *    `.mts`/`.cts` restent hors portée, absents de `resolve.extensions` de Next.
 *
 *  • Fichiers de métadonnées Next (`sitemap.ts`, `robots.ts`, `manifest.ts`,
 *    `opengraph-image.tsx`, `icon.tsx`…) — ce sont des GET servis par Next, hors
 *    scan lui aussi. Le repo n'en a aucun. Atténuation réelle, contrairement à
 *    `/api` : leurs chemins SONT couverts par le `matcher` du middleware, le filet
 *    amont existe donc. Si l'un apparaît et sert de la donnée utilisateur (ou vit
 *    sous un préfixe public), l'énumérer explicitement — élargir `FICHIER_ROUTE`
 *    au nom concerné, ou lui ajouter son propre scan avec sa garde attendue.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import type { NextConfig } from 'next';
import * as constantesNext from 'next/constants';
import { describe, it, expect } from 'vitest';

const APP = resolve(__dirname, '../../src/app');
const API = join(APP, 'api');
// Répertoires de routing que Next sert sans passer par src/app : Pages Router
// (`src/pages`), et les variantes à la racine du package quand `src/` n'est pas
// utilisé (`pages`, `app`). Tous sont hors du scan ci-dessous ET hors middleware
// (`api(?:/|$)` exclu) — un handler qui s'y glisse est un endpoint nu (#286).
const RACINES_HORS_SCAN = ['src/pages', 'pages', 'app'] as const;
const RACINE_PKG = resolve(__dirname, '../..');
// Fichier de config chargé par le cliquet « configuration de déploiement » plus
// bas (import statique, donc littéral). Next, lui, retient le PREMIER de
// `CONFIG_FILES` qui existe : la liste est lue dans `next/constants` plutôt que
// recopiée, pour rester juste si une version future en ajoute un (revue #289).
const CONFIG_NEXT_CHARGEE = 'next.config.ts';

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

const PACKAGES = resolve(__dirname, '../../..');

// Racines scannées pour la détection `use server` — à ne pas confondre avec
// RACINES_HORS_SCAN ci-dessus, qui interdit des répertoires. Ici : tout ce que le
// build Next compile, pas seulement `src/`.
// `@savr/shared` est dans `transpilePackages` (next.config.ts) et consommé en
// source TS ; `packages/adapters` est importé en source par des route handlers
// (health/logistique, webhooks/everest, crons). Une directive `use server` y est
// indiscernable au build d'une directive de `src/` : s'arrêter à `src/` laisserait
// une action entrer sans faire rougir ce test (revue sécurité, sonde 4 directives).
const RACINES_COMPILEES = [
  resolve(__dirname, '../../src'),
  resolve(PACKAGES, 'shared/src'),
  resolve(PACKAGES, 'adapters/src'),
];

// Toute extension que le loader SWC de Next traite — `.mjs`/`.cjs` compris, que
// `/\.(?:t|j)sx?$/` ratait.
const FICHIER_SOURCE = /\.[mc]?[tj]sx?$/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((nom) => {
    const p = join(dir, nom);
    if (statSync(p).isDirectory()) return sources(p);
    return FICHIER_SOURCE.test(nom) ? [p] : [];
  });
}

// Directive `use server` : en tête de fichier (tout ce qu'il exporte devient une
// action) ou en tête de fonction (action inline). Dans les deux cas seule sur sa
// ligne — l'ancrer à la ligne évite de matcher `log('use server')`. Le `//` final
// est admis explicitement : `sansCommentaires` ne retire que les commentaires
// occupant TOUTE la ligne, donc `'use server'; // …` — forme valide — casserait
// l'ancre de fin, soit le même faux négatif silencieux que celui fermé en #286.
const DIRECTIVE_USE_SERVER = /^\s*(['"])use server\1\s*;?\s*(?:\/\/.*)?$/m;

const SOURCES = RACINES_COMPILEES.flatMap(sources);
const CHEMINS_SOURCES = SOURCES.map((p) =>
  relative(PACKAGES, p).split(sep).join('/'),
);
const ACTIONS_SERVEUR = SOURCES.filter((p) =>
  DIRECTIVE_USE_SERVER.test(sansCommentaires(readFileSync(p, 'utf8'))),
).map((p) => relative(PACKAGES, p).split(sep).join('/'));

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

describe("Server Actions — aucune, faute de filet en amont pour l'accueillir", () => {
  it('garde anti-vacuité : le scan énumère bien toutes les racines', () => {
    // Un plancher seul est un proxy faible : perdre `src/components` (hôte
    // plausible d'une action inline) le laisserait vert. D'où l'assertion de
    // représentation, sous-arbre par sous-arbre.
    const attendus = [
      'plateforme/src/app',
      'plateforme/src/components',
      'plateforme/src/lib',
      'shared/src',
      'adapters/src',
    ];
    expect(
      attendus.filter(
        (prefixe) => !CHEMINS_SOURCES.some((c) => c.startsWith(prefixe + '/')),
      ),
    ).toEqual([]);
    expect(SOURCES.length).toBeGreaterThan(400);
  });

  it('le scan couvre les extensions traitées par le loader SWC', () => {
    // Symétrique de la garde sur FICHIER_ROUTE : sans elle, un retour à
    // /\.(?:t|j)sx?$/ resterait vert tant qu'aucune action n'est écrite en
    // .mjs/.cjs — la régression silencieuse que ce fichier existe pour empêcher.
    for (const n of [
      'a.ts',
      'a.tsx',
      'a.js',
      'a.jsx',
      'a.mjs',
      'a.cjs',
      'a.mts',
      'a.cts',
    ])
      expect(FICHIER_SOURCE.test(n)).toBe(true);
    for (const n of ['a.css', 'a.json', 'a.md', 'a.tsbuildinfo', 'a.snap'])
      expect(FICHIER_SOURCE.test(n)).toBe(false);
  });

  it('garde anti-vacuité : la directive est détectée sous ses formes réelles', () => {
    for (const src of [
      "'use server';\nexport async function enregistrer() {}",
      '"use server"\nexport async function enregistrer() {}',
      "export async function enregistrer() {\n  'use server';\n  return 1;\n}",
      "'use server'; // action de la page\nexport async function enregistrer() {}",
      "'use server' // sans point-virgule\nexport async function enregistrer() {}",
    ])
      // Même pipeline que le scan réel : `sansCommentaires` d'abord.
      expect(DIRECTIVE_USE_SERVER.test(sansCommentaires(src))).toBe(true);
    // …sans confondre une mention de la chaîne avec la directive.
    for (const src of [
      'const mode = "use server-side";',
      "// 'use server'",
      "logger.info('use server');",
    ])
      expect(DIRECTIVE_USE_SERVER.test(sansCommentaires(src))).toBe(false);
  });

  it('aucune racine compilée par Next ne déclare de Server Action', () => {
    expect(
      ACTIONS_SERVEUR,
      "Server Action détectée. Next l'expose en POST sur le pathname de la page " +
        "qui l'appelle : hors du scan `route.*` de ce fichier, et sans filtrage du " +
        'middleware si cette page vit sous un préfixe public (cf. PUBLIC_PREFIXES ' +
        'dans src/middleware.ts). Deux propriétés non intuitives : un `use server` ' +
        'en tête de fichier rend adressable CHAQUE export, helpers compris ; et une ' +
        "action reste appelable par son identifiant même si l'UI n'affiche jamais " +
        "le bouton — masquer le bouton n'est pas un contrôle. À faire : (1) une " +
        "garde (requireStaff / requireUser / …) en PREMIÈRE instruction de l'action, " +
        "l'argument client n'étant jamais de confiance ; (2) une vérification " +
        "d'AUTORISATION sur l'objet ciblé — l'authentification seule laisse passer " +
        'le cross-organisation, qui est le risque dominant ici (cf. #244/#247) ; ' +
        "(3) ne renvoyer que ce que l'appelant a le droit de voir, la valeur de " +
        'retour étant sérialisée vers le client ; (4) passer par le client ' +
        'utilisateur, RLS honorées — jamais le client service-role, qui les ' +
        "contourne et prive pgTAP de tout rôle d'oracle. Puis remplacer cette " +
        'assertion par ' +
        'une énumération explicite (chemin → garde attendue + raison), sur le ' +
        'modèle de EXCEPTIONS_HORS_API.',
    ).toEqual([]);
  });
});

/**
 * Cliquet — aucune configuration ne crée de chemin HTTP hors des répertoires de
 * routing scannés ci-dessus.
 *
 * Un `rewrites` (config Next ou vercel.json) sert un chemin qui n'existe sous
 * aucun `route.ts` : il échappe donc aux deux cliquets précédents, et au
 * middleware dès lors qu'il commence par `/api`. Vecteur concret : `tunnelRoute`
 * de @sentry/nextjs est implémenté comme un rewrite (`setUpTunnelRewriteRules`)
 * et ouvrirait un proxy non authentifié (revue sécurité #289).
 *
 * La config Next est ici *exécutée*, pas relue : la garde couvre donc aussi ce
 * qu'aucun scan textuel ne verrait — composition (`import base from
 * './next.base'`, spread) et plugins qui injectent la clé eux-mêmes, comme
 * `withSentryConfig`. Limites assumées : une clé conditionnée par une variable
 * d'environnement absente du test, et les `NextResponse.rewrite()` du middleware
 * (qui, eux, visent des routes déjà gardées) restent hors de portée.
 */
const PHASES_NEXT = Object.entries(constantesNext)
  .filter(([cle, val]) => cle.startsWith('PHASE_') && typeof val === 'string')
  .map(([, val]) => val as string);

// `headers`, `functions`, `crons` et `regions` ne créent aucun chemin nouveau.
const CLES_ROUTAGE_VERCEL = [
  'rewrites',
  'redirects',
  'routes',
  'builds',
] as const;
const VERCEL_JSON = [
  join(RACINE_PKG, 'vercel.json'),
  resolve(RACINE_PKG, '../..', 'vercel.json'),
];

/** La config Next telle que Next l'appliquera, par phase si elle en dépend. */
async function configsNextResolues(): Promise<
  { phase: string; config: NextConfig }[]
> {
  const exporte = (await import('../../next.config')).default as
    | NextConfig
    | ((
        phase: string,
        ctx: { defaultConfig: NextConfig },
      ) => Promise<NextConfig> | NextConfig);
  if (typeof exporte !== 'function')
    return [{ phase: CONFIG_NEXT_CHARGEE, config: exporte }];
  return Promise.all(
    PHASES_NEXT.map(async (phase) => ({
      phase: `${CONFIG_NEXT_CHARGEE} (${phase})`,
      config: await exporte(phase, { defaultConfig: {} }),
    })),
  );
}

describe('configuration de déploiement — aucun endpoint hors routing scanné', () => {
  it('le cliquet charge la config que Next retiendrait', () => {
    // Anti-vacuité : si Next changeait ses noms de config, `retenue` deviendrait
    // `undefined` et l'import statique ci-dessus porterait sur un fichier mort.
    const retenue = constantesNext.CONFIG_FILES.find((nom) =>
      existsSync(join(RACINE_PKG, nom)),
    );
    expect(retenue).toBe(CONFIG_NEXT_CHARGEE);
  });

  it('la config Next résolue ne définit ni rewrites ni redirects', async () => {
    const fautifs = (await configsNextResolues()).flatMap(({ phase, config }) =>
      (['rewrites', 'redirects'] as const)
        .filter((cle) => config[cle] !== undefined)
        .map((cle) => `${phase} : ${cle} défini`),
    );
    expect(fautifs).toEqual([]);
  });

  it('la config Next résolue ne redéfinit pas pageExtensions', async () => {
    // FICHIER_ROUTE dérive du défaut Next (tsx|ts|jsx|js) : redéfinir
    // `pageExtensions` désynchroniserait le scan en silence. Soit on ne le
    // définit pas, soit FICHIER_ROUTE doit en être dérivé.
    const fautifs = (await configsNextResolues())
      .filter(({ config }) => config.pageExtensions !== undefined)
      .map(({ phase }) => `${phase} : pageExtensions défini`);
    expect(fautifs).toEqual([]);
  });

  it('aucun vercel.json ne détourne de chemin HTTP', () => {
    const presents = VERCEL_JSON.filter((p) => existsSync(p));
    expect(presents.length).toBeGreaterThan(0); // anti-vacuité
    const fautifs = presents.flatMap((p) => {
      const cles = Object.keys(JSON.parse(readFileSync(p, 'utf8')) as object);
      return CLES_ROUTAGE_VERCEL.filter((c) => cles.includes(c)).map(
        (c) => `${relative(RACINE_PKG, p)} : ${c}`,
      );
    });
    expect(fautifs).toEqual([]);
  });
});
