'use client';

import * as React from 'react';
import { fmtInt, fmtMasse } from './fmt';
import { CO2 } from './palette';

// Co2HeroCardAg — variante ANTI-GASPI (allégée) du héros carbone. Contrairement au
// ZD (méthode ABC : évité / induit / net / énergie), le CO₂ AG est « ÉVITÉ SEUL en
// V1 » (§05 Règles métier R_co2_ag l.587, §11 l.163) : le facteur FAO estime
// l'empreinte carbone moyenne d'un repas sauvé du gaspillage, sans induit ni bilan
// net (V2). Donc : pas de lignes induit/net/énergie, pas de tableau par matière,
// juste l'évité en héros + 2 équivalences pédagogiques (km voiture, repas de bœuf ;
// « foyers » est énergie-dépendant → sans objet pour l'AG). Purement présentationnel
// (props → rendu), même fond navy + palette DS que Co2HeroCard.
interface Co2HeroCardAgProps {
  eviteKg: number;
  equivalences: { kmVoiture: number; repasBoeuf: number };
}

export function Co2HeroCardAg({
  eviteKg,
  equivalences,
}: Co2HeroCardAgProps): React.ReactElement {
  const evite = fmtMasse(eviteKg);

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
        Impact carbone · dons anti-gaspi
      </div>

      {/* Héros évité (seul — pas d'induit/net/énergie en V1) */}
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

      {/* Grille 2 tuiles (km voiture + repas de bœuf) */}
      <div className="grid grid-cols-2 gap-3.5">
        {[
          { v: equivalences.kmVoiture, l: 'km en voiture' },
          { v: equivalences.repasBoeuf, l: 'repas de bœuf' },
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
        Empreinte carbone moyenne d'un repas sauvé du gaspillage (méthode FAO).
        Évité seul en V1 — aucun bilan net n'est annoncé. Incertitude ± 50 %.
      </div>
    </div>
  );
}

Co2HeroCardAg.displayName = 'Co2HeroCardAg';
