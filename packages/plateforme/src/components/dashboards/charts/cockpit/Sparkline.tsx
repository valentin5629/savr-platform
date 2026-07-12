'use client';

import * as React from 'react';

// Sparkline — micro-courbe de carte KPI (§ handoff Cockpit). viewBox 76×26,
// polyline lissée + point de fin accentué. `points` = valeurs brutes (≥2),
// auto-échelonnées dans la boîte. Purement présentationnel.
interface SparklineProps {
  points: number[];
  color: string;
  width?: number;
  height?: number;
}

const PAD = 3;

const Sparkline = React.forwardRef<SVGSVGElement, SparklineProps>(
  ({ points, color, width = 76, height = 26 }, ref) => {
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
    const last = coords[coords.length - 1]!;
    const poly = coords
      .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
      .join(' ');
    return (
      <svg
        ref={ref}
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        style={{ display: 'block' }}
        aria-hidden="true"
      >
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
