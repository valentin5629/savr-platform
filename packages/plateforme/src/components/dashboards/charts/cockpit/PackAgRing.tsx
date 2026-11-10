'use client';

import * as React from 'react';
import { fmtInt } from './fmt';
import { useCompteur, useEntreeGraphique } from '../entree-graphique';
import { RING_OK, RING_LOW, TRACK, PACK_BADGE, WHITE } from './palette';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { fmtPct } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface PackAgRingProps {
  creditsInitiaux: number;
  creditsRestants: number;
}

// PackAgRing — jauge du pack Anti-Gaspi (R24b, retour Val « jauge en ligne »).
// Jusqu'à MAX_CASES crédits, une case par crédit (Val 2026-11-10) ; au-delà,
// barre continue. Remplissage = crédits RESTANTS (cohérent avec le grand
// chiffre), orange saine → rouge sous 10 % (redondance couleur ↔ badge).
// Purement présentationnel ; le nom historique est conservé pour les imports.
export const MAX_CASES = 20;

export function PackAgRing({
  creditsInitiaux,
  creditsRestants,
}: PackAgRingProps) {
  const entree = useEntreeGraphique<HTMLDivElement>('pack-ag');
  // Le grand chiffre monte de 0 à sa valeur pendant l'entrée de la jauge.
  const restantsAnimes = useCompteur(creditsRestants, entree.phase);
  const consommes = Math.max(0, creditsInitiaux - creditsRestants);
  const pctRestant =
    creditsInitiaux > 0 ? creditsRestants / creditsInitiaux : 0;
  const pctFill = Math.max(0, Math.min(1, pctRestant)) * 100;
  const low = pctRestant <= 0.1;
  const enCases = creditsInitiaux > 0 && creditsInitiaux <= MAX_CASES;
  const fillColor = low ? RING_LOW : RING_OK;
  // Même rendu que les barres de l'histogramme AG juste au-dessus (couleur à
  // 75 % sur blanc — retour Val R24b).
  const barBg = `color-mix(in srgb, ${fillColor} 75%, ${WHITE})`;

  let badge: React.ReactNode = null;
  if (creditsRestants === 0) {
    badge = (
      <span
        className="inline-block rounded-savr-full px-2.5 py-1 text-3xs font-bold uppercase tracking-[0.08em] tabular-nums"
        style={PACK_BADGE.epuise}
      >
        Pack épuisé
      </span>
    );
  } else if (low) {
    badge = (
      <span
        className="inline-block rounded-savr-full px-2.5 py-1 text-3xs font-bold uppercase tracking-[0.08em] tabular-nums"
        style={PACK_BADGE.faible}
      >
        {`Solde faible · ${fmtPct(pctRestant * 100, 1)}`}
      </span>
    );
  }

  return (
    <Card variant="elevated" padding="lg">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="text-md font-extrabold text-savr-neutral-900">
            Mon pack Anti-Gaspi
          </div>
          <Text as="div" className="mt-0.5">
            <span className="font-extrabold tabular-nums text-savr-neutral-800">
              {fmtInt(consommes)}
            </span>
            {` ${consommes > 1 ? 'crédits consommés' : 'crédit consommé'} sur ${fmtInt(creditsInitiaux)}`}
          </Text>
        </div>
        <div className="shrink-0 text-right">
          <span className="text-kpi font-black leading-none tabular-nums text-savr-neutral-900">
            {fmtInt(restantsAnimes)}
          </span>
          <div className="mt-0.5 text-3xs font-bold uppercase tracking-[0.08em] text-savr-neutral-400">
            {creditsRestants > 1 ? 'restants' : 'restant'}
          </div>
        </div>
      </div>

      {/* Une case par crédit (petits packs), sinon barre continue. */}
      <div
        ref={entree.ref}
        className={cn(
          'relative h-3',
          !enCases && 'overflow-hidden rounded-savr-full',
          enCases && 'flex gap-1',
          entree.classe,
        )}
        style={enCases ? undefined : { background: TRACK }}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={creditsInitiaux}
        aria-valuenow={creditsRestants}
        aria-label="Crédits restants du pack Anti-Gaspi"
      >
        {enCases ? (
          Array.from({ length: creditsInitiaux }, (_, i) => {
            const pleine = i < creditsRestants;
            return (
              <div
                key={i}
                data-case-credit={pleine ? 'restant' : 'consomme'}
                data-entree={pleine ? 'grandit' : undefined}
                className="h-full flex-1 rounded-savr-sm"
                style={
                  {
                    background: pleine ? barBg : TRACK,
                    '--entree-delai': `${i * 40}ms`,
                    transition:
                      'background var(--transition-duration-savr-base)',
                  } as React.CSSProperties
                }
              />
            );
          })
        ) : (
          <div
            data-entree="deploie"
            className="h-full rounded-savr-full"
            style={{
              width: `${pctFill}%`,
              background: barBg,
              transition:
                'width var(--motion-savr-slow), background var(--transition-duration-savr-base)',
            }}
          />
        )}
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-3">
        <Text as="span" variant="hint" tone="faint" className="tabular-nums">
          {`${fmtPct(pctRestant * 100, 0)} du pack restant`}
        </Text>
        {badge}
      </div>
    </Card>
  );
}

PackAgRing.displayName = 'PackAgRing';
