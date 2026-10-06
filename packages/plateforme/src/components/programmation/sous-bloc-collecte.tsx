'use client';

import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AlertBar } from '@/components/ui/alert-bar';
import { PackAGIndicator } from '@/components/ui/pack-ag-indicator';
import { DatePicker } from '@/components/ui/date-picker';
import { TimePicker } from '@/components/ui/time-picker';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/ui/form-field';
import { jourParis } from '@savr/shared/src/temps/index.js';
import { Heading } from '@/components/ui/heading';
import { Text } from '@/components/ui/text';
import { libelleTypeCollecte } from '@/lib/libelles/type-collecte';

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

// Cadre du sous-bloc (pas un badge) : ZD vert / AG navy — hors
// `VARIANT_TYPE_COLLECTE`, suit l'arbitrage Q1 (couleur du type de collecte).
const TYPE_COLORS = {
  zd: 'border-savr-success bg-savr-success-subtle',
  ag: 'border-savr-primary-400 bg-savr-primary-50',
};

export function SousBlocCollecte({
  type,
  data,
  onChange,
  pack,
  className,
}: SousBlocCollecteProps) {
  const today = jourParis();

  const twoDaysFromNow = new Date();
  twoDaysFromNow.setDate(twoDaysFromNow.getDate() + 2);
  const isLessThan48h =
    data.date_collecte !== '' && data.date_collecte < jourParis(twoDaysFromNow);

  return (
    <div
      className={cn(
        'rounded-savr-md border-2 p-4 space-y-4',
        TYPE_COLORS[type],
        className,
      )}
    >
      <Heading level={3} size="inherit">
        Collecte {libelleTypeCollecte(type)}
      </Heading>

      {type === 'ag' && pack && (
        <div>
          {pack.pack_actif ? (
            <PackAGIndicator
              total={pack.credits_initiaux ?? 0}
              restant={pack.credits_restants ?? 0}
              label="Crédits pack AG restants"
            />
          ) : (
            <AlertBar variant="err">
              Aucun pack Anti-Gaspi actif — contactez votre responsable.
            </AlertBar>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField label="Date de collecte" htmlFor={`date-${type}`} required>
          <DatePicker
            id={`date-${type}`}
            data-testid={`date-${type}`}
            min={today}
            value={data.date_collecte}
            onChange={(v) => onChange({ ...data, date_collecte: v })}
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
          <TimePicker
            id={`heure-${type}`}
            data-testid={`heure-${type}`}
            value={data.heure_collecte}
            onChange={(v) => onChange({ ...data, heure_collecte: v })}
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
        <Text variant="faint" className="mt-1 text-right">
          {data.informations_supplementaires.length}/1000
        </Text>
      </FormField>
    </div>
  );
}
