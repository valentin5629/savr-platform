import * as React from 'react';
import { type Icone } from '@/components/ui/icones';
import { Badge } from '@/components/ui/badge';
import { TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

// Grand en-tête des fiches variante B (décision Val 2026-10-27, DS §5.11) :
// fiches collecte (client et Admin), fiches Admin transporteur, lieu,
// association. À placer dans une `FicheModal taille="grand"`, dans un `<Tabs>`
// quand la fiche a des onglets (ils vivent dans l'en-tête : seul le corps
// défile).
//
//   sur-titre (badge, référence…)                         ← réserve la croix
//   Titre en Archivo                                     [pastille de statut]
//   sous-titre
//   repères à pictos (FicheRepere)
//   onglets soulignés (FicheOnglets)
export function FicheGrandEnTete({
  surtitre,
  titre,
  sousTitre,
  description,
  statut,
  reperes,
  reperesTestId,
  onglets,
}: {
  surtitre?: React.ReactNode;
  titre: string;
  sousTitre?: React.ReactNode;
  /** Consigne courte (création). */
  description?: string;
  /** Pastille de statut, à droite du titre. */
  statut?: React.ReactNode;
  /** Repères à pictos (FicheRepere). */
  reperes?: React.ReactNode;
  reperesTestId?: string;
  /** Barre d'onglets (FicheOnglets). */
  onglets?: React.ReactNode;
}) {
  return (
    <header className="flex shrink-0 flex-col gap-4 px-5 pt-5 sm:px-6 sm:pt-6 md:gap-3.5 md:px-12 md:pt-6">
      {surtitre && (
        <div className="flex min-w-0 flex-wrap items-center gap-3 pr-12 md:pr-16">
          {surtitre}
        </div>
      )}
      <div
        className={cn(
          'flex flex-wrap items-end justify-between gap-x-12 gap-y-3',
          // Sans sur-titre, la ligne du titre réserve la place de la croix.
          !surtitre && 'pr-12 md:pr-16',
        )}
      >
        <div className="flex min-w-0 flex-col gap-1.5">
          <h3 className="font-display text-2xl font-semibold leading-[1.1] tracking-[-0.03em] text-savr-primary-900 md:text-4xl">
            {titre}
          </h3>
          {sousTitre && (
            <p className="text-[15px] text-savr-neutral-600">{sousTitre}</p>
          )}
          {description && (
            <p className="text-[15px] text-savr-neutral-700">{description}</p>
          )}
        </div>
        {statut}
      </div>
      {reperes && (
        <p
          data-testid={reperesTestId}
          className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm text-savr-neutral-700 sm:flex sm:flex-wrap sm:items-center sm:gap-x-7"
        >
          {reperes}
        </p>
      )}
      {onglets}
      {/* Sans onglets, un filet sépare l'en-tête du corps. */}
      {!onglets && (
        <div aria-hidden="true" className="border-b border-savr-sable-200" />
      )}
    </header>
  );
}

// Repère à picto de l'en-tête (date, ville, véhicule…).
export function FicheRepere({
  icon: Icon,
  children,
}: {
  icon: Icone;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <Icon className="h-4 w-4 text-savr-neutral-400" aria-hidden="true" />
      {children}
    </span>
  );
}

// Barre d'onglets soulignés du grand en-tête.
// `mobile` : `pastilles` (3 onglets courts, côte à côte sur fond sable —
// fiche collecte client, B4) ou `defilement` (onglets soulignés qui défilent
// horizontalement — fiches Admin, libellés longs ou 4 onglets).
type MobileOnglets = 'pastilles' | 'defilement';
const MobileOngletsContext = React.createContext<MobileOnglets>('defilement');

export function FicheOnglets({
  mobile = 'defilement',
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsList> & {
  mobile?: MobileOnglets;
}) {
  return (
    <MobileOngletsContext.Provider value={mobile}>
      <TabsList
        className={cn(
          'w-full',
          mobile === 'pastilles'
            ? 'grid grid-cols-3 gap-1 border-0 bg-savr-sable-100 p-1 max-sm:rounded-savr-full sm:flex sm:gap-6 sm:border-b sm:border-savr-sable-200 sm:bg-transparent sm:p-0 md:gap-9'
            : 'flex gap-6 overflow-x-auto border-b border-savr-sable-200 bg-transparent p-0 [scrollbar-width:none] md:gap-9',
          className,
        )}
        {...props}
      />
    </MobileOngletsContext.Provider>
  );
}

const ONGLET_SOULIGNE =
  'gap-2 px-0 data-[state=active]:border-savr-primary-900 data-[state=active]:text-savr-primary-900';
// Téléphone (B4) : pastilles côte à côte, l'onglet actif sur fond blanc ;
// soulignés à partir de 640 px.
const ONGLET_PASTILLE =
  'justify-center gap-2 border-b-0 px-0 data-[state=active]:bg-savr-white data-[state=active]:text-savr-primary-900 data-[state=active]:shadow-savr-sm max-sm:rounded-savr-full sm:justify-start sm:border-b-2 sm:data-[state=active]:border-savr-primary-900 sm:data-[state=active]:bg-transparent sm:data-[state=active]:shadow-savr-none';

// Onglet du grand en-tête. `nbErreurs` (fiches Admin) : nombre de champs de
// l'onglet qui bloquent l'enregistrement — pastille rouge et nom accessible
// « … (N champs à corriger) » ; `ref` sert à y poser le focus à l'échec.
export const FicheOnglet = React.forwardRef<
  React.ElementRef<typeof TabsTrigger>,
  React.ComponentPropsWithoutRef<typeof TabsTrigger> & { nbErreurs?: number }
>(({ className, nbErreurs = 0, children, ...props }, ref) => {
  const mobile = React.useContext(MobileOngletsContext);
  return (
    <TabsTrigger
      ref={ref}
      className={cn(
        mobile === 'pastilles' ? ONGLET_PASTILLE : ONGLET_SOULIGNE,
        className,
      )}
      {...props}
    >
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
});
FicheOnglet.displayName = 'FicheOnglet';
