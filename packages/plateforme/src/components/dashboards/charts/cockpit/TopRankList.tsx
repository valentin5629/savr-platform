'use client';

import * as React from 'react';
import { ChartCard } from './ChartCard';
import { initiales } from './fmt';

// TopRankList — liste-classement Cockpit (R24) : rang coloré (dégradé navy par
// position), avatar initiales, nom, mini-barre optionnelle et valeur déjà
// formatée par l'appelant. Enveloppé dans une ChartCard standard.

// Dégradé navy par rang (index 0..4, au-delà = dernier ton).
const RANK_COLORS = ['#223870', '#3F5599', '#6379B6', '#92A3D2', '#BDC8E5'];

function rankColor(index: number): string {
  return RANK_COLORS[index] ?? '#BDC8E5';
}

const AVATAR_TINT = {
  navy: { background: '#EFF2F9', color: '#223870' },
  orange: { background: '#FFF4E0', color: '#B36400' },
} as const;

export interface TopItem {
  label: string;
  /** Valeur DÉJÀ formatée par l'appelant (ex. '14,2 t', '5 240 €', '7 850'). */
  value: string;
  /** Largeur de la barre en pourcentage (0..100). Absent = pas de barre. */
  barPct?: number;
}

export interface TopRankListProps {
  title: string;
  subtitle?: string;
  items: TopItem[];
  /** Forme de l'avatar : carré (défaut) ou rond. */
  avatarShape?: 'square' | 'round';
  /** Teinte de l'avatar. */
  avatarTint?: 'navy' | 'orange';
  /** Affiche la mini-barre (si barPct fourni sur l'item). */
  showBar?: boolean;
}

const TopRankList = React.forwardRef<HTMLDivElement, TopRankListProps>(
  (
    {
      title,
      subtitle,
      items,
      avatarShape = 'square',
      avatarTint = 'navy',
      showBar = false,
    },
    ref,
  ) => {
    const tint = AVATAR_TINT[avatarTint];
    const avatarRadius =
      avatarShape === 'round' ? 'rounded-savr-full' : 'rounded-savr-md';

    return (
      <ChartCard title={title} subtitle={subtitle}>
        <div ref={ref}>
          {items.length === 0 ? (
            <p className="text-sm text-savr-neutral-500">
              Aucune donnée sur la période.
            </p>
          ) : (
            <div className="flex flex-col gap-3.5">
              {items.map((item, i) => {
                const color = rankColor(i);
                const hasBar = showBar && item.barPct != null;
                return (
                  <div key={i} className="flex items-center gap-3">
                    <span
                      className="w-5 text-[13px] font-extrabold tabular-nums"
                      style={{ color }}
                    >
                      {i + 1}
                    </span>
                    <span
                      className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center text-[11px] font-extrabold ${avatarRadius}`}
                      style={{
                        background: tint.background,
                        color: tint.color,
                      }}
                    >
                      {initiales(item.label)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex justify-between gap-2">
                        <span className="truncate text-[13px] font-bold text-savr-neutral-800">
                          {item.label}
                        </span>
                        <span className="text-[13px] font-extrabold tabular-nums">
                          {item.value}
                        </span>
                      </div>
                      {hasBar && (
                        <div
                          className="h-1.5 rounded-savr-full"
                          style={{ background: '#EEF0F5' }}
                        >
                          <div
                            style={{
                              width: `${item.barPct}%`,
                              height: 6,
                              background: color,
                              borderRadius: 100,
                            }}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </ChartCard>
    );
  },
);
TopRankList.displayName = 'TopRankList';

export { TopRankList };
