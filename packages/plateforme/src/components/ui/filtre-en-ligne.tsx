'use client';

import * as React from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
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
  // Libellé unique de remise à zéro (R-UI-4b, D5 : 2 libellés → 1).
  resetLabel = 'Réinitialiser les filtres',
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
        <span className="mr-1 whitespace-nowrap text-sm font-semibold text-savr-neutral-500">
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
  /**
   * Valeur cochée que la liste d'options ne proposait pas (lien reçu, option
   * sortie de la liste). Tant qu'elle est là, les options ne couvrent pas tout :
   * les cocher toutes n'est pas « Tous ».
   */
  horsListe?: boolean;
}

/** Cocher toutes les options vaut « Tous » : plusieurs options, aucune hors liste. */
function toutesValentTous(options: OptionFiltre[], ids: string[]): boolean {
  return (
    options.length > 1 &&
    !options.some((o) => o.horsListe) &&
    options.every((o) => ids.includes(o.id))
  );
}

interface FiltreCochesProps {
  label: string;
  options: OptionFiltre[];
  /** ids cochés ; tableau vide = « Tous ». */
  selected: string[];
  onChange: (ids: string[]) => void;
  testid?: string;
  /** Valeur affichée sans case cochée (défaut « Tous »). */
  libelleVide?: string;
  /** Libellé de la case « Tous » en tête de liste (défaut « Tous »). */
  libelleTous?: string;
  /**
   * Case « Tous » pilotée par le consommateur, quand « tout » ne se réduit
   * pas à une sélection vide (Dashboard Client : périmètre = union de
   * plusieurs filtres). Défaut : cochée tant que rien n'est coché ; la cocher
   * vide la sélection ; cocher toutes les options revient à « Tous ».
   * `onDeselect` : décocher « Tous » (sinon sans effet).
   */
  tous?: { coche: boolean; onSelect: () => void; onDeselect?: () => void };
  /**
   * La sélection vide désigne plus large que les options listées (« Tout le
   * parc Savr » face aux seuls lieux du gestionnaire) : les cocher toutes
   * reste une sélection explicite, ni vidée ni résumée en `libelleTous`.
   */
  listePartielle?: boolean;
}

// Résumé affiché à côté du titre : « Tous » (ou `libelleVide`), `libelleTous`
// si toutes les options sont cochées, le libellé (court) de l'option unique
// (« XL (≥ 1000) » → « XL »), ou le nombre d'options cochées.
function resumeSelection(
  options: OptionFiltre[],
  selected: string[],
  libelleVide: string,
  libelleTous: string,
  listePartielle: boolean,
): string {
  if (selected.length === 0) return libelleVide;
  if (!listePartielle && toutesValentTous(options, selected))
    return libelleTous;
  if (selected.length === 1) {
    const o = options.find((x) => x.id === selected[0]);
    return o ? (o.court ?? o.nom) : '1 sélectionné';
  }
  return `${selected.length} sélectionnés`;
}

/**
 * Au-delà de ce nombre d'options, un champ de recherche filtre la liste —
 * seuil commun au Combobox et à FiltreCoches (lieux / traiteurs / clients
 * potentiellement longs).
 */
export const SEUIL_RECHERCHE = 7;

const normaliser = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const ligneCoche =
  'flex min-h-11 cursor-pointer sm:min-h-9 items-center gap-2.5 rounded-savr-sm px-2 text-sm text-savr-neutral-900 hover:bg-savr-neutral-50';

/**
 * Filtre à choix multiple : titre cliquable → liste à cocher (Popover +
 * Checkbox du DS, aucun <select> natif), case « Tous » en tête (= aucun
 * filtre, décision Val 2026-09-30). Composant de filtrage uniquement —
 * aucune écriture.
 */
