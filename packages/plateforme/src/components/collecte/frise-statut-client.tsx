import { FriseEtapes } from '@/components/collecte/frise-etapes';
import { friseStatutClient } from '@/lib/statut-collecte-labels';

// Frise de statut discrète de la fiche collecte CLIENT (§06.04 refonte pop-up,
// décision Val 2026-09-29, Q1) : en haut à droite de l'en-tête, vocabulaire
// client (Créée · Validée · En cours · Réalisée / Sans excédents / Annulée —
// jamais Programmée ni Clôturée). Distincte de la frise Admin (granularité
// complète), au même rendu.
export function FriseStatutClient({ statut }: { statut: string }) {
  return (
    <FriseEtapes
      etapes={friseStatutClient(statut)}
      label="Statut de la collecte"
      testId="frise-statut-client"
    />
  );
}
