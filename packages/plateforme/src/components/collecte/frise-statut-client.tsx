import {
  friseStatutClient,
  type EtapeFriseClient,
} from '@/lib/statut-collecte-labels';
import { cn } from '@/lib/utils';

// Frise de statut discrète des pop-ups collecte, en haut à droite du grand
// en-tête : étape courante pleine opacité + gras, les autres estompées. Même
// rendu pour la frise client et la frise Admin (décision Val 2026-10-01) ;
// seules changent les étapes.
export function FriseEtapes({
  etapes,
  label,
  testId,
}: {
  etapes: EtapeFriseClient[];
  label: string;
  testId?: string;
}) {
  return (
    <ol
      aria-label={label}
      data-testid={testId}
      className="flex shrink-0 flex-wrap items-center gap-2"
    >
      {etapes.map((e, i) => {
        const courante = e.etat === 'courante';
        const passee = e.etat === 'passee';
        return (
          <li
            key={e.label}
            aria-current={courante ? 'step' : undefined}
            className="flex items-center gap-2"
          >
            {i > 0 && (
              <span
                aria-hidden="true"
                className={cn(
                  'h-px w-5 lg:w-8',
                  passee || courante
                    ? 'bg-savr-primary-300'
                    : 'bg-savr-neutral-200',
                )}
              />
            )}
            <span
              className={cn(
                'flex items-center gap-1.5 whitespace-nowrap',
                courante
                  ? 'text-[13px] font-extrabold text-savr-primary-700'
                  : 'text-xs font-semibold',
                passee && 'text-savr-primary-700 opacity-50',
                e.etat === 'a_venir' && 'text-savr-neutral-500 opacity-60',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'rounded-savr-full',
                  courante
                    ? 'h-2.5 w-2.5 bg-savr-primary-700 ring-4 ring-savr-primary-100'
                    : 'h-2 w-2',
                  passee && 'bg-savr-primary-700',
                  e.etat === 'a_venir' && 'bg-savr-neutral-300',
                )}
              />
              {e.label}
              {passee && <span className="sr-only"> (étape passée)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// Frise de la fiche collecte CLIENT (§06.04 refonte pop-up, décision Val
// 2026-09-29, Q1) : vocabulaire client (Créée · Validée · En cours · Réalisée /
// Sans excédents / Annulée — jamais Programmée ni Clôturée). Distincte de la
// frise Admin (granularité complète).
export function FriseStatutClient({ statut }: { statut: string }) {
  return (
    <FriseEtapes
      etapes={friseStatutClient(statut)}
      label="Statut de la collecte"
      testId="frise-statut-client"
    />
  );
}
