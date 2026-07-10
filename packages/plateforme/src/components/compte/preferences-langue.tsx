import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Bloc « Préférences » — langue de l'interface (BL-P3-08).
 *
 * V1 = français figé : CDC §06.04 l.711 « Langue de l'interface (FR uniquement V1) »
 * et §06.05 l.474 (le bloc Préférences gestionnaire ne porte plus que la langue).
 * Multi-langues = V1.1 (CLAUDE.md §3) → affichage lecture seule, aucune persistance,
 * aucune colonne `users.langue`. Composant partagé traiteur + gestionnaire.
 */
export function PreferencesLangueCard() {
  return (
    <Card data-testid="preferences-langue">
      <CardHeader>
        <CardTitle>Préférences</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div>
          <span className="text-savr-neutral-500">
            Langue de l’interface :{' '}
          </span>
          Français (FR)
        </div>
        <p className="text-xs text-savr-neutral-400">
          La gestion des notifications email par type d’événement sera
          disponible ultérieurement.
        </p>
      </CardContent>
    </Card>
  );
}
