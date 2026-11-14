'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Sidebar } from '@/components/layout/sidebar';
import { TopBar } from '@/components/layout/top-bar';
import { BottomNav } from '@/components/layout/bottom-nav';
import { LogoZdProvider } from '@/components/layout/logo-context';
import { IdentiteProvider } from '@/components/layout/logo-organisation';
import { BarreTitreProvider } from '@/components/layout/barre-titre-context';
import type { NavRole } from '@/lib/roles';
import type { IdentiteSession } from '@/lib/identite-session';

interface AppShellProps {
  role: NavRole;
  /** Organisation et utilisateur, en bas de la barre latérale. */
  identite?: IdentiteSession | null;
  onLogout?: () => void;
  /** Compteurs par href (calculé côté serveur, ex : { '/admin/alertes': 3 }). */
  navBadges?: Record<string, number>;
  children: React.ReactNode;
  className?: string;
}

const AppShell = ({
  role,
  identite,
  onLogout,
  navBadges,
  children,
  className,
}: AppShellProps) => {
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = React.useState(false);
  // Emplacement du titre de page dans la barre du haut (cf. PageHero).
  const [barreTitre, setBarreTitre] = React.useState<HTMLElement | null>(null);

  return (
    <IdentiteProvider value={identite ?? null}>
      <LogoZdProvider>
        {/* `data-cadre-app` : repère de globals.css, qui ajuste la hauteur
            du cadre quand le bandeau d'impersonation est affiché au-dessus. */}
        <div
          data-cadre-app
          className={cn(
            // Fond navy de la barre latérale : la barre bleu ciel du haut s'en
            // détache par un coin arrondi (Val 2026-11-03).
            // Téléphone : hauteur de l'écran réellement visible (`dvh`). Avec
            // `h-screen`, le cadre dépasse de la hauteur des barres du
            // navigateur et la page défile derrière lui.
            'flex h-screen overflow-hidden bg-savr-primary-700 max-sm:h-dvh',
            className,
          )}
        >
          {/* Sidebar desktop (≥ 1024px) */}
          <div className="hidden lg:flex lg:shrink-0">
            <Sidebar
              role={role}
              collapsed={sidebarCollapsed}
              onToggle={() => setSidebarCollapsed((v) => !v)}
              onLogout={onLogout}
              identite={identite}
              navBadges={navBadges}
            />
          </div>

          {/* Overlay mobile */}
          {mobileSidebarOpen && (
            <div
              className="fixed inset-0 z-30 bg-savr-neutral-900/50 lg:hidden"
              onClick={() => setMobileSidebarOpen(false)}
              aria-hidden="true"
            />
          )}

          {/* Sidebar mobile (overlay slide) */}
          <div
            className={cn(
              'fixed inset-y-0 left-0 z-40 lg:hidden transition-transform duration-savr-base ease-out',
              mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full',
            )}
          >
            <Sidebar
              role={role}
              onLogout={onLogout}
              identite={identite}
              navBadges={navBadges}
            />
          </div>

          {/* Contenu principal */}
          <BarreTitreProvider value={barreTitre}>
            <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
              <TopBar
                role={role}
                onMenuToggle={() => setMobileSidebarOpen((v) => !v)}
                emplacementTitreRef={setBarreTitre}
              />

              {/* `relative` : point d'ancrage des éléments en position absolue
                du contenu (dont les textes `sr-only`). Sans lui, ils se placent
                par rapport à la page, dépassent sous l'écran et font défiler la
                page entière derrière le cadre : une bande vide reste en bas. */}
              <main
                className="relative flex-1 overflow-y-auto bg-savr-neutral-50 p-6 pt-4 pb-20 max-sm:px-4 lg:pb-6"
                id="main-content"
                tabIndex={-1}
              >
                {children}
              </main>

              {/* Bottom nav mobile */}
              <BottomNav role={role} />
            </div>
          </BarreTitreProvider>
        </div>
      </LogoZdProvider>
    </IdentiteProvider>
  );
};

export { AppShell };
