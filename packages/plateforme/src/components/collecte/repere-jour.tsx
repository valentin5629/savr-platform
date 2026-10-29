'use client';

import { Badge } from '@/components/ui/badge';
import { CaretRightIcon } from '@/components/ui/icones';
import { decalerJour } from '@savr/shared/src/temps/index.js';

// Briques communes des listes cliquables (revue écran 2026-10-29) : listes
// Collectes traiteur / agence, Collectes Admin, Événements du gestionnaire.

/**
 * Repère « Aujourd’hui » (orange) / « Demain » (bleu) à côté d'une date
 * « YYYY-MM-DD », selon le jour de Paris `aujourdhui`. Rien au-delà, ni quand
 * `masque` (collecte ou événement annulé).
 */
export function RepereJour({
  date,
  aujourdhui,
  masque = false,
}: {
  date: string | null;
  aujourdhui: string;
  masque?: boolean;
}) {
  if (!date || masque) return null;
  if (date === aujourdhui)
    return (
      <Badge variant="action" size="sm">
        Aujourd’hui
      </Badge>
    );
  if (date === decalerJour(aujourdhui, 1))
    return (
      <Badge variant="info" size="sm">
        Demain
      </Badge>
    );
  return null;
}

/**
 * Chevron de fin de ligne : la ligne entière ouvre la fiche (écran large).
 * `data-ouvre-ligne` : dans une cellule d'actions, son clic remonte quand même
 * à la ligne (cf. DataGrid).
 */
export function ChevronLigne() {
  return (
    <CaretRightIcon
      aria-hidden="true"
      data-testid="chevron-ligne"
      data-ouvre-ligne=""
      className="hidden h-4 w-4 shrink-0 text-savr-neutral-400 group-hover:text-savr-primary-700 sm:block"
    />
  );
}
