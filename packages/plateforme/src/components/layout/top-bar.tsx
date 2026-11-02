'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import { ListIcon, TruckIcon } from '@/components/ui/icones';
import { IconButton } from '@/components/ui/icon-button';
import { Button } from '@/components/ui/button';
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

function BoutonProgrammer({ href }: { href: string }) {
  return (
    <Button variant="accent" asChild className="h-10">
      <Link href={href}>
        <TruckIcon />
        Programmer une collecte
      </Link>
    </Button>
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
  className?: string;
}

// Barre navy en haut de l'écran (Val 2026-11-02), d'un seul tenant avec la
// barre latérale : « Programmer une collecte » puis le logo de l'organisation,
// à droite, sur la ligne du logo Savr. Ils ne sont plus dans le bandeau des
// pages. Sur téléphone, le bouton qui ouvre la barre latérale est à gauche.
const TopBar = React.forwardRef<HTMLElement, TopBarProps>(
  ({ role, onMenuToggle, className }, ref) => {
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
          'flex h-14 shrink-0 items-center gap-4 bg-savr-primary-800 px-4 lg:px-6',
          className,
        )}
      >
        {onMenuToggle && (
          <IconButton
            size="sm"
            onClick={onMenuToggle}
            aria-label="Ouvrir le menu"
            className="text-savr-white hover:bg-savr-primary-700 lg:hidden"
          >
            <ListIcon aria-hidden="true" />
          </IconButton>
        )}
        <div className="ml-auto flex items-center gap-4">
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
