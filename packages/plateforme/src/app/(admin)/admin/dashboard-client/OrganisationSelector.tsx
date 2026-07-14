'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export interface OrganisationOption {
  id: string;
  /** Nom NOT NULL — colonne canonique de l'autocomplete (§06.06 §2). */
  nom: string;
  /** Raison sociale nullable — fallback = nom. */
  raison_sociale: string | null;
  type: string;
}

function orgLabel(o: OrganisationOption): string {
  return o.raison_sociale ?? o.nom;
}

interface OrganisationSelectorProps {
  organisations: OrganisationOption[];
  /** ids sélectionnés ; tableau vide = « Toutes les organisations ». */
  selected: string[];
  onChange: (ids: string[]) => void;
}

// Ordre d'affichage + libellés pluriels des cellules par type (§06.06 §2 :
// traiteur, agence, gestionnaire_lieux). Un type inconnu retombe sur son code.
const TYPE_ORDER = ['traiteur', 'agence', 'gestionnaire_lieux'] as const;
const TYPE_LABEL: Record<string, string> = {
  traiteur: 'Traiteurs',
  agence: 'Agences',
  gestionnaire_lieux: 'Gestionnaires de lieux',
};

/**
 * Sélecteur d'organisations du Dashboard Client (§06.06 §2).
 * Multi-sélection en CELLULES par type d'organisation SUR UNE LIGNE (retour Val
 * R24c) — Traiteurs / Agences / Gestionnaires de lieux (ordre §06.06 §2). Chaque
 * cellule est une LISTE DÉROULANTE : repliée par défaut, ouverte au clic (panneau
 * absolu, 4 lignes visibles puis scroll), fermée au clic en dehors. Recherche
 * transverse + « Toutes les organisations » (sélection vide = défaut). Design
 * System : tokens savr, cibles 44px, chevrons. Composant de filtrage, aucune écriture.
 */
