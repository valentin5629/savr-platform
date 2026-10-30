import { Badge } from '@/components/ui/badge';

// Rangée de badges d'une cellule de tableau, sur une seule ligne (hauteur de
// ligne constante, décision Val 2026-10-30) : les deux premiers libellés
// sont affichés, les suivants regroupés dans une pastille « +N » qui les
// liste au survol et aux lecteurs d'écran. Rien n'est caché sans signe.
const MAX = 2;

function BadgesLigne({
  libelles,
  dot,
}: {
  libelles: string[];
  /** Point de couleur des badges (défaut du Badge si absent). */
  dot?: boolean;
}) {
  const visibles = libelles.slice(0, MAX);
  const reste = libelles.slice(MAX);
  return (
    <div className="flex items-center gap-1" title={libelles.join(', ')}>
      {visibles.map((l) => (
        <Badge key={l} variant="neutral" dot={dot}>
          {l}
        </Badge>
      ))}
      {reste.length > 0 && (
        <Badge variant="neutral" dot={false} data-testid="badges-ligne-reste">
          +{reste.length}
          <span className="sr-only"> : {reste.join(', ')}</span>
        </Badge>
      )}
    </div>
  );
}

export { BadgesLigne };
