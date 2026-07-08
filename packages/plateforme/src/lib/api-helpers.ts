// Helpers API transverses — durcissement Lot C (C1 / C2 / C4).
import { NextResponse } from 'next/server';

import {
  logger,
  runWithTrace,
  extractOrCreateTraceId,
} from '@savr/shared/src/logger/index.js';

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
 * Erreur typée d'une RPC de mutation (BL-P2-31 « erreurs typées », CDC §9ter.6).
 * Mappe les codes Postgres normalisés vers le bon statut HTTP au lieu d'un 500
 * uniforme, SANS fuiter le détail Postgres (message neutre) :
 * - `22023` invalid_parameter_value / `23514` check_violation → 422 (valeur invalide)
 * - `P0002` no_data_found → 404 (id/clé inconnu)
 * - tout le reste → 500 générique (loggé côté serveur).
 * `message422`/`message404` = libellés neutres orientés utilisateur.
 */
export function typedRpcError(
  error: { code?: string } | null,
  event: string,
  messages?: { message422?: string; message404?: string },
): NextResponse {
  const code = error?.code;
  if (code === '22023' || code === '23514') {
    logApiError(error, event, 'write');
    return NextResponse.json(
      { error: messages?.message422 ?? 'Valeur invalide' },
      { status: 422 },
    );
  }
  if (code === 'P0002') {
    logApiError(error, event, 'write');
    return NextResponse.json(
      { error: messages?.message404 ?? 'Ressource introuvable' },
      { status: 404 },
    );
  }
  return serverError(error, event);
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
 * OTel léger V1 (BL-P2-44, §07/01 l.30 : « trace_id propagé sur toute la chaîne
 * d'une requête »). Enveloppe un handler de route dans un contexte de trace :
 * honore un `traceparent`/`x-request-id`/`x-savr-trace-id` entrant, sinon génère
 * un `trace_id`, puis exécute le handler sous `runWithTrace` (AsyncLocalStorage)
 * — tous les `logger.*` émis pendant le handler portent alors ce `trace_id`.
 *
 * Enveloppe SÛRE : contrairement au `_context` module-global du logger, ALS isole
 * chaque requête concurrente (pas de fuite de trace_id d'une requête à l'autre).
 * `middleware.ts` (Edge) est une invocation SÉPARÉE du handler et ne peut pas
 * poser ce contexte → la trace est établie ici, au niveau du handler Node.
 */
export function withApiTrace<R extends Request, A extends unknown[]>(
  handler: (req: R, ...rest: A) => Promise<NextResponse>,
): (req: R, ...rest: A) => Promise<NextResponse> {
  return (req: R, ...rest: A): Promise<NextResponse> =>
    runWithTrace(
      extractOrCreateTraceId((n) => req.headers.get(n)),
      () => handler(req, ...rest),
    );
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
