import { TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';

// Onglet horizontal des fiches Admin (transporteur, lieu, association) portant
// le nombre de ses champs qui bloquent l'enregistrement (R-UI-5, G3 — ex-
// `collecte/fiche-blocs`) : pastille rouge + nom accessible « … (N champs à
// corriger) ». `ref` sert à y poser le focus à l'échec.
export function OngletAvecErreurs({
  value,
  nbErreurs,
  children,
  ref,
}: {
  value: string;
  nbErreurs: number;
  children: React.ReactNode;
  ref?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <TabsTrigger ref={ref} value={value} className="gap-2 px-3 sm:px-4">
      {children}
      {nbErreurs > 0 && (
        <>
          <Badge variant="count" aria-hidden="true">
            {nbErreurs}
          </Badge>
          <span className="sr-only">
            {nbErreurs > 1
              ? ` (${nbErreurs} champs à corriger)`
              : ' (1 champ à corriger)'}
          </span>
        </>
      )}
    </TabsTrigger>
  );
}
