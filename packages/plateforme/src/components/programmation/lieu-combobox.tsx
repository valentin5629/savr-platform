'use client';

import * as React from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Search, MapPin, PlusCircle, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Text } from '@/components/ui/text';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingState } from '@/components/ui/loading-state';
import { Input } from '@/components/ui/input';
import { ChampDeclencheur } from '@/components/ui/combobox';
import { Button } from '@/components/ui/button';
import { useDebounce } from '@/lib/hooks/use-debounce';

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

  // Recherche serveur après une pause de saisie (R-UI-7, J5) ; une réponse
  // arrivée après une saisie plus récente est ignorée.
  const recherche = useDebounce(query);
  React.useEffect(() => {
    if (!open) return;
    let actif = true;
    setLoading(true);
    const params = new URLSearchParams({ q: recherche });
    if (organisationId) params.set('organisation_id', organisationId);
    void fetch(`/api/v1/programmation/lieux?${params}`)
      .then((r) => r.json() as Promise<LieuOption[]>)
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

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <ChampDeclencheur
          disabled={disabled}
          open={open}
          className={cn('justify-between', className)}
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
              placeholder="Nom, adresse, ville…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <ul role="listbox" className="max-h-60 overflow-y-auto py-1">
            {loading && (
              <li className="px-3 py-2">
                <LoadingState className="text-savr-neutral-400" />
              </li>
            )}
            {!loading && options.length === 0 && (
              <li className="px-3 py-2">
                <EmptyState
                  size="inline"
                  title="Aucun lieu trouvé"
                  className="text-savr-neutral-400"
                />
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
                  <Text as="span" variant="hint">
                    {l.adresse_acces}, {l.code_postal} {l.ville}
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
                onAddManuel();
              }}
            >
              <PlusCircle className="h-4 w-4" />
              Ajouter ce lieu manuellement
            </Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
