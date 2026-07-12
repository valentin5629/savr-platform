'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { fmtDec } from './fmt';
import { Sparkline } from './Sparkline';

// KpiCockpitCard — carte KPI de la rangée « cockpit » (R24). Pastille couleur,
// grande valeur, badge de variation coloré (vert ≥0 / rouge <0) et micro
// sparkline optionnelle. Purement présentationnel (props → rendu).
interface KpiCockpitCardProps {
  label: string;
  value: React.ReactNode;
  unit?: string;
  dotColor: string;
  variationPct?: number | null;
  sparkPoints?: number[];
  sparkColor?: string;
  href?: string;
  className?: string;
}

function KpiCockpitCard({
  label,
  value,
  unit,
  dotColor,
  variationPct,
  sparkPoints,
  sparkColor,
  href,
  className,
}: KpiCockpitCardProps): React.JSX.Element {
  const rootClassName = cn(
    'block rounded-savr-lg border border-savr-neutral-200 bg-savr-white p-5 shadow-savr-sm transition-[transform,box-shadow,border-color] duration-150 hover:-translate-y-0.5 hover:border-savr-neutral-300 hover:shadow-savr-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-savr-primary-500',
    className,
  );

  const body = (
    <>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-savr-neutral-500">
          {label}
        </span>
        <span
          style={{ width: 8, height: 8, borderRadius: 2, background: dotColor }}
        />
      </div>

      <div className="mt-2.5">
        <div className="flex items-baseline gap-1">
          <span className="text-[34px] font-extrabold leading-none tracking-[-0.02em] tabular-nums text-savr-neutral-900">
            {value}
          </span>
          {unit && (
            <span className="text-[17px] font-bold text-savr-neutral-400">
              {unit}
            </span>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between">
        {variationPct != null ? (
          <span
            className="inline-flex items-center gap-1 rounded-savr-full bg-savr-success-subtle px-2 py-0.5 text-xs font-extrabold tabular-nums text-savr-success-strong"
            style={
              variationPct >= 0
                ? undefined
                : { background: '#FEF2F2', color: '#DC2626' }
            }
          >
            {`${variationPct >= 0 ? '▲' : '▼'} ${fmtDec(Math.abs(variationPct), 1)} %`}
          </span>
        ) : (
          <span />
        )}
        {sparkPoints != null && sparkPoints.length >= 2 && (
          <Sparkline points={sparkPoints} color={sparkColor ?? dotColor} />
        )}
      </div>
    </>
  );

  if (href) {
    return (
      <a href={href} className={rootClassName} tabIndex={0}>
        {body}
      </a>
    );
  }

  return (
    <div className={rootClassName} tabIndex={0}>
      {body}
    </div>
  );
}
KpiCockpitCard.displayName = 'KpiCockpitCard';

export { KpiCockpitCard };
