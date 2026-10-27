import { cn } from '@/lib/utils';
import { friseStatutClient } from '@/lib/statut-collecte-labels';

// Statut de la fiche collecte CLIENT : une pastille à droite du titre, qui
// remplace la frise en quatre étapes (variante B, décision Val 2026-10-27).
// Vocabulaire client inchangé (Créée · Validée · En cours · Réalisée / Annulée,
// jamais Programmée ni Clôturée ; une collecte AG sans excédent se lit
// « Réalisée », décision Val 2026-10-09) : l'étape courante de la frise client.
const TONS = [
  'bg-savr-sable-100 text-savr-neutral-700',
  'bg-savr-primary-50 text-savr-primary-700',
  'bg-savr-accent-50 text-savr-accent-800',
  'bg-savr-success-subtle text-savr-success-strong',
] as const;
const POINTS = [
  'bg-savr-neutral-400',
  'bg-savr-primary-700',
  'bg-savr-accent-500',
  'bg-savr-success',
] as const;

export function StatutCollecteClient({ statut }: { statut: string }) {
  const etapes = friseStatutClient(statut);
  const rang = Math.max(
    0,
    etapes.findIndex((e) => e.etat === 'courante'),
  );
  const libelle = etapes[rang]?.label ?? '';
  const annulee = etapes.length === 2;
  return (
    <span
      data-testid="frise-statut-client"
      aria-label={`Statut de la collecte : ${libelle}`}
      className={cn(
        'inline-flex h-9 shrink-0 items-center gap-2.5 rounded-savr-full px-4 text-sm font-semibold',
        annulee
          ? 'bg-savr-error-subtle text-savr-error-strong'
          : TONS[Math.min(rang, TONS.length - 1)],
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'h-2 w-2 rounded-savr-full',
          annulee ? 'bg-savr-error' : POINTS[Math.min(rang, POINTS.length - 1)],
        )}
      />
      {libelle}
    </span>
  );
}