export function OrganisationSelector({
  organisations,
  selected,
  onChange,
}: OrganisationSelectorProps) {
  const [query, setQuery] = useState('');
  // Une seule cellule ouverte à la fois (comportement liste déroulante).
  const [openType, setOpenType] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Fermeture au clic en dehors du sélecteur.
  useEffect(() => {
    if (!openType) return;
    function onDown(e: MouseEvent): void {
      if (!rootRef.current?.contains(e.target as Node)) setOpenType(null);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [openType]);

  const byId = useMemo(
    () => new Map(organisations.map((o) => [o.id, o])),
    [organisations],
  );
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const toutes = selected.length === 0;

  // Filtre recherche puis regroupement par type, dans l'ordre TYPE_ORDER
  // (types hors liste ajoutés à la fin). Une cellule sans résultat est masquée.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? organisations.filter((o) => orgLabel(o).toLowerCase().includes(q))
      : organisations;
    const byType = new Map<string, OrganisationOption[]>();
    for (const o of filtered) {
      const list = byType.get(o.type) ?? [];
      list.push(o);
      byType.set(o.type, list);
    }
    const orderedTypes = [
      ...TYPE_ORDER.filter((t) => byType.has(t)),
      ...[...byType.keys()].filter(
        (t) => !TYPE_ORDER.includes(t as (typeof TYPE_ORDER)[number]),
      ),
    ];
    return orderedTypes.map((type) => ({
      type,
      label: TYPE_LABEL[type] ?? type,
      items: (byType.get(type) ?? []).sort((a, b) =>
        orgLabel(a).localeCompare(orgLabel(b)),
      ),
    }));
  }, [query, organisations]);

  function toggle(id: string): void {
    if (selectedSet.has(id)) onChange(selected.filter((x) => x !== id));
    else onChange([...selected, id]);
  }

  return (
    <div
      ref={rootRef}
      data-testid="organisation-selector"
      className="space-y-3 rounded-savr-lg border border-savr-neutral-200 bg-savr-white p-4 shadow-savr-sm"
    >
      {/* En-tête : libellé + résumé sélection (badges retirables) + réinitialiser. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-savr-neutral-700">
          Organisations
        </span>
        {toutes ? (
          <Badge variant="primary" data-testid="org-selection-toutes">
            Toutes les organisations
          </Badge>
        ) : (
          <>
            {selected.map((id) => {
              const o = byId.get(id);
              const label = o ? orgLabel(o) : id;
              return (
                <Badge key={id} variant="primary" dot={false}>
                  {label}
                  <button
                    type="button"
                    aria-label={`Retirer ${label}`}
                    onClick={() => toggle(id)}
                    className="ml-1 inline-flex text-savr-primary-700 hover:text-savr-primary-900"
                  >
                    <X aria-hidden className="h-3.5 w-3.5" />
                  </button>
                </Badge>
              );
            })}
            <button
              type="button"
              data-testid="org-option-toutes"
              onClick={() => onChange([])}
              className="ml-1 text-xs font-medium text-savr-primary-700 hover:text-savr-primary-900"
            >
              Toutes les organisations
            </button>
          </>
        )}
      </div>

      {/* Recherche transverse (tous types). */}
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-savr-neutral-400"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher une organisation…"
          data-testid="org-search"
          aria-label="Rechercher une organisation"
          className="min-h-11 w-full rounded-savr-md border border-savr-neutral-200 bg-savr-white pl-9 pr-3 text-sm text-savr-neutral-900 placeholder:text-savr-neutral-400 focus:border-savr-primary-500 focus:outline-none focus:ring-2 focus:ring-savr-primary-500/30"
        />
      </div>

      {/* Cellules par type SUR UNE LIGNE — chacune une liste déroulante. */}
      {toutes && (
        <p className="text-xs text-savr-neutral-500">
          Toutes les organisations — ouvrez un type pour restreindre le
          périmètre.
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {groups.map(({ type, label, items }) => {
          const open = openType === type;
          const nbSel = items.filter((o) => selectedSet.has(o.id)).length;
          return (
            <div key={type} className="relative">
              <button
                type="button"
                data-testid={`org-section-${type}`}
                aria-expanded={open}
                onClick={() => setOpenType(open ? null : type)}
                className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-savr-md border px-3 text-left transition-colors ${
                  open || nbSel > 0
                    ? 'border-savr-primary-300 bg-savr-primary-50'
                    : 'border-savr-neutral-200 bg-savr-white hover:bg-savr-neutral-50'
                }`}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-semibold text-savr-neutral-800">
                    {label}
                  </span>
                  <span className="text-[11px] text-savr-neutral-500">
                    {nbSel > 0
                      ? `${nbSel} / ${items.length} sélectionné${nbSel > 1 ? 's' : ''}`
                      : `${items.length} organisation${items.length > 1 ? 's' : ''}`}
                  </span>
                </span>
                <ChevronDown
                  aria-hidden
                  className={`h-4 w-4 shrink-0 text-savr-neutral-400 transition-transform ${
                    open ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {open && (
                <ul
                  role="listbox"
                  aria-label={label}
                  aria-multiselectable="true"
                  className="absolute left-0 right-0 top-full z-20 mt-1 max-h-44 divide-y divide-savr-neutral-100 overflow-y-auto rounded-savr-md border border-savr-neutral-200 bg-savr-white shadow-savr-md"
                >
                  {items.map((o) => (
                    <li key={o.id}>
                      <label className="flex min-h-11 cursor-pointer items-center gap-2.5 px-3 text-sm text-savr-neutral-800 hover:bg-savr-neutral-50">
                        <input
                          type="checkbox"
                          checked={selectedSet.has(o.id)}
                          onChange={() => toggle(o.id)}
                          data-testid={`org-option-${o.id}`}
                          className="h-4 w-4 shrink-0 accent-savr-primary-600"
                        />
                        <span className="flex-1 truncate">{orgLabel(o)}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
        {groups.length === 0 && (
          <p className="px-1 py-2 text-sm text-savr-neutral-500 sm:col-span-3">
            Aucune organisation trouvée.
          </p>
        )}
      </div>
    </div>
  );
}