export function FiltreCoches({
  label,
  options,
  selected,
  onChange,
  testid,
  libelleVide = 'Tous',
  libelleTous = 'Tous',
  tous,
  listePartielle = false,
}: FiltreCochesProps) {
  const [recherche, setRecherche] = React.useState('');
  const avecRecherche = options.length > SEUIL_RECHERCHE;
  const visibles = recherche
    ? options.filter((o) => normaliser(o.nom).includes(normaliser(recherche)))
    : options;
  const tousCoche = tous ? tous.coche : selected.length === 0;

  function basculer(id: string, coche: boolean) {
    const suivants = coche
      ? [...selected, id]
      : selected.filter((x) => x !== id);
    // Toutes les options cochées = « Tous » (mode par défaut seulement : un
    // consommateur qui pilote `tous` garde sa sélection explicite). Une option
    // hors liste que l'on décoche quitte la liste : on juge sur celles qui
    // restent, sinon le déclencheur afficherait « Tous » sur un filtre gardé.
    const restantes = options.filter(
      (o) => !o.horsListe || suivants.includes(o.id),
    );
    const vautTous =
      !tous && !listePartielle && toutesValentTous(restantes, suivants);
    onChange(vautTous ? [] : suivants);
  }
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
            valeur={resumeSelection(
              options,
              selected,
              libelleVide,
              libelleTous,
              listePartielle,
            )}
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
            {/* « Tous » = aucun filtre : se décoche en choisissant une valeur.
                Masquée pendant une recherche (ne vise pas « tous les résultats »). */}
            {!recherche && (
              <li className="mb-1 border-b border-savr-neutral-100 pb-1">
                <label className={ligneCoche}>
                  <Checkbox
                    checked={tousCoche}
                    onCheckedChange={(v) => {
                      if (v !== true) tous?.onDeselect?.();
                      else if (tous) tous.onSelect();
                      else onChange([]);
                    }}
                  />
                  {libelleTous}
                </label>
              </li>
            )}
            {visibles.map((o) => (
              <li key={o.id}>
                <label className={ligneCoche}>
                  <Checkbox
                    checked={selected.includes(o.id)}
                    onCheckedChange={(v) => basculer(o.id, v === true)}
                  />
                  {o.nom}
                </label>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Délai de frappe (ms) avant d'émettre la recherche. */
export const DELAI_RECHERCHE_MS = 300;

interface FiltreRechercheProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value'
> {
  /** Valeur appliquée (ex. `q` de `useFiltresUrl`). */
  value?: string;
  /**
   * Valeur émise après `delai` ms sans frappe (sans espaces de bord, une seule
   * fois par valeur) ; immédiatement à l'effacement (✕). Le `onChange` natif,
   * s'il est fourni, reste appelé à chaque frappe.
   */
  onValueChange?: (valeur: string) => void;
  /** Délai du debounce (défaut `DELAI_RECHERCHE_MS`). */
  delai?: number;
}

/**
 * Recherche libre en tête de barre : loupe, sans titre au-dessus. Debounce
 * intégré (R-UI-4b, D7 : avant, 1 écran sur 4 en avait un, chacun le sien) et
 * bouton effacer ✕ commun, à droite du champ, visible dès qu'il y a du texte.
 * La saisie est locale : `value` ne la remplace que lorsqu'il change de
 * l'extérieur (reset, URL), jamais quand il ne fait qu'écho à la valeur émise.
 */
export const FiltreRecherche = React.forwardRef<
  HTMLInputElement,
  FiltreRechercheProps
>(
  (
    {
      className,
      placeholder = 'Rechercher…',
      'aria-label': ariaLabel = 'Rechercher',
      value = '',
      onValueChange,
      delai = DELAI_RECHERCHE_MS,
      onChange,
      ...props
    },
    ref,
  ) => {
    const [saisie, setSaisie] = React.useState(value);
    // Dernière valeur appliquée (reçue ou émise) : un `value` qui ne fait que
    // la répéter ne doit pas écraser la saisie en cours.
    const appliquee = React.useRef(value);
    const minuteur = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const onValueChangeRef = React.useRef(onValueChange);
    onValueChangeRef.current = onValueChange;

    const annuler = () => {
      if (minuteur.current !== null) {
        clearTimeout(minuteur.current);
        minuteur.current = null;
      }
    };
    React.useEffect(() => {
      if (value !== appliquee.current) {
        // Valeur externe (reset, URL) : une saisie en vol ne doit pas la
        // ré-émettre après coup (revue principale #481).
        annuler();
        appliquee.current = value;
        setSaisie(value);
      }
    }, [value]);
    React.useEffect(() => annuler, []);

    const emettre = (valeur: string) => {
      const nette = valeur.trim();
      if (nette === appliquee.current) return;
      appliquee.current = nette;
      onValueChangeRef.current?.(nette);
    };

    const effacer = () => {
      annuler();
      setSaisie('');
      emettre('');
    };

    return (
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
          value={saisie}
          onChange={(e) => {
            const v = e.target.value;
            setSaisie(v);
            onChange?.(e);
            annuler();
            minuteur.current = setTimeout(() => {
              minuteur.current = null;
              emettre(v);
            }, delai);
          }}
          className={cn(
            // Le ✕ natif de WebKit doublerait le bouton commun.
            'pl-8 pr-8 sm:h-9 [&::-webkit-search-cancel-button]:appearance-none',
            className,
          )}
          {...props}
        />
        {saisie && (
          <button
            type="button"
            aria-label="Effacer la recherche"
            onClick={effacer}
            className="absolute right-1 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-savr-sm text-savr-neutral-500 hover:bg-savr-neutral-100 hover:text-savr-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-savr-primary-500"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
    );
  },
);
FiltreRecherche.displayName = 'FiltreRecherche';
