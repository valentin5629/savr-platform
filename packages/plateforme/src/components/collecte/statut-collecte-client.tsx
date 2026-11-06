import { friseStatutClient } from '@/lib/statut-collecte-labels';
import {
  FichePastille,
  type TonPastille,
} from '@/components/ui/fiche/fiche-pastille';

// Statut de la fiche collecte CLIENT : une pastille à droite du titre, qui
// remplace la frise en quatre étapes (variante B, décision Val 2026-10-27).
// Vocabulaire client inchangé (Créée · Validée · En cours · Réalisée / Annulée,
// jamais Programmée ni Clôturée ; une collecte AG sans excédent se lit
// « Réalisée », décision Val 2026-10-09) : l'étape courante de la frise client.
const TONS: readonly TonPastille[] = ['sable', 'bleu', 'orange', 'vert'];

export function StatutCollecteClient({ statut }: { statut: string }) {
  const etapes = friseStatutClient(statut);
  const rang = Math.max(
    0,
    etapes.findIndex((e) => e.etat === 'courante'),
  );
  const libelle = etapes[rang]?.label ?? '';
  const annulee = etapes.length === 2;
  return (
    <FichePastille
      ton={
        annulee ? 'rouge' : (TONS[Math.min(rang, TONS.length - 1)] ?? 'sable')
      }
      data-testid="frise-statut-client"
      aria-label={`Statut de la collecte : ${libelle}`}
    >
      {libelle}
    </FichePastille>
  );
}
