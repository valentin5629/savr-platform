'use client';

import * as React from 'react';
import { fmtInt, fmtMasse } from './fmt';

// Co2HeroCard — bloc héros à FOND NAVY (PAS ChartCard) présentant l'impact
// carbone selon la règle ABC (méthode ADEME) : le CO₂e ÉVITÉ est mis en héros,
// l'INDUIT et le NET sont des lignes distinctes — jamais soustraits pour
// annoncer une compensation. Composant purement présentationnel (props →
// rendu, aucune donnée serveur), SVG/hex inline, palette DS figée.
interface Co2HeroCardProps {
  eviteKg: number;
  induitKg: number;
  netKg: number;
  energiePrimaireKwh: number;
  equivalences: { kmVoiture: number; repasBoeuf: number; foyers: number };
}

export function Co2HeroCard({
  eviteKg,
  induitKg,
  netKg,
  energiePrimaireKwh,
  equivalences,
}: Co2HeroCardProps) {
  const evite = fmtMasse(eviteKg);
  const induit = fmtMasse(induitKg);
  const net = fmtMasse(netKg);

  return (
    <div
      className="relative overflow-hidden rounded-savr-lg p-7"
      style={{ background: '#223870', color: '#fff' }}
    >
      {/* Filet vert (accent « évité ») */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          bottom: 0,
          width: 3,
          background: '#16A34A',
        }}
      />

      {/* Suréditeur */}
      <div
        className="mb-3.5 text-[11px] font-bold uppercase tracking-[0.08em]"
        style={{ color: '#92A3D2' }}
      >
        Impact carbone · méthode ADEME
      </div>

      {/* Rangée principale : héros évité + lignes induit/net/énergie */}
      <div className="flex flex-wrap items-end gap-10">
        {/* Bloc évité (héros) */}
        <div>
          <div
            className="mb-1 text-[13px] font-semibold"
            style={{ color: '#BDC8E5' }}
          >
            CO₂e évité
          </div>
          <div className="text-[64px] font-black leading-[0.9] tracking-[-0.03em] tabular-nums">
            {evite.value}
            <span
              className="text-2xl font-extrabold"
              style={{ color: '#92A3D2' }}
            >
              {' '}
              {evite.unit}
            </span>
          </div>
        </div>

        {/* Bloc lignes distinctes */}
        <div className="flex flex-col gap-2.5 pb-1">
          <div className="flex items-baseline gap-2.5">
            <span
              className="text-[13px]"
              style={{ width: 120, color: '#BDC8E5' }}
            >
              CO₂ induit
            </span>
            <span className="text-lg font-extrabold tabular-nums">
              {induit.value} {induit.unit}
            </span>
          </div>
          <div
            className="flex items-baseline gap-2.5"
            style={{ paddingTop: 8, borderTop: '1px solid #2E4080' }}
          >
            <span
              className="text-[13px]"
              style={{ width: 120, color: '#BDC8E5' }}
            >
              Bilan net
            </span>
            <span
              className="text-lg font-extrabold tabular-nums"
              style={{ color: '#7ED9A6' }}
            >
              {net.value} {net.unit}
            </span>
          </div>
          <div className="flex items-baseline gap-2.5">
            <span
              className="text-[13px]"
              style={{ width: 120, color: '#BDC8E5' }}
            >
              Énergie primaire évitée
            </span>
            <span className="text-lg font-extrabold tabular-nums">
              {fmtInt(energiePrimaireKwh)} kWh
            </span>
          </div>
        </div>
      </div>

      {/* Séparateur */}
      <div
        style={{ height: 1, background: '#2E4080', margin: '22px 0 18px' }}
      />

      {/* Sous-titre équivalences */}
      <div
        className="mb-3 text-[10px] font-bold uppercase tracking-[0.08em]"
        style={{ color: '#6379B6' }}
      >
        Équivalences pédagogiques
      </div>

      {/* Grille 3 tuiles */}
      <div className="grid grid-cols-3 gap-3.5">
        <div
          style={{
            background: '#1B2C57',
            border: '1px solid #2E4080',
            borderRadius: 8,
            padding: 14,
          }}
        >
          <div className="text-[22px] font-extrabold tabular-nums">
            {fmtInt(equivalences.kmVoiture)}
          </div>
          <div className="mt-0.5 text-xs" style={{ color: '#BDC8E5' }}>
            km en voiture
          </div>
        </div>
        <div
          style={{
            background: '#1B2C57',
            border: '1px solid #2E4080',
            borderRadius: 8,
            padding: 14,
          }}
        >
          <div className="text-[22px] font-extrabold tabular-nums">
            {fmtInt(equivalences.repasBoeuf)}
          </div>
          <div className="mt-0.5 text-xs" style={{ color: '#BDC8E5' }}>
            repas de bœuf
          </div>
        </div>
        <div
          style={{
            background: '#1B2C57',
            border: '1px solid #2E4080',
            borderRadius: 8,
            padding: 14,
          }}
        >
          <div className="text-[22px] font-extrabold tabular-nums">
            {fmtInt(equivalences.foyers)}
          </div>
          <div className="mt-0.5 text-xs" style={{ color: '#BDC8E5' }}>
            foyers (an)
          </div>
        </div>
      </div>

      {/* Note bas */}
      <div className="mt-4 text-[11px]" style={{ color: '#6379B6' }}>
        Incertitude ADEME ± 50 %. L'évité et l'induit ne sont jamais soustraits
        pour annoncer une compensation.
      </div>
    </div>
  );
}

Co2HeroCard.displayName = 'Co2HeroCard';
