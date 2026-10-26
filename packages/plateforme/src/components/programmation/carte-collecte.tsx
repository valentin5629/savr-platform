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
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { FormField } from '@/components/ui/form-field';
import { FormGrid } from '@/components/ui/form-grid';
import { BORNES_TEXTE_LIBRE } from '@/lib/champs-texte-libre-bornes';
import { instantParis, jourParis } from '@savr/shared/src/temps/index.js';
import { TelephoneLien } from '@/components/collecte/fiche-blocs';
import { Heading } from '@/components/ui/heading';
import { Text } from '@/components/ui/text';
import { PAX_COLLECTE_MAX } from '@/lib/pax-collecte-borne';
import { ContactCombobox } from './contact-combobox';
import type { CarteSaisie } from '@/lib/programmation/cartes-saisie';

export interface TypeEvenementOption {
  id: string;
  libelle: string;
}

interface CarteCollecteProps {
  /** Valeurs affichées de la carte (reprise de la collecte n°1 comprise). */
  carte: CarteSaisie;
  /** « Collecte Zéro Déchet #1 ». */
  libelle: string;
  /** Suffixe des identifiants des champs (`zd-1`, `ag-2`…), unique dans la page. */
  suffixe: string;
  /** Collecte n°1 : les autres cartes reprennent ses champs (C5). */
  estModele: boolean;
  typesEvenements: TypeEvenementOption[];
  /** Pack AG de l'organisation (carte Anti-Gaspi) ; null = inconnu. */
  pack?: PackInfo | null;
  /** Même type, même date et même heure qu'une autre collecte (C4). */
  doublon: boolean;
  /** Organisation cible des contacts (programmation de support). */
  organisationId?: string;
  onChange: <K extends keyof CarteSaisie>(
    champ: K,
    valeur: CarteSaisie[K],
  ) => void;
  onAjouterContact: (role: 'principal' | 'secours') => void;
  className?: string;
}

// Ligne de l'équipe Savr à appeler pour une collecte à moins de 24 h.
export const TELEPHONE_SAVR = '07 61 91 29 97';
const DELAI_APPEL_MS = 24 * 3600 * 1000;

// Cadre de la carte (pas un badge) : ZD vert / AG navy — arbitrage Q1
// (couleur du type de collecte).
const TYPE_COLORS = {
  zd: 'border-savr-success bg-savr-success-subtle',
  ag: 'border-savr-primary-400 bg-savr-primary-50',
};

/**
 * Carte d'une collecte (refonte du formulaire, lot B2 ; §06.01 § 3.a) : date et
 * heure, convives, type d'événement, contacts et informations supplémentaires
 * de CETTE collecte. Utilisée par le formulaire de programmation et par
 * « Ajouter une collecte ».
 */
