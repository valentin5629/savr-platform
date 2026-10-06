import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Heading } from '@/components/ui/heading';

// SectionHeader — en-tête de section des fiches et modales (R-UI-5, F4 ; ex-
// `BlocHeader` de `collecte/fiche-blocs`, recopié dans `clients/[id]`, et en-tête
// du `Bloc` recopié dans les modales association / organisation). DS §10
// leviers #2 (pastille primary pleine) + #7 (titre extrabold tracking serré) :
// pastille icône `primary-50`, titre `neutral-900`, slot d'action optionnel à
// droite.
//
// `level` : h2 (défaut, fiches) ou h3 (section dans une modale dont le titre
// est le h2). `truncate` (défaut : oui) coupe le titre sur une ligne ; les
// sections de formulaire (SectionCard) laissent le titre passer à la ligne.
export interface SectionHeaderProps {
  icon: LucideIcon;
  title: string;
  /** Action alignée à droite (bouton « Ajouter », lien…). */
  action?: React.ReactNode;
  level?: 2 | 3;
  truncate?: boolean;
  className?: string;
}

export function SectionHeader({
  icon: Icon,
  title,
  action,
  level = 2,
  truncate = true,
  className,
}: SectionHeaderProps) {
  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-savr-md bg-savr-primary-50 text-savr-primary-700">
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <Heading
          level={level}
          size="base"
          weight="extrabold"
          className={cn(truncate && 'truncate', 'tracking-[-0.01em]')}
        >
          {title}
        </Heading>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

// SectionCard — section thématique d'un formulaire en modale (ex-`Bloc` des
// modales association et organisation) : carte bordée (levier §10 #5) +
// SectionHeader h3, champs espacés de 16 px. Regroupe visuellement les champs
// par thème (au lieu d'un simple libellé).
export function SectionCard({
  icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-savr-md border border-savr-neutral-200 bg-savr-white p-4 sm:p-5">
      <SectionHeader
        icon={icon}
        title={title}
        level={3}
        truncate={false}
        className="mb-4"
      />
      <div className="space-y-4">{children}</div>
    </section>
  );
}
