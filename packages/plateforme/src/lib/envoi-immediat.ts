// Envoi immédiat des ordres d'une collecte au prestataire (décision Val 2026-10-12).
//
// La mutation métier vient d'écrire l'ordre dans la file (`outbox_events`, même
// transaction — garde-fou 4). Plutôt que d'attendre le passage planifié (toutes
// les 15 min, en production seulement), on traite les ordres de CETTE collecte
// juste après la réponse HTTP : le clic n'attend pas le prestataire, et un
// prestataire lent ou en panne ne fait jamais échouer la requête.
//
// Ce passage n'est pas une garantie : s'il échoue ou ne trouve pas l'ordre,
// l'ordre reste en file et le passage planifié l'envoie (reprises comprises).
//
// ⚠ `envoyerOrdresSansAttendre` et `envoyerOrdresEvenementSansAttendre` ne
// s'appellent que depuis une route, et cette route DOIT exporter
// `maxDuration = 60`, la moitié du bail de réservation
// (120 s). Cette limite ne borne pas seule la durée de vie du passage : rien ne
// l'applique sur un serveur local, et sur Vercel une tâche `after()` hors délai
// a continué de s'exécuter quand une autre invocation occupait son processus
// (mesuré le 2026-10-12 — invariant A3, packages/adapters/src/outbox-worker.ts).
// Cliquet : tests/api/admin/envoi-immediat-routes.test.ts.
//
// Toute route qui appelle une fonction SQL émettrice d'ordres de collecte doit
// déclencher cet envoi après sa mutation réussie (cliquet de complétude, même
// fichier de tests). L'ordre « lieu » (E5) reste au passage planifié.
//
// La tâche est bornée (décision Val 2026-10-13) : elle ne lance aucun passage
// pour une collecte sans ordre en file, n'en traite pas plus de
// MAX_COLLECTES_PAR_TACHE, et n'en commence plus après BUDGET_TACHE_MS. Ce qui
// n'est pas traité reste en file pour le passage planifié.

import { after } from 'next/server';

import { runOutboxWorkerPourCollecte } from '@savr/adapters/src/outbox-worker.js';
import { logger } from '@savr/shared/src/logger/index.js';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';

import { erreurInterne } from '@/lib/api-helpers.js';

type ClientService = ReturnType<typeof createAdminSupabaseClient>;

/** Collectes dont la file est consultée, au plus, par tâche (une seule lecture). */
export const MAX_COLLECTES_EXAMINEES = 50;
/** Collectes dont les ordres sont envoyés, au plus, par tâche. */
export const MAX_COLLECTES_PAR_TACHE = 10;
/** Passé ce délai depuis le départ de la tâche, aucune collecte n'est commencée. */
export const BUDGET_TACHE_MS = 40_000;
/** Plafond de lignes d'une réponse de l'API de la base (supabase/config.toml). */
const LIGNES_MAX_REPONSE = 1_000;

/**
 * Programme, pour après la réponse, l'envoi des ordres en file d'une collecte,
 * ou de plusieurs (une programmation en crée plusieurs d'un coup).
 * À appeler une fois la mutation émettrice réussie — jamais avant.
 */
export function envoyerOrdresSansAttendre(
  collecteIds: string | readonly string[],
): void {
  const ids = [
    ...new Set(typeof collecteIds === 'string' ? [collecteIds] : collecteIds),
  ];
  if (ids.length === 0) return;
  programmer({ collecte_ids: ids }, (supabase) =>
    traiter(supabase, ids, Date.now()),
  );
}

/**
 * Même chose pour toutes les collectes d'un événement : sa modification écrit
 * un ordre par collecte déjà commandée. Les collectes sont lues dans la tâche,
 * après la réponse — rien n'est ajouté au chemin de la requête.
 */
export function envoyerOrdresEvenementSansAttendre(evenementId: string): void {
  programmer({ evenement_id: evenementId }, async (supabase) => {
    const debut = Date.now();
    const { data, error } = await supabase
      .from('collectes')
      .select('id')
      .eq('evenement_id', evenementId);
    // Le message réel est journalisé par `erreurInterne` ; l'erreur relancée est
    // neutre (jamais un message de la base dans une `Error` d'un module de route).
    if (error) {
      throw erreurInterne(
        error,
        'outbox.envoi_immediat.lecture_collectes_evenement',
      );
    }
    await traiter(
      supabase,
      ((data as { id: string }[] | null) ?? []).map((c) => c.id),
      debut,
    );
  });
}

