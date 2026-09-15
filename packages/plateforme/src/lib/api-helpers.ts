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
 *   renvoyée au client. Le message peut porter un détail Postgres (nom de
 *   contrainte, et sur une erreur de CAST la valeur saisie elle-même) → le logger
 *   applique `sanitizePayload`, mais la redaction se fait par NOM DE CLÉ : une
 *   chaîne sous la clé neutre `error` n'est PAS filtrée.
 *   C'est un arbitrage assumé, pas un angle mort : avant ce lot, `String(error)`
 *   réduisait toute `PostgrestError` à « [object Object] » — ces messages entrent
 *   donc dans les logs pour la PREMIÈRE fois. Neutraliser la réponse sans rien
 *   tracer serait pire que la fuite d'origine (plus aucun diagnostic de panne).
 *   Contrepartie §15 : `messageErreur` ne lit QUE `message`, jamais `details`
 *   (« Key (email)=(…) already exists ») ni `hint` ; la rétention reste bornée
 *   par `f_purge_logs`.
 * - `rls.policy.deny` (warn, §07/02) : si Postgres refuse par une policy RLS
 *   (code 42501 insufficient_privilege), on émet EN PLUS l'event deny qui alimente
 *   l'alerte sécurité §07/03 (> 10/h même rôle+table, agrégée côté plateforme).
 */
/**
 * Message lisible d'une erreur, quelle que soit sa forme. Une `PostgrestError` est
 * un objet PLAIN (pas une instance d'`Error`) : un simple `String(error)` la
 * réduisait à « [object Object] » et le log ne disait plus rien de la panne —
 * neutraliser la réponse SANS tracer côté serveur est pire que la fuite d'origine.
 */
export function messageErreur(err: unknown): string {
  /* NB : cette fonction RETOURNE le message brut — elle ne neutralise rien. Son
     seul usage légitime est d'alimenter un `logger.*` ; le cliquet
     `check-api-error-leak` l'impose (règle D). */
  if (err == null) return '';
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  const objet = err as { message?: unknown };
  if (typeof objet.message === 'string') return objet.message;
  // Repli : on sérialise l'objet SANS `details`/`hint`, qui sont les champs où
  // PostgREST place la valeur en cause (« Key (email)=(…) already exists ») —
  // c'est précisément la PII que le reste du helper évite de faire entrer en logs.
  try {
    const reste = Object.fromEntries(
      Object.entries(err as Record<string, unknown>).filter(
        ([cle]) => cle !== 'details' && cle !== 'hint',
      ),
    );
    return JSON.stringify(reste);
  } catch {
    return String(err);
  }
}

