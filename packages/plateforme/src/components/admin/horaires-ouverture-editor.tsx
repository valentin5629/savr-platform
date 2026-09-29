'use client';

import * as React from 'react';
import { Copy, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { IconButton } from '@/components/ui/icon-button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { TimePicker } from '@/components/ui/time-picker';

// Horaires d'ouverture (format simplifié) — CDC §5 Associations « Horaires d'ouverture »
// : 7 lignes (lundi → dimanche), présentation « heures hebdomadaires » (décision Val
// 2026-09-29) : jour fermé = « Indisponible » + bouton « + » ; jour ouvert = un ou
// plusieurs créneaux début – fin, chacun retirable (retirer le dernier ferme le jour),
// « + » pour un créneau supplémentaire (ex. pause déjeuner) et « copier » vers d'autres
// jours. Stocké en JSON dans `associations.horaires_ouverture` (format inchangé).

export interface Creneau {
  debut: string;
  fin: string;
}

export interface JourHoraire {
  jour: string;
  ouvert: boolean;
  creneaux: Creneau[];
}

const JOURS = [
  'lundi',
  'mardi',
  'mercredi',
  'jeudi',
  'vendredi',
  'samedi',
  'dimanche',
] as const;

const JOUR_LABEL: Record<string, string> = {
  lundi: 'Lundi',
  mardi: 'Mardi',
  mercredi: 'Mercredi',
  jeudi: 'Jeudi',
  vendredi: 'Vendredi',
  samedi: 'Samedi',
  dimanche: 'Dimanche',
};

const CRENEAU_DEFAUT: Creneau = { debut: '09:00', fin: '18:00' };

export function horairesParDefaut(): JourHoraire[] {
  return JOURS.map((jour) => ({
    jour,
    ouvert: false,
    creneaux: [{ ...CRENEAU_DEFAUT }],
  }));
}

// Créneau suivant : démarre à la fin du dernier, pour 1 h ; défaut 09:00-18:00
// si le dernier finit trop tard (ou passe minuit) pour en caser un autre.
export function creneauSuivant(dernier: Creneau | undefined): Creneau {
  if (!dernier || dernier.fin <= dernier.debut) return { ...CRENEAU_DEFAUT };
  const [h, m] = dernier.fin.split(':').map(Number);
  if (
    h === undefined ||
    m === undefined ||
    Number.isNaN(h) ||
    Number.isNaN(m) ||
    h >= 23
  ) {
    return { ...CRENEAU_DEFAUT };
  }
  const fin = `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return { debut: dernier.fin, fin };
}

interface HorairesOuvertureEditorProps {
  value: JourHoraire[];
  onChange: (value: JourHoraire[]) => void;
}

export function HorairesOuvertureEditor({
  value,
  onChange,
}: HorairesOuvertureEditorProps) {
  const jours = value.length > 0 ? value : horairesParDefaut();

  function updateJour(index: number, patch: Partial<JourHoraire>) {
    onChange(jours.map((j, i) => (i === index ? { ...j, ...patch } : j)));
  }

  function updateCreneau(
    jourIndex: number,
    creneauIndex: number,
    patch: Partial<Creneau>,
  ) {
    const jour = jours[jourIndex];
    if (!jour) return;
    updateJour(jourIndex, {
      creneaux: jour.creneaux.map((c, i) =>
        i === creneauIndex ? { ...c, ...patch } : c,
      ),
    });
  }

  function ouvrirJour(jourIndex: number) {
    const jour = jours[jourIndex];
    if (!jour) return;
    updateJour(jourIndex, {
      ouvert: true,
      creneaux:
        jour.creneaux.length > 0 ? jour.creneaux : [{ ...CRENEAU_DEFAUT }],
    });
  }

  function ajouterCreneau(jourIndex: number) {
    const jour = jours[jourIndex];
    if (!jour) return;
    updateJour(jourIndex, {
      creneaux: [...jour.creneaux, creneauSuivant(jour.creneaux.at(-1))],
    });
  }

  function retirerCreneau(jourIndex: number, creneauIndex: number) {
    const jour = jours[jourIndex];
    if (!jour) return;
    const creneaux = jour.creneaux.filter((_, i) => i !== creneauIndex);
    // Retirer le dernier créneau ferme le jour (« Indisponible »).
    updateJour(
      jourIndex,
      creneaux.length > 0
        ? { creneaux }
        : { ouvert: false, creneaux: [{ ...CRENEAU_DEFAUT }] },
    );
  }

  function copierVers(sourceIndex: number, cibles: string[]) {
    const source = jours[sourceIndex];
    if (!source) return;
    onChange(
      jours.map((j) =>
        cibles.includes(j.jour)
          ? {
              ...j,
              ouvert: true,
              creneaux: source.creneaux.map((c) => ({ ...c })),
            }
          : j,
      ),
    );
  }

  return (
    <div className="space-y-1" data-testid="horaires-ouverture-editor">
      {jours.map((jour, jourIndex) => {
        const label = JOUR_LABEL[jour.jour] ?? jour.jour;
        const jourMin = label.toLowerCase();
        return (
          <div
            key={jour.jour}
            className="flex items-start gap-3 py-1.5"
            data-testid={`horaires-${jour.jour}`}
          >
            <span
              className="mt-1 inline-flex h-9 w-12 shrink-0 items-center justify-center rounded-full bg-savr-primary-700 text-xs font-semibold text-savr-white"
              title={label}
            >
              <span aria-hidden="true">{label.slice(0, 3)}</span>
              <span className="sr-only">{label}</span>
            </span>

            {/* Ouvert sans créneau (donnée importée) = traité comme fermé. */}
            {!jour.ouvert || jour.creneaux.length === 0 ? (
              <div className="flex items-center gap-1">
                <span className="text-sm text-savr-neutral-500">
                  Indisponible
                </span>
                <IconButton
                  aria-label={`Ajouter des horaires le ${jourMin}`}
                  onClick={() => ouvrirJour(jourIndex)}
                >
                  <Plus />
                </IconButton>
              </div>
            ) : (
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                {jour.creneaux.map((creneau, creneauIndex) => (
                  <div
                    key={creneauIndex}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <TimePicker
                      value={creneau.debut}
                      onChange={(debut) =>
                        updateCreneau(jourIndex, creneauIndex, { debut })
                      }
                      aria-label={`${label} — début du créneau ${creneauIndex + 1}`}
                      className="w-32"
                    />
                    <span className="text-savr-neutral-400" aria-hidden="true">
                      –
                    </span>
                    <TimePicker
                      value={creneau.fin}
                      onChange={(fin) =>
                        updateCreneau(jourIndex, creneauIndex, { fin })
                      }
                      aria-label={`${label} — fin du créneau ${creneauIndex + 1}`}
                      className="w-32"
                    />
                    <IconButton
                      variant="destructive"
                      aria-label={`Retirer le créneau ${creneauIndex + 1} du ${jourMin}`}
                      onClick={() => retirerCreneau(jourIndex, creneauIndex)}
                    >
                      <X />
                    </IconButton>
                    {creneauIndex === 0 && (
                      <>
                        <IconButton
                          aria-label={`Ajouter un créneau le ${jourMin}`}
                          onClick={() => ajouterCreneau(jourIndex)}
                        >
                          <Plus />
                        </IconButton>
                        <CopierHoraires
                          source={jour.jour}
                          onApply={(cibles) => copierVers(jourIndex, cibles)}
                        />
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CopierHoraires({
  source,
  onApply,
}: {
  source: string;
  onApply: (cibles: string[]) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [cibles, setCibles] = React.useState<string[]>([]);
  const jourMin = (JOUR_LABEL[source] ?? source).toLowerCase();

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setCibles([]);
      }}
    >
      <PopoverTrigger asChild>
        <IconButton aria-label={`Copier les horaires du ${jourMin}`}>
          <Copy />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent className="w-56">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-savr-neutral-500">
          Copier vers
        </p>
        <div className="flex flex-col">
          {JOURS.filter((j) => j !== source).map((j) => {
            const id = `copier-${source}-${j}`;
            return (
              <label
                key={j}
                htmlFor={id}
                className="flex h-10 cursor-pointer items-center justify-between rounded-savr-md px-2 text-sm text-savr-neutral-700 hover:bg-savr-neutral-100"
              >
                {JOUR_LABEL[j]}
                <Checkbox
                  id={id}
                  checked={cibles.includes(j)}
                  onCheckedChange={(c) =>
                    setCibles((prev) =>
                      c === true ? [...prev, j] : prev.filter((x) => x !== j),
                    )
                  }
                />
              </label>
            );
          })}
        </div>
        <Button
          type="button"
          className="mt-3 w-full"
          disabled={cibles.length === 0}
          onClick={() => {
            onApply(cibles);
            setOpen(false);
            setCibles([]);
          }}
        >
          Appliquer
        </Button>
      </PopoverContent>
    </Popover>
  );
}
