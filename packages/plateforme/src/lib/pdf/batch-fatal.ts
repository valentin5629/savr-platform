// Échec GLOBAL d'un sous-batch PDF J+1 (≠ échec d'UNE collecte, rangé dans errors[]).
// La route cron batch-pdf-j1 le traduit en job.cron.failed + alerte §07/03 « Job cron
// critique échoué » + HTTP 500, exactement comme un rejet. Sans lui, une sélection
// cassée finissait en job.cron.completed avec 0 document (incident 2026-09-11).

import { logger } from '@savr/shared/src/logger/index.js';

export interface BatchFatal {
  /**
   * - `selection`  : une requête de sélection (collectes éligibles, documents déjà émis,
   *                  référentiels) a échoué → rien n'a été tenté (fail-closed : jamais
   *                  de ré-émission faute de savoir ce qui existe déjà).
   * - `traitement` : ≥ 1 collecte tentée, 0 produite → défaut systémique, pas un aléa.
   */
  etape: 'selection' | 'traitement';
  message: string;
  /** Code d'erreur source (PostgREST / Postgres) → `error_code` de job.cron.failed. */
  code?: string;
}

/** Échec d'une requête de sélection : trace le message dans errors[] et qualifie le fatal. */
export function fatalSelection(
  errors: string[],
  contexte: string,
  err: { message: string; code?: string },
): BatchFatal {
  const message = `${contexte} : ${err.message}`;
  errors.push(message);
  return { etape: 'selection', message, code: err.code };
}

/**
 * Échec d'UNE collecte : l'erreur reste locale (les autres collectes sont traitées et la
 * collecte est re-sélectionnée au batch suivant, idempotence) → warn, pas d'alerte.
 */
export function logCollecteEnEchec(
  jobName: string,
  collecteId: string,
  err: unknown,
): void {
  logger.warn(
    'pdf.batch.collecte_failed',
    {
      job_name: jobName,
      collecte_id: collecteId,
      error: err instanceof Error ? err.message : String(err),
    },
    { service: 'cron' },
  );
}

/** Fatal `traitement` si des collectes ont été tentées et qu'AUCUNE n'a abouti. */
export function fatalSiAucuneProduite(
  enqueued: number,
  errors: string[],
): BatchFatal | undefined {
  if (enqueued > 0 || errors.length === 0) return undefined;
  return {
    etape: 'traitement',
    message: `${errors.length} collecte(s) en échec, aucun document produit — ${errors[0]}`,
  };
}
