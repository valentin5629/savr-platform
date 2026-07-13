'use client';

import * as React from 'react';
import { fmtInt, fmtMasse } from './fmt';
import { CO2 } from './palette';

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
  // Bilan net favorable (évité net ≥ 0) → vert clair ; défavorable (induit >
  // évité) → orange d'alerte, jamais du vert « tout va bien » (redondance §5).
  const netColor = netKg >= 0 ? CO2.netInk : CO2.netWarn;

  return (
    <div
      className="relative overflow-hidden rounded-savr-lg p-7"
      style={{ background: CO2.bg, color: '#fff' }}
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
        className="mb-3.5 text-[11px] font-bold uppercase tracking-[0.08em]"
        style={{ color: CO2.labelSoft }}
      >
        Impact carbone · méthode ADEME
      </div>

      {/* Rangée principale : héros évité + lignes induit/net/énergie */}
      <div className="flex flex-wrap items-end gap-x-10 gap-y-6">
        {/* Bloc évité (héros) */}
        <div>
          <div
            className="mb-1 text-[13px] font-semibold"
            style={{ color: CO2.label }}
          >
            CO₂e évité
          </div>
          <div className="text-[44px] font-black leading-[0.9] tracking-[-0.03em] tabular-nums sm:text-[64px]">
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

        {/* Bloc lignes distinctes */}
        <div className="flex flex-col gap-2.5 pb-1">
          <div className="flex items-baseline gap-2.5">
            <span
              className="text-[13px]"
              style={{ width: 120, color: CO2.label }}
            >
              CO₂ induit
            </span>
            <span className="text-lg font-extrabold tabular-nums">
              {induit.value} {induit.unit}
            </span>
          </div>
          <div
            className="flex items-baseline gap-2.5"
            style={{ paddingTop: 8, borderTop: `1px solid ${CO2.border}` }}
          >
            <span
              className="text-[13px]"
              style={{ width: 120, color: CO2.label }}
            >
              Bilan net
            </span>
            <span
              className="text-lg font-extrabold tabular-nums"
              style={{ color: netColor }}
            >
              {net.value} {net.unit}
            </span>
          </div>
          <div className="flex items-baseline gap-2.5">
            <span
              className="text-[13px]"
              style={{ width: 120, color: CO2.label }}
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
        style={{ height: 1, background: CO2.border, margin: '22px 0 18px' }}
      />

      {/* Sous-titre équivalences */}
      <div
        className="mb-3 text-[10px] font-bold uppercase tracking-[0.08em]"
        style={{ color: CO2.labelFaint }}
      >
        Équivalences pédagogiques
      </div>

      {/* Grille 3 tuiles */}
      <div className="grid grid-cols-3 gap-3.5">
        {[
          { v: equivalences.kmVoiture, l: 'km en voiture' },
          { v: equivalences.repasBoeuf, l: 'repas de bœuf' },
          { v: equivalences.foyers, l: 'foyers (an)' },
        ].map((t) => (
          <div
            key={t.l}
            style={{
              background: CO2.tile,
              border: `1px solid ${CO2.border}`,
              borderRadius: 8,
              padding: 14,
            }}
          >
            <div className="text-[22px] font-extrabold tabular-nums">
              {fmtInt(t.v)}
            </div>
            <div className="mt-0.5 text-xs" style={{ color: CO2.label }}>
              {t.l}
            </div>
          </div>
        ))}
      </div>

      {/* Note bas */}
      <div className="mt-4 text-[11px]" style={{ color: CO2.labelFaint }}>
        Incertitude ADEME ± 50 %. L'évité et l'induit ne sont jamais soustraits
        pour annoncer une compensation.
      </div>
    </div>
  );
}

Co2HeroCard.displayName = 'Co2HeroCard';
