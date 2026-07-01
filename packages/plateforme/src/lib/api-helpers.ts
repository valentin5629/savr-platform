// Helpers API transverses — durcissement Lot C (C1 / C2 / C4).
import { NextResponse } from 'next/server';

import { logger } from '@savr/shared/src/logger/index.js';

/**
 * Émission d'observabilité commune aux erreurs API serveur (§07/02).
 * - `api_route.error` (error) : l'erreur réelle est loggée côté serveur, jamais
 *   renvoyée au client. NB : le message peut échoir un détail Postgres (SIRET,
 *   nom de contrainte) → le logger applique `sanitizePayload`, mais la redaction
 *   se fait par NOM DE CLÉ ; on isole donc le `error_code` et laisse le message
 *   brut sous la clé neutre `error` (le détail sensible reste hors clés « siret »
 *   /« email »). Pas d'aggravation vs le comportement historique.
 * - `rls.policy.deny` (warn, §07/02) : si Postgres refuse par une policy RLS
 *   (code 42501 insufficient_privilege), on émet EN PLUS l'event deny qui alimente
 *   l'alerte sécurité §07/03 (> 10/h même rôle+table, agrégée côté plateforme).
 */
function logApiError(
  error: unknown,
  route: string,
  operation: 'read' | 'write',
): void {
  const message = error instanceof Error ? error.message : String(error);
  const error_code = (error as { code?: string } | null)?.code ?? 'UNKNOWN';
  logger.error('api_route.error', { route, error_code, error: message });

  if (error_code === '42501') {
    // Deny RLS d'une requête applicative authentifiée (pas le DENY ALL structurel).
    logger.warn('rls.policy.deny', { table: route, operation, error_code });
  }
}

/**
 * C1 — Réponse 500 générique. Logge l'erreur réelle côté serveur (jamais
 * renvoyée au client : un message d'erreur DB fuite le schéma/les contraintes).
 */
export function serverError(error: unknown, event: string): NextResponse {
  logApiError(error, event, 'read');
  return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
}

/**
 * C1 (chemin write) — erreur d'écriture (INSERT/UPDATE) renvoyée SANS fuiter le
 * détail Postgres (noms de contraintes/colonnes, ex. « organisations_siret_key »).
 * Logge l'erreur réelle côté serveur et renvoie un message neutre. Reste une
 * erreur CLIENT (422 : donnée invalide ou doublon), pas un 500.
 */
export function writeError(error: unknown, event: string): NextResponse {
  logApiError(error, event, 'write');
  return NextResponse.json(
    { error: 'Enregistrement impossible (données invalides ou doublon)' },
    { status: 422 },
  );
}

/**
 * C4 — Parse le corps JSON d'une requête en renvoyant un 400 propre si le corps
 * est absent/malformé (au lieu d'un 500 sur le throw de req.json()).
 *
 * @example
 *   const parsed = await readJsonBody(req);
 *   if ('error' in parsed) return parsed.error;
 *   const body = parsed.data;
 */
export async function readJsonBody<T = Record<string, unknown>>(
  req: Request,
): Promise<{ data: T } | { error: NextResponse }> {
  try {
    return { data: (await req.json()) as T };
  } catch {
    return {
      error: NextResponse.json(
        { error: 'Corps JSON invalide' },
        { status: 400 },
      ),
    };
  }
}

/**
 * C2 — Neutralise un terme de recherche utilisateur avant interpolation dans un
 * filtre PostgREST `.or('col.ilike.%<terme>%,...')`. Retire les caractères qui
 * ont un sens dans la grammaire `.or()` — séparateur de conditions « , »,
 * groupage « ( ) » — ainsi que guillemets/backslash. Sans ça, un `q` contenant
 * une virgule ou une parenthèse injecte/casse le filtre. Le terme reste
 * exploitable en ilike (les `%`/`*` éventuels sont conservés comme jokers).
 */
export function sanitizeOrTerm(q: string): string {
  return q.replace(/[,()"\\]/g, ' ').trim();
}
