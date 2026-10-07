'use client';

import * as React from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Search, User, PlusCircle, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Text } from '@/components/ui/text';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingState } from '@/components/ui/loading-state';
import { Input } from '@/components/ui/input';
import { ChampDeclencheur } from '@/components/ui/combobox';
import { Button } from '@/components/ui/button';
import { useDebounce } from '@/lib/hooks/use-debounce';

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

  // Recherche serveur après une pause de saisie (R-UI-7, J5) ; une réponse
  // arrivée après une saisie plus récente est ignorée.
  const recherche = useDebounce(query);
  React.useEffect(() => {
    if (!open) return;
    let actif = true;
    setLoading(true);
    const params = new URLSearchParams({ q: recherche });
    if (organisationId) params.set('organisation_id', organisationId);
    void fetch(`/api/v1/programmation/contacts?${params}`)
      .then((r) => r.json() as Promise<ContactOption[]>)
      .then((o) => {
        if (actif) setOptions(o);
      })
      .finally(() => {
        if (actif) setLoading(false);
      });
    return () => {
      actif = false;
    };
  }, [recherche, open, organisationId]);

  const displayLabel = value
    ? `${value.prenom} ${value.nom} — ${value.telephone}`
    : null;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <ChampDeclencheur
          disabled={disabled}
          open={open}
          className={cn('justify-between', className)}
        >
          <span className="flex items-center gap-2 min-w-0">
            <User className="h-4 w-4 text-savr-neutral-400 shrink-0" />
            {displayLabel ? (
              <span className="truncate">{displayLabel}</span>
            ) : (
              <span className="text-savr-neutral-400">{label}</span>
            )}
          </span>
        </ChampDeclencheur>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          className="z-50 w-[var(--radix-popover-trigger-width)] rounded-savr-md border border-savr-neutral-200 bg-savr-white shadow-savr-md"
          sideOffset={4}
        >
          <div className="flex items-center border-b border-savr-neutral-100 px-3">
            <Search className="h-4 w-4 text-savr-neutral-400 shrink-0 mr-2" />
            {/* Champ du DS, sans bordure propre : la ligne porte la sienne
                (R-UI-4b, D7 : avant, <input> brut). */}
            <Input
              autoFocus
              className="flex-1 border-0 px-0"
              placeholder="Prénom, nom ou téléphone…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <ul role="listbox" className="max-h-52 overflow-y-auto py-1">
            {loading && (
              <li className="px-3 py-2">
                <LoadingState className="text-savr-neutral-400" />
              </li>
            )}
            {!loading && options.length === 0 && (
              <li className="px-3 py-2">
                <EmptyState
                  size="inline"
                  title="Aucun contact trouvé"
                  className="text-savr-neutral-400"
                />
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
                  <Text as="span" variant="hint">
                    {c.telephone}
                    {c.fonction ? ` · ${c.fonction}` : ''}
                  </Text>
                </span>
              </li>
            ))}
          </ul>

          <div className="border-t border-savr-neutral-100 p-1">
            <Button
              variant="ghost"
              className="w-full justify-start px-3 font-normal"
              onClick={() => {
                setOpen(false);
                onAddInline();
              }}
            >
              <PlusCircle className="h-4 w-4" />
              Ajouter un nouveau contact
            </Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
