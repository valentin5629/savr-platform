'use client';

import * as React from 'react';
import { Truck, User, Package } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';

// TourneeCard — carte résumé d'une tournée (§10 §6 « TourneeCard » : camion,
// N collectes, chauffeur, plaque). Purement présentationnel : reçoit ses données
// en props (aucun fetch). Tokens neutres §2.3, icônes Lucide §9.
interface TourneeCardProps {
  /** Libellé du camion / véhicule (ex. « Camion 20 m³ », « Vélo cargo »). */
  camion: string;
  /** Plaque d'immatriculation (omise pour un vélo cargo). */
  immatriculation?: string;
  /** Nom du chauffeur. */
  chauffeur?: string;
  /** Nombre de collectes de la tournée. */
  nbCollectes: number;
  /** Badge de statut optionnel (rendu à droite de l'en-tête). */
  statut?: React.ReactNode;
  className?: string;
}

const TourneeCard = React.forwardRef<HTMLDivElement, TourneeCardProps>(
  (
    { camion, immatriculation, chauffeur, nbCollectes, statut, className },
    ref,
  ) => (
    <Card ref={ref} className={cn('flex flex-col gap-3 p-6', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Truck
            className="h-5 w-5 shrink-0 text-savr-primary-500"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p className="truncate font-semibold text-savr-neutral-900">
              {camion}
            </p>
            {immatriculation && (
              <p className="text-xs uppercase tracking-wide text-savr-neutral-500">
                {immatriculation}
              </p>
            )}
          </div>
        </div>
        {statut}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-savr-neutral-600">
        <span className="inline-flex items-center gap-1.5">
          <Package
            className="h-4 w-4 text-savr-neutral-400"
            aria-hidden="true"
          />
          {nbCollectes} collecte{nbCollectes > 1 ? 's' : ''}
        </span>
        {chauffeur && (
          <span className="inline-flex items-center gap-1.5">
            <User
              className="h-4 w-4 text-savr-neutral-400"
              aria-hidden="true"
            />
            {chauffeur}
          </span>
        )}
      </div>
    </Card>
  ),
);
TourneeCard.displayName = 'TourneeCard';

export { TourneeCard };