export function CarteCollecte({
  carte,
  libelle,
  suffixe,
  estModele,
  typesEvenements,
  pack,
  doublon,
  organisationId,
  onChange,
  onAjouterContact,
  className,
}: CarteCollecteProps) {
  const today = jourParis();

  // Moins de 24 h avant la collecte (décision Val 2026-10-16, ex-48 h) : écart
  // entre maintenant et la date + heure saisies, en heure de Paris. Tant que
  // l'heure n'est pas choisie, seule une collecte le jour même est sûre d'y être.
  const moinsDe24h =
    carte.date_collecte !== '' &&
    (carte.heure_collecte !== ''
      ? instantParis(carte.date_collecte, carte.heure_collecte).getTime() -
          Date.now() <
        DELAI_APPEL_MS
      : carte.date_collecte <= today);

  return (
    <section
      aria-label={libelle}
      data-testid={`carte-${suffixe}`}
      className={cn(
        'rounded-savr-md border-2 p-4 space-y-4',
        TYPE_COLORS[carte.type],
        className,
      )}
    >
      <Heading level={3} size="inherit">
        {libelle}
      </Heading>

      {!estModele && (
        <Text variant="hint">
          Convives, type d&apos;événement, contacts et informations reprennent
          ceux de la collecte n°1 tant que vous ne les modifiez pas ici.
        </Text>
      )}

      {carte.type === 'ag' && pack && (
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
        <FormField
          label="Date de collecte"
          htmlFor={`date-${suffixe}`}
          required
        >
          <DatePicker
            id={`date-${suffixe}`}
            data-testid={`date-${suffixe}`}
            min={today}
            value={carte.date_collecte}
            onChange={(v) => onChange('date_collecte', v)}
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

        <FormField
          label="Heure de collecte"
          htmlFor={`heure-${suffixe}`}
          required
        >
          <TimePicker
            id={`heure-${suffixe}`}
            data-testid={`heure-${suffixe}`}
            value={carte.heure_collecte}
            onChange={(v) => onChange('heure_collecte', v)}
            required
          />
        </FormField>

        <FormField
          label="Nombre de convives"
          htmlFor={`pax-${suffixe}`}
          required
        >
          <Input
            id={`pax-${suffixe}`}
            data-testid={`pax-${suffixe}`}
            // Champ de saisie, chiffres seuls, ni flèches ni molette (retour
            // Val du 2026-10-24) ; la borne reste vérifiée par paxSaisiValide.
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={String(PAX_COLLECTE_MAX).length}
            autoComplete="off"
            required
            value={carte.pax}
            onChange={(e) => onChange('pax', e.target.value.replace(/\D/g, ''))}
            placeholder="Ex : 80"
          />
        </FormField>

        <FormField
          label="Type d'événement"
          htmlFor={`type-evenement-${suffixe}`}
          required
        >
          <Combobox
            id={`type-evenement-${suffixe}`}
            icon={null}
            required
            placeholder="Choisir…"
            searchPlaceholder="Rechercher un type…"
            options={typesEvenements.map((t) => ({
              value: t.id,
              label: t.libelle,
            }))}
            value={carte.type_evenement_id}
            onChange={(v) => onChange('type_evenement_id', v)}
          />
        </FormField>
      </FormGrid>

      {doublon && (
        <AlertBar variant="warn">
          Pour un gros volume, une seule collecte suffit : l&apos;équipe Savr
          fixe le nombre de camions.
        </AlertBar>
      )}

      <FormGrid>
        <FormField
          label="Contact principal sur place"
          htmlFor={`contact-principal-${suffixe}`}
          required
        >
          <ContactCombobox
            value={carte.contact_principal}
            onChange={(c) => onChange('contact_principal', c)}
            onAddInline={() => onAjouterContact('principal')}
            organisationId={organisationId}
          />
        </FormField>

        <FormField
          label="Contact de secours (optionnel)"
          htmlFor={`contact-secours-${suffixe}`}
        >
          <ContactCombobox
            value={carte.contact_secours}
            onChange={(c) => onChange('contact_secours', c)}
            onAddInline={() => onAjouterContact('secours')}
            label="Ajouter un contact de secours…"
            organisationId={organisationId}
          />
        </FormField>
      </FormGrid>

      <FormField
        label="Informations supplémentaires (optionnel)"
        htmlFor={`infos-${suffixe}`}
      >
        <Textarea
          id={`infos-${suffixe}`}
          value={carte.informations_supplementaires}
          onChange={(e) =>
            onChange(
              'informations_supplementaires',
              e.target.value.slice(
                0,
                BORNES_TEXTE_LIBRE.informations_supplementaires.max,
              ),
            )
          }
          rows={3}
          placeholder="Instructions spécifiques, accès, matériel…"
          className="resize-none"
        />
        <Text variant="faint" className="mt-1 text-right">
          {carte.informations_supplementaires.length}/
          {BORNES_TEXTE_LIBRE.informations_supplementaires.max}
        </Text>
      </FormField>
    </section>
  );
}
