'use client';

import * as React from 'react';
import { fmtInt, fmtMasse } from './fmt';
import { CO2, WHITE } from './palette';
import { MENTION_CO2_EVITE } from '@/lib/co2-mention';

// Co2HeroCard — bloc héros à FOND NAVY (PAS ChartCard) présentant le CO₂e
// ÉVITÉ ESTIMÉ (décisions Val 2026-11-09) : jamais de bilan net, ni d'énergie
// primaire / foyers. Deux variantes :
//   - `zd` : évité des flux zéro déchet + CO₂ induit sur une ligne distincte ;
//   - `ag` : évité des repas donnés seul (facteur repas moyen, Base Carbone ADEME).
// 2 équivalences (km voiture, repas de bœuf). Composant purement
// présentationnel (props → rendu), palette DS via tokens.
interface Co2HeroCardProps {
  variant?: 'zd' | 'ag';
  eviteKg: number;
  /** CO₂ induit (ZD seulement), affiché à côté de l'évité, jamais soustrait. */
  induitKg?: number;
  equivalences: { kmVoiture: number; repasBoeuf: number };
}

const GRAPHIE_CO2 = 'CO₂e évité'; // graphie CO₂ : Q6 tranché « CO₂e » (2026-10-06)

export function Co2HeroCard(props: Co2HeroCardProps): React.ReactElement {
  const ag = props.variant === 'ag';
  const evite = fmtMasse(props.eviteKg);

  const tuiles = [
    { v: props.equivalences.kmVoiture, l: 'km en voiture' },
    { v: props.equivalences.repasBoeuf, l: 'repas de bœuf' },
  ];

  const hero = (
    <div>
      <div className="mb-1 text-sm font-semibold" style={{ color: CO2.label }}>
        {GRAPHIE_CO2}
      </div>
      <div className="text-4xl font-black leading-[0.9] tracking-[-0.03em] tabular-nums">
        {evite.value}
        <span
          className="text-xl font-extrabold sm:text-2xl"
          style={{ color: CO2.labelSoft }}
        >
          {' '}
          {evite.unit}
        </span>
      </div>
    </div>
  );

  return (
    <div
      className="relative overflow-hidden rounded-savr-lg p-7"
      style={{ background: CO2.bg, color: WHITE }}
    >
      {/* Filet vert (accent « évité ») */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          bottom: 0,
          width: 3,
          background: CO2.filetEvite,
        }}
      />

      {/* Suréditeur */}
      <div
        className="mb-3.5 text-xs font-bold uppercase tracking-[0.08em]"
        style={{ color: CO2.labelSoft }}
      >
        {ag
          ? 'Émissions évitées estimées · dons anti-gaspi'
          : 'Impact carbone estimé · zéro déchet'}
      </div>

      {props.induitKg == null ? (
        hero
      ) : (
        <div className="flex flex-wrap items-end gap-x-10 gap-y-6">
          {hero}
          <LigneInduit induitKg={props.induitKg} />
        </div>
      )}

      {/* Séparateur */}
      <div
        style={{ height: 1, background: CO2.border, margin: '22px 0 18px' }}
      />

      {/* Sous-titre équivalences */}
      <div
        className="mb-3 text-3xs font-bold uppercase tracking-[0.08em]"
        style={{ color: CO2.labelFaint }}
      >
        Équivalences pédagogiques
      </div>

      <div className="grid grid-cols-2 gap-3.5">
        {tuiles.map((t) => (
          <div
            key={t.l}
            style={{
              background: CO2.tile,
              border: `1px solid ${CO2.border}`,
              borderRadius: 8,
              padding: 14,
            }}
          >
            <div className="text-xl font-extrabold tabular-nums">
              {fmtInt(t.v)}
            </div>
            <div className="mt-0.5 text-xs" style={{ color: CO2.label }}>
              {t.l}
            </div>
          </div>
        ))}
      </div>

      {/* Note bas */}
      <div className="mt-4 text-xs" style={{ color: CO2.labelFaint }}>
        {MENTION_CO2_EVITE}
      </div>
    </div>
  );
}

/** Ligne ZD distincte : CO₂ induit (transport + traitement). */
function LigneInduit({ induitKg }: { induitKg: number }): React.ReactElement {
  const induit = fmtMasse(induitKg);
  return (
    <div className="flex items-baseline gap-2.5 pb-1">
      <span className="text-sm" style={{ color: CO2.label }}>
        CO₂ induit (transport, traitement)
      </span>
      <span className="text-lg font-extrabold tabular-nums">
        {induit.value} {induit.unit}
      </span>
    </div>
  );
}

Co2HeroCard.displayName = 'Co2HeroCard';