function logApiError(
  error: unknown,
  route: string,
  operation: 'read' | 'write',
): void {
  const message = messageErreur(error);
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
/**
 * Erreur dont le MESSAGE est un libellé métier écrit par nous — `RAISE EXCEPTION
 * '<libellé>' USING ERRCODE = 'P0003'` côté RPC, ou `Object.assign(new Error(…),
 * { code: 'DUPLICATE' })` côté TS. Contrairement à une erreur Postgres système
 * (contrainte, colonne, table), un tel message ne décrit aucune structure interne :
 * il est destiné à l'utilisateur et peut être renvoyé tel quel.
 *
 * `codesMetier` est une ALLOWLIST FERMÉE : tout code hors liste (y compris une
 * PostgrestError qui remonterait par le même `catch`) retombe sur le message
 * neutre de `writeError`, JAMAIS sur le message brut. L'erreur réelle est loggée
 * dans les deux cas.
 */
export function businessError(
  error: { code?: string; message?: string } | null,
  event: string,
  codesMetier: readonly string[],
  status: number,
): NextResponse {
  const code = error?.code ?? '';
  if (!codesMetier.includes(code)) return writeError(error, event);
  logApiError(error, event, 'write');
  return NextResponse.json({ error: error?.message ?? '' }, { status });
}

/**
 * Échec de création d'un compte Supabase Auth (`auth.admin.createUser`). Le
 * message GoTrue brut n'est jamais renvoyé (il peut porter du détail interne) :
 * on mappe les CAS MÉTIER connus vers un libellé FR fixe, pour que l'utilisateur
 * garde l'information utile (email déjà pris, mot de passe trop faible) sans
 * qu'aucun texte d'origine tierce n'atteigne le client. `code` n'étant pas
 * garanti selon la version GoTrue, le message sert de repli de DÉTECTION — il est
 * lu, jamais retourné.
 */
export function authAccountError(
  error: { code?: string; message?: string } | null,
  event: string,
  repli = 'Création du compte impossible.',
): NextResponse {
  logApiError(error, event, 'write');
  const code = error?.code ?? '';
  const msg = (error?.message ?? '').toLowerCase();
  if (
    code === 'email_exists' ||
    code === 'user_already_exists' ||
    msg.includes('already registered') ||
    msg.includes('already been registered')
  )
    return NextResponse.json(
      { error: 'Cette adresse email est déjà utilisée.' },
      { status: 422 },
    );
  if (code === 'same_password' || msg.includes('should be different'))
    return NextResponse.json(
      { error: 'Le nouveau mot de passe doit être différent de l’ancien.' },
      { status: 422 },
    );
  if (code === 'weak_password' || msg.includes('password'))
    return NextResponse.json(
      { error: 'Mot de passe trop faible (8 caractères minimum).' },
      { status: 422 },
    );
  return NextResponse.json({ error: repli }, { status: 422 });
}

/**
 * Erreur interne à relancer depuis un module `lib/` dont le `throw` est rattrapé
 * par un route handler qui renvoie `e.message` au client.
 *
 * `throw new Error(pgError.message)` est la MÊME fuite que
 * `NextResponse.json({ error: error.message })`, avec une indirection de plus :
 * `new Error(…)` EST une instance d'`Error`, donc le `catch (e) { … e.message }`
 * du handler la renvoie telle quelle. Vecteur démontré en revue sécurité :
 * `GET /api/v1/exports/collectes?statut=foo` répondait
 * « invalid input value for enum plateforme.collecte_statut: "foo" » — schéma et
 * nom du type interne divulgués à n'importe quel client authentifié.
 *
 * Le message réel est loggé (`api_route.error`, §07/02) ; l'`Error` relancée ne
 * porte qu'un libellé neutre.
 */
export function erreurInterne(
  err: unknown,
  event: string,
): Error & { code?: string } {
  logApiError(err, event, 'read');
  // Le MESSAGE est neutralisé, le CODE est conservé : c'est lui qui porte le sens
  // métier (`P0030` = collecte AG introuvable → 404). Un handler qui distinguait
  // ses cas en cherchant un texte dans le message doit tester ce code.
  const code = (err as { code?: string } | null)?.code;
  return Object.assign(new Error('Erreur serveur'), code ? { code } : {});
}

/**
 * Libellé NEUTRE pour un champ `erreur` d'un résultat applicatif que le route
 * handler renvoie au client (`{ ok: false, erreur }` de `lib/facturation/**`).
 * Même classe que `writeError`, mais côté producteur : le message Postgres est
 * loggé, jamais placé dans le champ rendu.
 */
export function messageEchecEcriture(
  err: unknown,
  event: string,
  codesMetier: readonly string[] = [],
): string {
  logApiError(err, event, 'write');
  // Symétrique de `businessError` côté producteur : un `RAISE EXCEPTION` dont le
  // libellé est écrit par nous (et dont le code est explicitement listé) reste
  // affiché ; tout le reste retombe sur le message neutre.
  const code = (err as { code?: string } | null)?.code ?? '';
  const message = (err as { message?: string } | null)?.message;
  if (codesMetier.includes(code) && message) return message;
  return 'Enregistrement impossible (données invalides ou doublon)';
}

/**
 * Idem pour un échec d'API TIERCE (Pennylane) dont la réponse est rendue à
 * l'Admin. Le corps d'erreur du tiers peut porter sa propre structure interne et
 * des identifiants de compte : il va aux logs (`api.external.failed` est émis par
 * le client Pennylane lui-même ; ici on trace la restitution) et l'Admin reçoit
 * un libellé qui dit l'ÉTAPE en échec — l'information dont il a besoin pour agir.
 */
export function messageEchecTiers(message: unknown, event: string): string {
  logApiError(message, event, 'write');
  return `Échec de la synchronisation Pennylane (${event.split('.').slice(1).join(' ')})`;
}
