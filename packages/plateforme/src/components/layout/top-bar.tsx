'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import { ListIcon, TruckIcon } from '@/components/ui/icones';
import { IconButton } from '@/components/ui/icon-button';
import {
  LogoOrganisation,
  useIdentiteSession,
} from '@/components/layout/logo-organisation';
import { ROUTES, ROLES_PROGRAMMATION } from '@/lib/routes';
import type { NavRole } from '@/lib/roles';

// Sur une liste Collectes filtrée par type, le formulaire s'ouvre avec ce type
// proposé (§06.04 « bouton contextuel par sélecteur de type »).
function hrefProgrammer(pathname: string | null, type: string | null): string {
  const surListe = pathname?.endsWith('/collectes') ?? false;
  return surListe && (type === 'zero_dechet' || type === 'anti_gaspi')
    ? `${ROUTES.programmer.nouveau}?type=${type}`
    : ROUTES.programmer.nouveau;
}

// Bouton blanc à pastille orange (Val 2026-11-03) : au survol, le fond passe
// à l'orange et la pastille au blanc. Le camion reste marine (sur la pastille
// orange, un camion orange ne se verrait pas). Sur téléphone, la pastille seule
// laisse la place au titre de la page, dans une cible tactile de 44 px.
function BoutonProgrammer({ href }: { href: string }) {
  return (
    <Link
      href={href}
      aria-label="Programmer une collecte"
      className="group inline-flex h-9 shrink-0 items-center gap-2 rounded-savr-md border border-savr-primary-200 bg-savr-white p-1 text-sm font-medium whitespace-nowrap text-savr-primary-800 shadow-savr-sm transition-[background-color,border-color,box-shadow,transform] duration-savr-fast ease-out hover:-translate-y-px hover:border-savr-accent-500 hover:bg-savr-accent-500 hover:text-savr-primary-950 hover:shadow-savr-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-savr-primary-500 max-sm:h-11 max-sm:w-11 max-sm:justify-center sm:pr-4"
    >
      <span
        aria-hidden="true"
        className="flex h-7 w-7 items-center justify-center rounded-savr-sm bg-savr-accent-500 transition-colors duration-savr-fast group-hover:bg-savr-white"
      >
        <TruckIcon className="h-4 w-4 text-savr-primary-800" />
      </span>
      <span className="hidden sm:inline">Programmer une collecte</span>
    </Link>
  );
}

// `useSearchParams` sous Suspense : sans lui, une page pré-rendue ferait
// échouer le build. Pendant l'attente, le lien sans type.
function BoutonProgrammerContextuel({ pathname }: { pathname: string | null }) {
  const params = useSearchParams();
  return (
    <BoutonProgrammer href={hrefProgrammer(pathname, params.get('type'))} />
  );
}

interface TopBarProps {
  role: NavRole;
  onMenuToggle?: () => void;
  /** Reçoit l'élément où `PageHero` place le titre de la page. */
  emplacementTitreRef?: React.Ref<HTMLDivElement>;
  className?: string;
}

// Barre bleu ciel en haut de l'écran (Val 2026-11-03) : le titre de la page à
// gauche (placé par PageHero), « Programmer une collecte » puis le logo de
// l'organisation à droite, sur la ligne du logo Savr. Sur téléphone, le bouton
// qui ouvre la barre latérale précède le titre.
const TopBar = React.forwardRef<HTMLElement, TopBarProps>(
  ({ role, onMenuToggle, emplacementTitreRef, className }, ref) => {
    const pathname = usePathname();
    const identite = useIdentiteSession();
    // Organisation illisible : pas de tuile (jamais les initiales de l'email).
    const logo =
      identite?.logoAffichable && identite.organisation ? identite : null;
    const peutProgrammer = (ROLES_PROGRAMMATION as readonly string[]).includes(
      role,
    );
    // Pas de bouton sur le formulaire lui-même.
    const surFormulaire = pathname?.startsWith(ROUTES.programmer.nouveau);
    return (
      <header
        ref={ref}
        data-testid="barre-haut"
        className={cn(
          // h-16 : même hauteur que le bloc du logo Savr de la barre latérale.
          'flex h-16 shrink-0 items-center gap-4 border-b border-savr-primary-200 bg-savr-primary-100 px-4 lg:rounded-tl-savr-md lg:px-6',
          className,
        )}
      >
        {onMenuToggle && (
          <IconButton
            size="sm"
            onClick={onMenuToggle}
            aria-label="Ouvrir le menu"
            className="text-savr-primary-800 hover:bg-savr-primary-200 max-sm:h-11 max-sm:w-11 lg:hidden"
          >
            <ListIcon aria-hidden="true" />
          </IconButton>
        )}
        <div
          ref={emplacementTitreRef}
          data-testid="barre-titre"
          className="flex min-w-0 items-center"
        />
        <div className="ml-auto flex shrink-0 items-center gap-4">
          {peutProgrammer && !surFormulaire && (
            <React.Suspense
              fallback={<BoutonProgrammer href={ROUTES.programmer.nouveau} />}
            >
              <BoutonProgrammerContextuel pathname={pathname} />
            </React.Suspense>
          )}
          {logo && <LogoOrganisation identite={logo} />}
        </div>
      </header>
    );
  },
);
TopBar.displayName = 'TopBar';

export { TopBar };
