'use client';

import * as React from 'react';
import { fmtInt, fmtDec } from './fmt';
import { RING_OK, RING_LOW, TRACK, INK, TEXT_FAINT } from './palette';

export interface PackAgRingProps {
  creditsInitiaux: number;
  creditsRestants: number;
}

const C = 2 * Math.PI * 50; // ≈ 314.159

export function PackAgRing({
  creditsInitiaux,
  creditsRestants,
}: PackAgRingProps) {
  const consommes = Math.max(0, creditsInitiaux - creditsRestants);
  const pctConsomme = creditsInitiaux > 0 ? consommes / creditsInitiaux : 0;
  const pctRestant = 1 - pctConsomme;
  // L'arc représente le RESTANT (cohérent avec le grand chiffre au centre) : il
  // se vide au fil de la consommation, et vire au rouge sous 10 % (redondance
  // couleur ↔ badge « solde faible »).
  const dash = pctRestant * C;
  const arcColor = pctRestant <= 0.1 ? RING_LOW : RING_OK;

  let badge: React.ReactNode = null;
  if (creditsRestants === 0) {
    badge = (
      <span
        className="mt-2.5 inline-block rounded-savr-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] tabular-nums"
        style={{
          color: '#DC2626',
          backgroundColor: '#FEF2F2',
          border: '1px solid #FECACA',
        }}
      >
        Pack épuisé
      </span>
    );
  } else if (pctRestant <= 0.1) {
    badge = (
      <span
        className="mt-2.5 inline-block rounded-savr-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] tabular-nums"
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
    <div className="flex items-center gap-6 rounded-savr-lg border border-savr-neutral-200 bg-savr-white p-6 shadow-savr-sm">
      <svg
        viewBox="0 0 120 120"
        width={112}
        height={112}
        style={{ flexShrink: 0 }}
      >
        <circle
          cx={60}
          cy={60}
          r={50}
          fill="none"
          stroke={TRACK}
          strokeWidth={14}
        />
        <circle
          cx={60}
          cy={60}
          r={50}
          fill="none"
          stroke={arcColor}
          strokeWidth={14}
          strokeLinecap={dash > 0 && dash < C ? 'round' : 'butt'}
          strokeDasharray={`${dash} ${C - dash}`}
          transform="rotate(-90 60 60)"
          style={{ transition: 'stroke 200ms' }}
        />
        <text
          x={60}
          y={55}
          textAnchor="middle"
          className="tabular-nums"
          style={{ fontSize: 26, fontWeight: 900, fill: INK }}
        >
          {fmtInt(creditsRestants)}
        </text>
        <text
          x={60}
          y={74}
          textAnchor="middle"
          style={{
            fontSize: 9,
            fill: TEXT_FAINT,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            fontWeight: 700,
          }}
        >
          crédits restants
        </text>
      </svg>

      <div>
        <div className="mb-1.5 text-[15px] font-extrabold">
          Mon pack Anti-Gaspi
        </div>
        <div className="text-[13px] leading-relaxed text-savr-neutral-500">
          <span className="font-extrabold tabular-nums text-savr-neutral-800">
            {fmtInt(consommes)}
          </span>
          {' / '}
          {fmtInt(creditsInitiaux)} repas consommés
        </div>
        {badge}
      </div>
    </div>
  );
}

PackAgRing.displayName = 'PackAgRing';
