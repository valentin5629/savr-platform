import { Check } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { statutCollecteDisplay } from '@/lib/statut-collecte-labels';
import { cn } from '@/lib/utils';

// Parcours nominal d'une collecte (machine à états §05, CLAUDE.md §3) :
// programmee → validee → en_cours → realisee → cloturee.
const ETAPES = [
  { statut: 'programmee', label: 'Programmée' },
  { statut: 'validee', label: 'Validée' },
  { statut: 'en_cours', label: 'En cours' },
  { statut: 'realisee', label: 'Réalisée' },
  { statut: 'cloturee', label: 'Clôturée' },
] as const;

// Statuts qui sortent du parcours : la frise reste affichée (repère) mais aucune
// étape n'est marquée, et le statut réel est porté par un badge d'erreur.
const HORS_PARCOURS = [
  'annulation_demandee',
  'annulee',
  'rejetee_par_prestataire',
];

function indexEtape(statut: string): number {
  // AG « réalisée sans collecte » : même rang que « Réalisée » (étape terminale
  // de la réalisation), libellé propre ci-dessous.
  if (statut === 'realisee_sans_collecte') return 3;
  return ETAPES.findIndex((e) => e.statut === statut);
}

// Frise d'avancement de la fiche collecte Admin (revue E2E 2026-09-29, décision
// Val C2) : remplace le badge de statut seul en tête de la pop-up.
export function CollecteStatutFrise({ statut }: { statut: string }) {
  const horsParcours = HORS_PARCOURS.includes(statut);
  const courant = horsParcours ? -1 : indexEtape(statut);
  // Statut hors frise (annulé, rejeté, brouillon « Créée ») : badge explicite.
  const badge = courant === -1 ? statutCollecteDisplay(statut, 'admin') : null;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <ol
        aria-label="Avancement de la collecte"
        className={cn(
          'flex min-w-0 flex-1 items-start',
          horsParcours && 'opacity-60',
        )}
      >
        {ETAPES.map((etape, i) => {
          const faite = i < courant;
          const active = i === courant;
          const label =
            active && statut === 'realisee_sans_collecte'
              ? statutCollecteDisplay(statut, 'admin').label
              : etape.label;
          return (
            <li
              key={etape.statut}
              aria-current={active ? 'step' : undefined}
              className="relative flex flex-1 flex-col items-center"
            >
              {i > 0 && (
                <span
                  aria-hidden
                  className={cn(
                    'absolute right-1/2 top-3 h-0.5 w-full -translate-y-1/2',
                    faite || active
                      ? 'bg-savr-primary-600'
                      : 'bg-savr-neutral-200',
                  )}
                />
              )}
              <span
                aria-hidden
                className={cn(
                  'relative z-10 flex h-6 w-6 items-center justify-center rounded-full border-2',
                  faite &&
                    'border-savr-primary-600 bg-savr-primary-600 text-white',
                  active && 'border-savr-primary-600 bg-white',
                  !faite && !active && 'border-savr-neutral-300 bg-white',
                )}
              >
                {faite && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                {active && (
                  <span className="h-2.5 w-2.5 rounded-full bg-savr-primary-600" />
                )}
              </span>
              <span
                className={cn(
                  'mt-1.5 text-center text-xs',
                  active && 'font-semibold text-savr-neutral-900',
                  faite && 'text-savr-neutral-700',
                  !faite && !active && 'text-savr-neutral-400',
                )}
              >
                {label}
              </span>
            </li>
          );
        })}
      </ol>
      {badge && <Badge variant={badge.variant}>{badge.label}</Badge>}
    </div>
  );
}
