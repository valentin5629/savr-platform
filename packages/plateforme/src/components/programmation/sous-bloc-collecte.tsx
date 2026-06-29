'use client';

import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PackAGIndicator } from '@/components/ui/pack-ag-indicator';

export interface CollecteFormData {
  type: 'zd' | 'ag';
  date_collecte: string;
  heure_collecte: string;
  informations_supplementaires: string;
}

interface PackInfo {
  pack_actif: boolean;
  credits_initiaux?: number;
  credits_consommes?: number;
  credits_restants?: number;
}

interface SousBlocCollecteProps {
  type: 'zd' | 'ag';
  data: CollecteFormData;
  onChange: (data: CollecteFormData) => void;
  pack?: PackInfo | null;
  className?: string;
}

const TYPE_LABELS = { zd: 'Zéro Déchet', ag: 'Anti-Gaspi' };
const TYPE_COLORS = {
  zd: 'border-savr-success bg-green-50',
  ag: 'border-savr-primary-400 bg-savr-primary-50',
};

export function SousBlocCollecte({
  type,
  data,
  onChange,
  pack,
  className,
}: SousBlocCollecteProps) {
  const today = new Date().toISOString().slice(0, 10);

  const twoDaysFromNow = new Date();
  twoDaysFromNow.setDate(twoDaysFromNow.getDate() + 2);
  const isLessThan48h =
    data.date_collecte !== '' &&
    data.date_collecte < twoDaysFromNow.toISOString().slice(0, 10);

  return (
    <div
      className={cn(
        'rounded-savr-lg border-2 p-4 space-y-4',
        TYPE_COLORS[type],
        className,
      )}
    >
      <h3 className="font-semibold text-savr-neutral-900">
        Collecte {TYPE_LABELS[type]}
      </h3>

      {type === 'ag' && pack && (
        <div>
          {pack.pack_actif ? (
            <PackAGIndicator
              total={pack.credits_initiaux ?? 0}
              restant={pack.credits_restants ?? 0}
              label="Crédits pack AG restants"
            />
          ) : (
            <p className="text-sm text-savr-error font-medium">
              Aucun pack Anti-Gaspi actif — contactez votre responsable.
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className="text-sm font-medium text-savr-neutral-700">
            Date de collecte <span className="text-savr-error">*</span>
          </label>
          <input
            type="date"
            min={today}
            value={data.date_collecte}
            onChange={(e) =>
              onChange({ ...data, date_collecte: e.target.value })
            }
            className="w-full rounded-savr-md border border-savr-neutral-300 px-3 py-2 text-sm focus:outline-2 focus:outline-savr-primary-500"
            required
          />
          {isLessThan48h && data.date_collecte && (
            <p className="flex items-center gap-1 text-xs text-savr-warning font-medium">
              <AlertTriangle className="h-3.5 w-3.5" />
              Programmation à moins de 48h — disponibilité non garantie.
            </p>
          )}
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium text-savr-neutral-700">
            Heure de collecte <span className="text-savr-error">*</span>
          </label>
          <input
            type="time"
            value={data.heure_collecte}
            onChange={(e) =>
              onChange({ ...data, heure_collecte: e.target.value })
            }
            className="w-full rounded-savr-md border border-savr-neutral-300 px-3 py-2 text-sm focus:outline-2 focus:outline-savr-primary-500"
            required
          />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium text-savr-neutral-700">
          Informations supplémentaires
          <span className="text-xs font-normal text-savr-neutral-400 ml-1">
            (optionnel, max 1000 car.)
          </span>
        </label>
        <textarea
          value={data.informations_supplementaires}
          onChange={(e) =>
            onChange({
              ...data,
              informations_supplementaires: e.target.value.slice(0, 1000),
            })
          }
          rows={3}
          placeholder="Instructions spécifiques, accès, matériel…"
          className="w-full rounded-savr-md border border-savr-neutral-300 px-3 py-2 text-sm resize-none focus:outline-2 focus:outline-savr-primary-500"
        />
        <p className="text-xs text-savr-neutral-400 text-right">
          {data.informations_supplementaires.length}/1000
        </p>
      </div>
    </div>
  );
}
