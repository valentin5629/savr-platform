'use client';

import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AlertBar } from '@/components/ui/alert-bar';
import { PackAGIndicator } from '@/components/ui/pack-ag-indicator';
import { factureeAlUnite, type PackInfo } from './use-pack-ag';
import { DatePicker } from '@/components/ui/date-picker';
import { TimePicker } from '@/components/ui/time-picker';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/ui/form-field';
import { FormGrid } from '@/components/ui/form-grid';
import { BORNES_TEXTE_LIBRE } from '@/lib/champs-texte-libre-bornes';
import { instantParis, jourParis } from '@savr/shared/src/temps/index.js';
import { TelephoneLien } from '@/components/collecte/fiche-blocs';
import { Heading } from '@/components/ui/heading';
import { Text } from '@/components/ui/text';
import { libelleTypeCollecte } from '@/lib/libelles/type-collecte';

export interface CollecteFormData {
  type: 'zd' | 'ag';
  date_collecte: string;
  heure_collecte: string;
  informations_supplementaires: string;
}

interface SousBlocCollecteProps {
  type: 'zd' | 'ag';
  data: CollecteFormData;
  onChange: (data: CollecteFormData) => void;
  pack?: PackInfo | null;
  className?: string;
}

// Ligne de l'équipe Savr à appeler pour une collecte à moins de 24 h.
const TELEPHONE_SAVR = '07 61 91 29 97';
const DELAI_APPEL_MS = 24 * 3600 * 1000;

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

  // Moins de 24 h avant la collecte (décision Val 2026-10-16, ex-48 h) : écart
  // entre maintenant et la date + heure saisies, en heure de Paris. Tant que
  // l'heure n'est pas choisie, seule une collecte le jour même est sûre d'y être.
  const moinsDe24h =
    data.date_collecte !== '' &&
    (data.heure_collecte !== ''
      ? instantParis(data.date_collecte, data.heure_collecte).getTime() -
          Date.now() <
        DELAI_APPEL_MS
      : data.date_collecte <= today);

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
          {factureeAlUnite(pack) ? (
            // Informatif, jamais bloquant (décision Val 2026-10-16).
            <AlertBar variant="info">
              Pas de pack Anti-Gaspi actif : cette collecte sera facturée à
              l&apos;unité.
            </AlertBar>
          ) : (
            <PackAGIndicator
              total={pack.credits_initiaux ?? 0}
              restant={pack.credits_restants ?? 0}
              label="Crédits pack AG restants"
            />
          )}
        </div>
      )}

      <FormGrid>
        <FormField label="Date de collecte" htmlFor={`date-${type}`} required>
          <DatePicker
            id={`date-${type}`}
            data-testid={`date-${type}`}
            min={today}
            value={data.date_collecte}
            onChange={(v) => onChange({ ...data, date_collecte: v })}
            required
          />
          {moinsDe24h && (
            <p className="mt-1 flex items-start gap-1 text-xs text-savr-warning font-medium">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
              <span>
                Programmation à moins de 24h — Nous vous demandons de nous
                appeler pour valider la faisabilité —{' '}
                <TelephoneLien telephone={TELEPHONE_SAVR} />
              </span>
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
      </FormGrid>

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
              informations_supplementaires: e.target.value.slice(
                0,
                BORNES_TEXTE_LIBRE.informations_supplementaires.max,
              ),
            })
          }
          rows={3}
          placeholder="Instructions spécifiques, accès, matériel…"
          className="resize-none"
        />
        <Text variant="faint" className="mt-1 text-right">
          {data.informations_supplementaires.length}/
          {BORNES_TEXTE_LIBRE.informations_supplementaires.max}
        </Text>
      </FormField>
    </div>
  );
}
