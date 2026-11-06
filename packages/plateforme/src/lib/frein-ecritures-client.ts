// Frein de débit des écritures faites depuis les espaces clients (décision Val
// 2026-10-13).
//
// Depuis l'envoi immédiat, chaque écriture d'un client peut lancer une tâche de
// fond, et chaque modification d'une collecte déjà commandée produit un appel au
// prestataire (et un email à l'équipe dès qu'une valeur change). Rien ne
// plafonnait ce débit.
//
// Deux compteurs sur une fenêtre glissante de 10 minutes :
//   - par organisation, sur toute écriture qui déclenche l'envoi immédiat ;
//   - par collecte ou par événement modifié, sur les seules modifications (les
//     seules écritures qu'un client peut répéter sans fin sur le même objet).
// Au-delà, la route répond 429 et n'écrit rien. L'équipe Savr n'est pas freinée
// sous son propre rôle ; sous l'identité d'un client, elle l'est comme lui.
//
// À appeler après les gardes de la route et juste avant sa première écriture :
// une requête refusée par une garde ne consomme rien (cliquet et preuves par
// route : tests/api/admin/envoi-immediat-routes.test.ts).
//
// Ce qui est compté est une requête, pas un ordre : une programmation de
// plusieurs collectes, ou la modification d'un événement à plusieurs collectes
// commandées, compte pour une écriture. Les lectures et les requêtes refusées
// par une garde ne sont pas limitées.
//
// ⚠ Compteurs en mémoire, par instance de serveur, non partagés — même choix que
// la limite de l'inscription (lib/signup-rate-limit.ts). Ils repartent de zéro
// à chaque démarrage d'instance, et avec plusieurs instances la limite réelle
// est multipliée d'autant : c'est un frein, pas un plafond exact. Rien ne
// mesure que les neuf routes partagent un même processus chez l'hébergeur. Un
// compteur tenu en base reste à arbitrer (CLAUDE.md §2).

import { NextResponse } from 'next/server';

import { logger } from '@savr/shared/src/logger/index.js';

export const FENETRE_FREIN_MS = 10 * 60 * 1000;
export const MAX_ECRITURES_PAR_ORGANISATION = 100;
export const MAX_MODIFICATIONS_PAR_OBJET = 10;
const MAX_CLES_SUIVIES = 10_000; // garde-fou mémoire

export const MESSAGE_FREIN =
  'Trop de modifications en peu de temps. Réessayez dans quelques minutes.';

// Clé → instants (ms) des écritures acceptées dans la fenêtre courante.
const ecritures = new Map<string, number[]>();

export interface EcritureCliente {
  organisationId: string;
  /**
   * Objet modifié par la requête, désigné par l'identifiant QUE REND LA BASE —
   * jamais par le paramètre d'URL, dont plusieurs écritures désignent le même
   * objet. Absent pour une création ou une annulation.
   */
  modification?: { collecte: string } | { evenement: string };
  /** Équipe Savr sous son propre rôle (programmation de support) : jamais freinée. */
  equipeSavr?: boolean;
}

/**
 * Rend la réponse 429 à renvoyer telle quelle quand l'écriture dépasse un des
 * deux débits, `null` sinon. Une écriture acceptée est comptée ; une écriture
 * refusée ne l'est pas. `maintenant` est injectable pour les tests.
 */
export function freinerEcritureCliente(
  ecriture: EcritureCliente,
  maintenant: number = Date.now(),
): NextResponse | null {
  if (ecriture.equipeSavr) return null;

  const compteurs: Array<{ cle: string; max: number }> = [
    {
      cle: `organisation:${ecriture.organisationId}`,
      max: MAX_ECRITURES_PAR_ORGANISATION,
    },
  ];
  if (ecriture.modification) {
    compteurs.push({
      cle:
        'collecte' in ecriture.modification
          ? `collecte:${ecriture.modification.collecte}`
          : `evenement:${ecriture.modification.evenement}`,
      max: MAX_MODIFICATIONS_PAR_OBJET,
    });
  }

  const debutFenetre = maintenant - FENETRE_FREIN_MS;
  const recentes = compteurs.map(({ cle, max }) => ({
    cle,
    max,
    instants: (ecritures.get(cle) ?? []).filter((t) => t > debutFenetre),
  }));

  const sature = recentes.find((c) => c.instants.length >= c.max);
  if (sature) {
    // Clé remise en fin de Map : tant qu'elle est sollicitée, l'éviction
    // ci-dessous ne l'atteint pas (sinon un compteur saturé repartirait de zéro).
    ecritures.delete(sature.cle);
    ecritures.set(sature.cle, sature.instants);
    const attente = Math.max(
      1,
      Math.ceil((sature.instants[0]! + FENETRE_FREIN_MS - maintenant) / 1000),
    );
    logger.warn('frein_ecritures_client.refus', {
      organisation_id: ecriture.organisationId,
      compteur: sature.cle,
      attente_s: attente,
    });
    return NextResponse.json(
      { error: MESSAGE_FREIN },
      { status: 429, headers: { 'Retry-After': String(attente) } },
    );
  }

  for (const c of recentes) {
    // Réinsertion en fin de Map : l'éviction ci-dessous retire la clé la plus
    // anciennement utilisée, jamais une clé active.
    ecritures.delete(c.cle);
    ecritures.set(c.cle, [...c.instants, maintenant]);
  }
  while (ecritures.size > MAX_CLES_SUIVIES) {
    const plusAncienne = ecritures.keys().next().value;
    if (plusAncienne === undefined) break;
    ecritures.delete(plusAncienne);
  }
  return null;
}

/** Remet les compteurs à zéro (tests uniquement). */
export function _reinitialiserFreinEcritures(): void {
  ecritures.clear();
}
