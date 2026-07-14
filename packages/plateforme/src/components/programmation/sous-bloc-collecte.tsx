'use client';

import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PackAGIndicator } from '@/components/ui/pack-ag-indicator';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/ui/form-field';

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
        'rounded-savr-md border-2 p-4 space-y-4',
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
            <p className="text-sm text-savr-error-strong font-medium">
              Aucun pack Anti-Gaspi actif — contactez votre responsable.
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField label="Date de collecte" htmlFor={`date-${type}`} required>
          <Input
            id={`date-${type}`}
            type="date"
            min={today}
            value={data.date_collecte}
            onChange={(e) =>
              onChange({ ...data, date_collecte: e.target.value })
            }
            required
          />
          {isLessThan48h && data.date_collecte && (
            <p className="mt-1 flex items-center gap-1 text-xs text-savr-warning font-medium">
              <AlertTriangle className="h-3.5 w-3.5" />
              Programmation à moins de 48h — disponibilité non garantie.
            </p>
          )}
        </FormField>

        <FormField label="Heure de collecte" htmlFor={`heure-${type}`} required>
          <Input
            id={`heure-${type}`}
            type="time"
            value={data.heure_collecte}
            onChange={(e) =>
              onChange({ ...data, heure_collecte: e.target.value })
            }
            required
          />
        </FormField>
      </div>

      <FormField
        label="Informations supplémentaires (optionnel)"
        htmlFor={`infos-${type}`}
      >
        <Textarea
          id={`infos-${type}`}
          value={data.informations_supplementaires}
          onChange={(e) =>
            onChange({
              ...data,
              informations_supplementaires: e.target.value.slice(0, 1000),
            })
          }
          rows={3}
          placeholder="Instructions spécifiques, accès, matériel…"
          className="resize-none"
        />
        <p className="mt-1 text-xs text-savr-neutral-400 text-right">
          {data.informations_supplementaires.length}/1000
        </p>
      </FormField>
    </div>
  );
}
