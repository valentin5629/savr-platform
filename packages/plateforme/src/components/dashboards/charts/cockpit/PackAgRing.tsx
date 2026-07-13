'use client';

import * as React from 'react';
import { fmtInt, fmtDec } from './fmt';
import { RING_OK, RING_LOW, TRACK } from './palette';

export interface PackAgRingProps {
  creditsInitiaux: number;
  creditsRestants: number;
}

// PackAgRing — jauge LINÉAIRE du pack Anti-Gaspi (R24b, retour Val « jauge en
// ligne »). Barre horizontale = crédits RESTANTS (cohérent avec le grand chiffre),
// orange saine → rouge sous 10 % (redondance couleur ↔ badge). Purement
// présentationnel ; le nom historique est conservé pour ne pas casser les imports.
export function PackAgRing({
  creditsInitiaux,
  creditsRestants,
}: PackAgRingProps) {
  const consommes = Math.max(0, creditsInitiaux - creditsRestants);
  const pctRestant =
    creditsInitiaux > 0 ? creditsRestants / creditsInitiaux : 0;
  const pctFill = Math.max(0, Math.min(1, pctRestant)) * 100;
  const low = pctRestant <= 0.1;
  const fillColor = low ? RING_LOW : RING_OK;
  // Même rendu que les barres de l'histogramme AG juste au-dessus (couleur à
  // 75 % sur blanc — retour Val R24b).
  const barBg = `color-mix(in srgb, ${fillColor} 75%, white)`;

  let badge: React.ReactNode = null;
  if (creditsRestants === 0) {
    badge = (
      <span
        className="inline-block rounded-savr-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] tabular-nums"
        style={{
          color: '#DC2626',
          backgroundColor: '#FEF2F2',
          border: '1px solid #FECACA',
        }}
      >
        Pack épuisé
      </span>
    );
  } else if (low) {
    badge = (
      <span
        className="inline-block rounded-savr-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] tabular-nums"
        style={{
          color: '#B36400',
          backgroundColor: '#FFF4E0',
          border: '1px solid #FFE8C2',
        }}
      >
        {`Solde faible · ${fmtDec(pctRestant * 100, 1)} %`}
      </span>
    );
  }

  return (
    <div className="rounded-savr-lg border border-savr-neutral-200 bg-savr-white p-6 shadow-savr-sm">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[15px] font-extrabold text-savr-neutral-900">
            Mon pack Anti-Gaspi
          </div>
          <div className="mt-0.5 text-[13px] text-savr-neutral-500">
            <span className="font-extrabold tabular-nums text-savr-neutral-800">
              {fmtInt(consommes)}
            </span>
            {' / '}
            {fmtInt(creditsInitiaux)} repas consommés
          </div>
        </div>
        <div className="shrink-0 text-right">
          <span className="text-[34px] font-black leading-none tabular-nums text-savr-neutral-900">
            {fmtInt(creditsRestants)}
          </span>
          <div className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-savr-neutral-400">
            crédits restants
          </div>
        </div>
      </div>

      {/* Jauge linéaire — remplissage = restant, rouge sous 10 %. */}
      <div
        className="relative h-3 overflow-hidden rounded-savr-full"
        style={{ background: TRACK }}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={creditsInitiaux}
        aria-valuenow={creditsRestants}
        aria-label="Crédits restants du pack Anti-Gaspi"
      >
        <div
          className="h-full rounded-savr-full"
          style={{
            width: `${pctFill}%`,
            background: barBg,
            transition: 'width 300ms ease-out, background 200ms',
          }}
        />
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-3">
        <span className="text-[11px] tabular-nums text-savr-neutral-400">
          {`${fmtDec(pctRestant * 100, 0)} % du pack restant`}
        </span>
        {badge}
      </div>
    </div>
  );
}

PackAgRing.displayName = 'PackAgRing';
