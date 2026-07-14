'use client';

import * as React from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Search, MapPin, PlusCircle, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface LieuOption {
  id: string;
  nom: string;
  adresse_acces: string;
  ville: string;
  code_postal: string;
  controle_acces_requis_default: boolean;
  // Champs lieu éditables au formulaire (PROG-01) — pré-remplis depuis le référentiel,
  // renvoyés par GET /programmation/lieux. Nullables (facultatifs / lieu manuel).
  acces_details?: string | null;
  acces_office?: string | null;
  stationnement?: string | null;
  type_vehicule_max?: string | null;
  contraintes_horaires?: string | null;
  flux_autorises?: string[] | null;
}

interface LieuComboboxProps {
  value: LieuOption | null;
  onChange: (lieu: LieuOption | null) => void;
  onAddManuel: () => void;
  // Admin support : org cible dont on liste les lieux (param honoré staff-only côté route).
  organisationId?: string;
  className?: string;
  disabled?: boolean;
}

export function LieuCombobox({
  value,
  onChange,
  onAddManuel,
  organisationId,
  className,
  disabled,
}: LieuComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [options, setOptions] = React.useState<LieuOption[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setLoading(true);
    const params = new URLSearchParams({ q: query });
    if (organisationId) params.set('organisation_id', organisationId);
    void fetch(`/api/v1/programmation/lieux?${params}`)
      .then((r) => r.json() as Promise<LieuOption[]>)
      .then(setOptions)
      .finally(() => setLoading(false));
  }, [query, open, organisationId]);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={cn(
            'flex w-full items-center justify-between rounded-savr-md border border-savr-neutral-300 bg-savr-white px-3 py-2 text-sm text-left',
            'hover:border-savr-primary-400 focus:outline-2 focus:outline-savr-primary-500',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            className,
          )}
        >
          <span className="flex items-center gap-2 min-w-0">
            <MapPin className="h-4 w-4 text-savr-neutral-400 shrink-0" />
            {value ? (
              <span className="truncate">
                {value.nom} — {value.ville}
              </span>
            ) : (
              <span className="text-savr-neutral-400">Rechercher un lieu…</span>
            )}
          </span>
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          className="z-50 w-[var(--radix-popover-trigger-width)] rounded-savr-md border border-savr-neutral-200 bg-savr-white shadow-lg"
          sideOffset={4}
        >
          <div className="flex items-center border-b border-savr-neutral-100 px-3">
            <Search className="h-4 w-4 text-savr-neutral-400 shrink-0 mr-2" />
            <input
              autoFocus
              className="flex-1 py-2 text-sm outline-none placeholder:text-savr-neutral-400"
              placeholder="Nom, adresse, ville…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <ul role="listbox" className="max-h-60 overflow-y-auto py-1">
            {loading && (
              <li className="px-3 py-2 text-sm text-savr-neutral-400">
                Chargement…
              </li>
            )}
            {!loading && options.length === 0 && (
              <li className="px-3 py-2 text-sm text-savr-neutral-400">
                Aucun lieu trouvé
              </li>
            )}
            {options.map((l) => (
              <li
                key={l.id}
                role="option"
                aria-selected={value?.id === l.id}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-savr-neutral-50',
                  value?.id === l.id && 'bg-savr-primary-50',
                )}
                onClick={() => {
                  onChange(l);
                  setOpen(false);
                  setQuery('');
                }}
              >
                <Check
                  className={cn(
                    'h-4 w-4 shrink-0',
                    value?.id === l.id
                      ? 'text-savr-primary-700'
                      : 'text-transparent',
                  )}
                />
                <span className="min-w-0">
                  <span className="font-medium block truncate">{l.nom}</span>
                  <span className="text-xs text-savr-neutral-500">
                    {l.adresse_acces}, {l.code_postal} {l.ville}
                  </span>
                </span>
              </li>
            ))}
          </ul>

          <div className="border-t border-savr-neutral-100 p-1">
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-savr-md px-3 py-2 text-sm text-savr-primary-700 hover:bg-savr-primary-50"
              onClick={() => {
                setOpen(false);
                onAddManuel();
              }}
            >
              <PlusCircle className="h-4 w-4" />
              Ajouter ce lieu manuellement
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