// Une collecte après l'autre, dans une seule tâche : une requête ne lance jamais
// deux passages à la fois chez le prestataire. L'échec d'une collecte n'empêche
// pas les suivantes ; son ordre reste en file pour le passage planifié.
// `debut` = départ de la tâche : le budget couvre aussi ses lectures.
async function traiter(
  supabase: ClientService,
  collecteIds: readonly string[],
  debut: number,
): Promise<void> {
  const avecOrdre = await collectesAvecOrdreEnFile(
    supabase,
    collecteIds.slice(0, MAX_COLLECTES_EXAMINEES),
  );
  const aTraiter = avecOrdre.slice(0, MAX_COLLECTES_PAR_TACHE);
  const horsPlafond =
    Math.max(0, collecteIds.length - MAX_COLLECTES_EXAMINEES) +
    (avecOrdre.length - aTraiter.length);
  if (horsPlafond > 0) {
    laisserAuPassagePlanifie('plafond', horsPlafond);
  }

  for (const [rang, collecteId] of aTraiter.entries()) {
    if (Date.now() - debut > BUDGET_TACHE_MS) {
      laisserAuPassagePlanifie('budget', aTraiter.length - rang);
      break;
    }
    try {
      const resultat = await runOutboxWorkerPourCollecte(supabase, collecteId);
      logger.info('outbox.envoi_immediat', {
        collecte_id: collecteId,
        ...resultat,
      });
    } catch (err) {
      logger.error('outbox.envoi_immediat.echec', {
        collecte_id: collecteId,
        error: String(err),
      });
    }
  }
}

function laisserAuPassagePlanifie(
  motif: 'plafond' | 'budget',
  collectes: number,
): void {
  logger.warn('outbox.envoi_immediat.laisse_au_passage_planifie', {
    motif,
    collectes,
  });
}

// Celles des collectes qui ont un ordre en attente dans la file, dans l'ordre
// reçu. Sans ordre, un passage coûterait deux réservations vides et une seconde
// d'attente (cf. runOutboxWorkerPourCollecte) : il n'est pas lancé.
// Le filtre est plus large que la réservation (ni palier de reprise, ni ordre de
// tête) : il peut garder une collecte dont rien n'est réservable. Pour ne pas en
// écarter une qui a un ordre à envoyer, les identifiants sont comparés sous leur
// forme standard, et une réponse peut-être tronquée vaut une file illisible.
async function collectesAvecOrdreEnFile(
  supabase: ClientService,
  collecteIds: readonly string[],
): Promise<readonly string[]> {
  if (collecteIds.length === 0) return [];
  const { data, error } = await supabase
    .from('outbox_events')
    .select('aggregate_id')
    .eq('aggregate_type', 'collecte')
    .in('aggregate_id', collecteIds)
    .in('statut', ['pending', 'failed']);
  // Lecture impossible, réponse illisible ou peut-être tronquée : jamais lue
  // comme « aucun ordre ». On traite alors les collectes reçues, sous les mêmes
  // plafonds.
  const illisible = error
    ? String(error.message)
    : !Array.isArray(data)
      ? 'réponse sans liste'
      : data.length >= LIGNES_MAX_REPONSE
        ? 'réponse au plafond de lignes'
        : null;
  if (illisible) {
    logger.warn('outbox.envoi_immediat.file_illisible', {
      collectes: collecteIds.length,
      error: illisible,
    });
    return collecteIds;
  }
  const enFile = new Set(
    (data as { aggregate_id: string }[]).map((ligne) =>
      formeStandard(ligne.aggregate_id),
    ),
  );
  return collecteIds.filter((id) => enFile.has(formeStandard(id)));
}

// Un même uuid s'écrit de plusieurs façons, que la base accepte toutes en
// entrée (majuscules, accolades, tirets omis ou déplacés) et qu'elle rend
// toujours sous une seule : on compare sans casse, accolades ni tirets.
function formeStandard(uuid: string): string {
  return uuid.replace(/[{}-]/g, '').toLowerCase();
}

function programmer(
  contexte: Record<string, unknown>,
  tache: (supabase: ClientService) => Promise<void>,
): void {
  try {
    after(async () => {
      try {
        await tache(createAdminSupabaseClient());
      } catch (err) {
        // Jamais d'exception hors de la tâche : la requête a déjà répondu, et
        // les ordres restent en file pour le passage planifié.
        logger.error('outbox.envoi_immediat.echec', {
          ...contexte,
          error: String(err),
        });
      }
    });
  } catch (err) {
    // `after()` lève quand elle ne peut pas programmer la tâche (hors requête,
    // hôte sans `waitUntil`). La mutation a réussi : la route doit répondre son
    // succès, pas un 500. Les ordres restent en file pour le passage planifié.
    logger.error('outbox.envoi_immediat.non_programme', {
      ...contexte,
      error: String(err),
    });
  }
}
