import * as Sentry from '@sentry/nextjs';

// ⚠ EMPLACEMENT : ce fichier DOIT rester dans `src/` (même règle que
// `src/middleware.ts`, cf. #281) : l'app vit dans `src/app`, Next ne lit pas un
// `instrumentation.ts` posé à la racine du package.
//
// Seul point d'entrée de l'initialisation Sentry côté serveur : avec Next 15 et
// @sentry/nextjs 10, `sentry.server.config.ts` n'est chargé que d'ici. Le runtime
// edge (middleware) n'est pas initialisé : aucun code edge n'utilise le sink.

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config');
  }
}

export const onRequestError = Sentry.captureRequestError;
