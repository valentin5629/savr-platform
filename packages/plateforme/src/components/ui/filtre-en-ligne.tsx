'use client';

import * as React from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

// Filtres « en ligne » — format unique de TOUTES les barres de filtres
// (décision Val 2026-09-30, généralisation du radar de la fiche collecte
// client §06.04 refonte 2026-09-29) : un titre cliquable suivi de la valeur
// courante (« Statut  Actif ▾ »), jamais un libellé au-dessus d'un champ. Le
// clic ouvre la liste : cases à cocher (choix multiple, `FiltreCoches`), coche
// sur l'option choisie (choix unique, `Combobox titre=…`), calendrier
// (`DateRangePicker titre=…`). Les filtres se rangent dans `BarreFiltres`.

/** Déclencheur commun : 44px mobile (cible tactile §8), 36px dès `sm`. */
export const declencheurFiltre =
  'inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-savr-md px-2 text-sm font-bold text-savr-primary-700 transition-colors hover:bg-savr-primary-50 data-[state=open]:bg-savr-primary-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-savr-primary-500 disabled:cursor-not-allowed disabled:opacity-50 sm:h-9';

/**
 * Contenu du déclencheur : titre, valeur courante, chevron. `titreId` permet à
 * un déclencheur `role="combobox"` (nom jamais tiré du contenu, ARIA) d'être
 * nommé par son titre via `aria-labelledby`, le texte restant sa valeur.
 */
export function ContenuDeclencheur({
  titre,
  valeur,
  titreId,
}: {
  titre: string;
  valeur: string;
  titreId?: string;
}) {
  return (
    <>
      <span id={titreId}>{titre}</span>
      <span className="max-w-[16rem] truncate font-normal text-savr-neutral-600">
        {valeur}
      </span>
      <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    </>
  );
}

interface BarreFiltresProps {
  /** Amorce en tête de ligne (ex. « Comparer avec »). */
  intro?: React.ReactNode;
  children: React.ReactNode;
  /** Affiche « Réinitialiser » à droite. */
  onReset?: () => void;
  resetLabel?: string;
  resetTestId?: string;
  /**
   * 'carte' (défaut) : bandeau neutral-50 posé dans une carte blanche.
   * 'page' : posé sur le fond de page neutral-50, le bandeau passe en blanc
   * bordé pour rester visible.
   */
  surface?: 'carte' | 'page';
  className?: string;
  'data-testid'?: string;
}

/** Bandeau d'une ligne de filtres, « Réinitialiser » calé à droite. */
export function BarreFiltres({
  intro,
  children,
  onReset,
  resetLabel = 'Réinitialiser',
  resetTestId,
  surface = 'carte',
  className,
  'data-testid': testId,
}: BarreFiltresProps) {
  return (
    <div
      data-testid={testId}
      className={cn(
        'flex flex-wrap items-center gap-1 rounded-savr-md px-3 py-2',
        surface === 'page'
          ? 'border border-savr-neutral-200 bg-savr-white'
          : 'bg-savr-neutral-50',
        className,
      )}
    >
      {intro && (
        <span className="mr-1 whitespace-nowrap text-[13px] font-semibold text-savr-neutral-500">
          {intro}
        </span>
      )}
      {children}
      {onReset && (
        <>
          <span className="flex-1" />
          <button
            type="button"
            onClick={onReset}
            data-testid={resetTestId}
            className="inline-flex h-11 shrink-0 items-center rounded-savr-md px-2 text-xs font-semibold text-savr-primary-700 hover:bg-savr-primary-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-savr-primary-500 sm:h-9"
          >
            {resetLabel}
          </button>
        </>
      )}
    </div>
  );
}

export interface OptionFiltre {
  id: string;
  nom: string;
  /** Libellé court affiché dans le déclencheur (défaut : `nom`). */
  court?: string;
}

interface FiltreCochesProps {
  label: string;
  options: OptionFiltre[];
  /** ids cochés ; tableau vide = « Tous ». */
  selected: string[];
  onChange: (ids: string[]) => void;
  /** Valeur affichée quand rien n'est coché. */
  tousLabel?: string;
  testid?: string;
}

// Résumé affiché à côté du titre : « Tous », le libellé (court) de l'option
// unique (« XL (≥ 1000) » → « XL »), ou le nombre d'options cochées.
function resumeSelection(
  options: OptionFiltre[],
  selected: string[],
  tousLabel: string,
): string {
  if (selected.length === 0) return tousLabel;
  if (selected.length === 1) {
    const o = options.find((x) => x.id === selected[0]);
    return o ? (o.court ?? o.nom) : '1 sélectionné';
  }
  return `${selected.length} sélectionnés`;
}

// Au-delà de 7 options, un champ de recherche filtre la liste (même seuil que
// le Combobox : listes de lieux / traiteurs / clients potentiellement longues).
const SEUIL_RECHERCHE = 7;

const normaliser = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

/**
 * Filtre à choix multiple : titre cliquable → liste à cocher (Popover +
 * Checkbox du DS, aucun <select> natif). Composant de filtrage uniquement —
 * aucune écriture.
 */
export function FiltreCoches({
  label,
  options,
  selected,
  onChange,
  tousLabel = 'Tous',
  testid,
}: FiltreCochesProps) {
  const [recherche, setRecherche] = React.useState('');
  const avecRecherche = options.length > SEUIL_RECHERCHE;
  const visibles = recherche
    ? options.filter((o) => normaliser(o.nom).includes(normaliser(recherche)))
    : options;
  return (
    <Popover onOpenChange={(o) => !o && setRecherche('')}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={testid}
          className={declencheurFiltre}
        >
          <ContenuDeclencheur
            titre={label}
            valeur={resumeSelection(options, selected, tousLabel)}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-1.5">
        {avecRecherche && (
          <Input
            type="search"
            aria-label={`Rechercher dans ${label}`}
            placeholder="Rechercher…"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            className="mb-1.5 sm:h-9"
          />
        )}
        {visibles.length === 0 ? (
          <p className="px-2 py-1.5 text-sm text-savr-neutral-500">
            {options.length === 0 ? 'Aucune option.' : 'Aucun résultat.'}
          </p>
        ) : (
          <ul aria-label={label} className="max-h-64 overflow-y-auto">
            {visibles.map((o) => {
              const coche = selected.includes(o.id);
              return (
                <li key={o.id}>
                  <label className="flex min-h-11 cursor-pointer sm:min-h-9 items-center gap-2.5 rounded-savr-sm px-2 text-sm text-savr-neutral-900 hover:bg-savr-neutral-50">
                    <Checkbox
                      checked={coche}
                      onCheckedChange={(v) =>
                        onChange(
                          v === true
                            ? [...selected, o.id]
                            : selected.filter((x) => x !== o.id),
                        )
                      }
                    />
                    {o.nom}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

type FiltreRechercheProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type'
>;

/** Recherche libre en tête de barre : loupe, sans titre au-dessus. */
export const FiltreRecherche = React.forwardRef<
  HTMLInputElement,
  FiltreRechercheProps
>(
  (
    {
      className,
      placeholder = 'Rechercher…',
      'aria-label': ariaLabel = 'Rechercher',
      ...props
    },
    ref,
  ) => (
    <div className="relative w-full sm:mr-2 sm:w-60">
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-savr-neutral-400"
        aria-hidden="true"
      />
      <Input
        ref={ref}
        type="search"
        aria-label={ariaLabel}
        placeholder={placeholder}
        className={cn('pl-8 sm:h-9', className)}
        {...props}
      />
    </div>
  ),
);
FiltreRecherche.displayName = 'FiltreRecherche';
