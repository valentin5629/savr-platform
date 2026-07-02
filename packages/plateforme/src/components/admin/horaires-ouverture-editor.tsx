'use client';

import * as React from 'react';
import { Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Horaires d'ouverture (format simplifié) — CDC §5 Associations « Horaires d'ouverture »
// : tableau 7 lignes (lundi → dimanche), case Ouvert + créneaux (début/fin), + un
// bouton « + » par ligne pour un second créneau (ex. pause déjeuner). Stocké en JSON
// dans `associations.horaires_ouverture`.

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

export function horairesParDefaut(): JourHoraire[] {
  return JOURS.map((jour) => ({
    jour,
    ouvert: false,
    creneaux: [{ debut: '09:00', fin: '18:00' }],
  }));
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
    const next = jours.map((j, i) => (i === index ? { ...j, ...patch } : j));
    onChange(next);
  }

  function updateCreneau(
    jourIndex: number,
    creneauIndex: number,
    patch: Partial<Creneau>,
  ) {
    const jour = jours[jourIndex];
    if (!jour) return;
    const creneaux = jour.creneaux.map((c, i) =>
      i === creneauIndex ? { ...c, ...patch } : c,
    );
    updateJour(jourIndex, { creneaux });
  }

  function ajouterCreneau(jourIndex: number) {
    const jour = jours[jourIndex];
    if (!jour) return;
    updateJour(jourIndex, {
      creneaux: [...jour.creneaux, { debut: '09:00', fin: '18:00' }],
    });
  }

  function retirerCreneau(jourIndex: number, creneauIndex: number) {
    const jour = jours[jourIndex];
    if (!jour) return;
    updateJour(jourIndex, {
      creneaux: jour.creneaux.filter((_, i) => i !== creneauIndex),
    });
  }

  return (
    <div className="space-y-2" data-testid="horaires-ouverture-editor">
      {jours.map((jour, jourIndex) => (
        <div
          key={jour.jour}
          className="flex flex-wrap items-start gap-3 rounded-savr-md border border-savr-neutral-200 p-3"
        >
          <label className="flex w-32 shrink-0 items-center gap-2 pt-1.5 text-sm font-medium text-savr-neutral-700">
            <input
              type="checkbox"
              checked={jour.ouvert}
              onChange={(e) =>
                updateJour(jourIndex, { ouvert: e.target.checked })
              }
              className="h-4 w-4 rounded border-savr-neutral-300 text-savr-primary-700 focus:outline-2 focus:outline-savr-primary-500"
            />
            {JOUR_LABEL[jour.jour]}
          </label>

          <div
            className={cn(
              'flex flex-1 flex-col gap-2',
              !jour.ouvert && 'opacity-40 pointer-events-none',
            )}
          >
            {jour.creneaux.map((creneau, creneauIndex) => (
              <div key={creneauIndex} className="flex items-center gap-2">
                <Label
                  htmlFor={`${jour.jour}-debut-${creneauIndex}`}
                  className="sr-only"
                >
                  Début
                </Label>
                <Input
                  id={`${jour.jour}-debut-${creneauIndex}`}
                  type="time"
                  value={creneau.debut}
                  onChange={(e) =>
                    updateCreneau(jourIndex, creneauIndex, {
                      debut: e.target.value,
                    })
                  }
                  className="w-28"
                />
                <span className="text-savr-neutral-400">—</span>
                <Input
                  type="time"
                  value={creneau.fin}
                  onChange={(e) =>
                    updateCreneau(jourIndex, creneauIndex, {
                      fin: e.target.value,
                    })
                  }
                  className="w-28"
                />
                {jour.creneaux.length > 1 && (
                  <button
                    type="button"
                    aria-label="Retirer ce créneau"
                    onClick={() => retirerCreneau(jourIndex, creneauIndex)}
                    className="text-savr-neutral-400 hover:text-savr-error"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => ajouterCreneau(jourIndex)}
              className="flex w-fit items-center gap-1 text-xs font-medium text-savr-primary-700 hover:underline"
            >
              <Plus className="h-3.5 w-3.5" />
              Ajouter un créneau
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
