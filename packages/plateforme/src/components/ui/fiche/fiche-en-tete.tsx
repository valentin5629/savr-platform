import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Text } from '@/components/ui/text';

// En-tête des fiches en pop-up (R-UI-5, G3 — ex-`collecte/fiche-blocs`) : fiches
// Admin transporteur, lieu, association (décision Val 2026-09-30 « grand
// en-tête partout ») et fiches collecte (Admin et client, décision Val
// 2026-10-01) : sur-titre (puce + mention), nom en grand, ligne d'infos à
// pictos, statut à droite du sur-titre. Il décrit l'objet ENREGISTRÉ (stable
// pendant la saisie). À placer dans une FicheModal (titre accessible = celui de
// la modale). pr-14 réserve la croix de fermeture.
export function FicheEnTete({
  surtitre,
  titre,
  description,
  infos = [],
  infosTestId,
  statut,
  statutLarge = false,
}: {
  surtitre?: React.ReactNode;
  titre: string;
  /** Consigne courte (création). */
  description?: string;
  infos?: { icon: LucideIcon; texte: React.ReactNode }[];
  infosTestId?: string;
  statut?: React.ReactNode;
  /** Statut large (frise des fiches collecte) : à droite du sur-titre sur
   *  grand écran seulement, sous les infos en dessous. */
  statutLarge?: boolean;
}) {
  return (
    <header className="shrink-0 border-b border-savr-neutral-200 px-6 pb-5 pr-14 pt-6 md:px-8 md:pr-16">
      {/* Le statut occupe la droite de la première ligne (celle du sur-titre,
          ou du titre s'il n'y a pas de sur-titre) ; titre et infos gardent
          toute la largeur — une frise ne les écrase pas. Sous le point de
          bascule : une seule colonne, statut en dernier (ordre du DOM). */}
      <div
        className={cn(
          'grid items-center gap-x-6 gap-y-1.5',
          statutLarge
            ? 'lg:grid-cols-[minmax(0,1fr)_auto]'
            : 'sm:grid-cols-[minmax(0,1fr)_auto]',
        )}
      >
        {surtitre && (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {surtitre}
          </div>
        )}
        <h3
          className={cn(
            'text-2xl font-extrabold leading-tight tracking-[-0.02em] text-savr-neutral-900',
            (surtitre || !statut) && 'col-span-full',
          )}
        >
          {titre}
        </h3>
        {description && (
          <p className="col-span-full text-[15px] text-savr-neutral-700">
            {description}
          </p>
        )}
        {infos.length > 0 && (
          <p
            data-testid={infosTestId}
            className="col-span-full flex flex-wrap items-center gap-x-4 gap-y-1 text-[15px] text-savr-neutral-700"
          >
            {infos.map(({ icon: Icon, texte }, i) => (
              <span key={i} className="inline-flex items-center gap-1.5">
                <Icon className="h-4 w-4" aria-hidden="true" />
                {texte}
              </span>
            ))}
          </p>
        )}
        {statut && (
          <div
            className={cn(
              'mt-1.5 min-w-0',
              !surtitre && 'self-start',
              statutLarge
                ? 'lg:col-start-2 lg:row-start-1 lg:mt-0 lg:justify-self-end'
                : 'sm:col-start-2 sm:row-start-1 sm:mt-0 sm:justify-self-end',
            )}
          >
            {statut}
          </div>
        )}
      </div>
    </header>
  );
}

// Puce du sur-titre (type de TMS, région…).
export function EnTetePuce({
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      {...props}
      className="rounded-savr-sm bg-savr-primary-50 px-2 py-0.5 text-xs font-bold uppercase tracking-[0.04em] text-savr-primary-700"
    >
      {children}
    </span>
  );
}

// Mention discrète du sur-titre (SIREN, gestionnaire…).
export function EnTeteMention({ children }: { children: React.ReactNode }) {
  return <Text as="span">{children}</Text>;
}
