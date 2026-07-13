'use client';

import * as React from 'react';

// Sparkline — micro-courbe de carte KPI (§ handoff Cockpit). viewBox 76×26,
// polyline lissée + aire dégradée subtile sous la courbe + point de fin
// accentué. `points` = valeurs brutes (≥2), auto-échelonnées dans la boîte.
// Purement présentationnel.
interface SparklineProps {
  points: number[];
  color: string;
  width?: number;
  height?: number;
}

const PAD = 3;

const Sparkline = React.forwardRef<SVGSVGElement, SparklineProps>(
  ({ points, color, width = 76, height = 26 }, ref) => {
    // id stable pour le dégradé (évite les collisions entre cartes KPI).
    const gradId = React.useId();
    if (points.length < 2) return null;
    const min = Math.min(...points);
    const max = Math.max(...points);
    const span = max - min || 1;
    const innerW = width;
    const innerH = height - PAD * 2;
    const coords = points.map((v, i) => {
      const x = (i / (points.length - 1)) * innerW;
      const y = PAD + innerH - ((v - min) / span) * innerH;
      return [x, y] as const;
    });
    const first = coords[0]!;
    const last = coords[coords.length - 1]!;
    const poly = coords
      .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
      .join(' ');
    // Aire = courbe refermée jusqu'à la ligne de base (bas de la boîte).
    const baseY = (height - PAD).toFixed(1);
    const area = `${first[0].toFixed(1)},${baseY} ${poly} ${last[0].toFixed(1)},${baseY}`;
    return (
      <svg
        ref={ref}
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        style={{ display: 'block' }}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.22} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <polygon points={area} fill={`url(#${gradId})`} stroke="none" />
        <polyline
          points={poly}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx={last[0]} cy={last[1]} r={2.5} fill={color} />
      </svg>
    );
  },
);
Sparkline.displayName = 'Sparkline';

export { Sparkline };
