// Helpers API transverses — durcissement Lot C (C1 / C2 / C4).
import { NextResponse } from 'next/server';

/**
 * C1 — Réponse 500 générique. Logge l'erreur réelle côté serveur (jamais
 * renvoyée au client : un message d'erreur DB fuite le schéma/les contraintes).
 */
export function serverError(error: unknown, event: string): NextResponse {
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: 'error',
      service: 'platform',
      event,
      payload: {
        error: error instanceof Error ? error.message : String(error),
      },
    }),
  );
  return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
}

/**
 * C1 (chemin write) — erreur d'écriture (INSERT/UPDATE) renvoyée SANS fuiter le
 * détail Postgres (noms de contraintes/colonnes, ex. « organisations_siret_key »).
 * Logge l'erreur réelle côté serveur et renvoie un message neutre. Reste une
 * erreur CLIENT (422 : donnée invalide ou doublon), pas un 500.
 */
export function writeError(error: unknown, event: string): NextResponse {
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: 'error',
      service: 'platform',
      event,
      payload: {
        error: error instanceof Error ? error.message : String(error),
      },
    }),
  );
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
