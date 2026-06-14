'use client';

import * as React from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Search, User, PlusCircle, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ContactOption {
  id: string;
  prenom: string;
  nom: string;
  telephone: string;
  email?: string | null;
  fonction?: string | null;
}

interface ContactComboboxProps {
  value: ContactOption | null;
  onChange: (contact: ContactOption | null) => void;
  onAddInline: () => void;
  label?: string;
  organisationId?: string;
  className?: string;
  disabled?: boolean;
}

export function ContactCombobox({
  value,
  onChange,
  onAddInline,
  label = 'Rechercher un contact…',
  organisationId,
  className,
  disabled,
}: ContactComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [options, setOptions] = React.useState<ContactOption[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setLoading(true);
    const params = new URLSearchParams({ q: query });
    if (organisationId) params.set('organisation_id', organisationId);
    void fetch(`/api/v1/programmation/contacts?${params}`)
      .then((r) => r.json() as Promise<ContactOption[]>)
      .then(setOptions)
      .finally(() => setLoading(false));
  }, [query, open, organisationId]);

  const displayLabel = value
    ? `${value.prenom} ${value.nom} — ${value.telephone}`
    : null;

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
            <User className="h-4 w-4 text-savr-neutral-400 shrink-0" />
            {displayLabel ? (
              <span className="truncate">{displayLabel}</span>
            ) : (
              <span className="text-savr-neutral-400">{label}</span>
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
              placeholder="Prénom, nom ou téléphone…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <ul role="listbox" className="max-h-52 overflow-y-auto py-1">
            {loading && (
              <li className="px-3 py-2 text-sm text-savr-neutral-400">
                Chargement…
              </li>
            )}
            {!loading && options.length === 0 && (
              <li className="px-3 py-2 text-sm text-savr-neutral-400">
                Aucun contact trouvé
              </li>
            )}
            {options.map((c) => (
              <li
                key={c.id}
                role="option"
                aria-selected={value?.id === c.id}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-savr-neutral-50',
                  value?.id === c.id && 'bg-savr-primary-50',
                )}
                onClick={() => {
                  onChange(c);
                  setOpen(false);
                  setQuery('');
                }}
              >
                <Check
                  className={cn(
                    'h-4 w-4 shrink-0',
                    value?.id === c.id
                      ? 'text-savr-primary-700'
                      : 'text-transparent',
                  )}
                />
                <span className="min-w-0">
                  <span className="font-medium block">
                    {c.prenom} {c.nom}
                  </span>
                  <span className="text-xs text-savr-neutral-500">
                    {c.telephone}
                    {c.fonction ? ` · ${c.fonction}` : ''}
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
                onAddInline();
              }}
            >
              <PlusCircle className="h-4 w-4" />
              Ajouter un nouveau contact
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
