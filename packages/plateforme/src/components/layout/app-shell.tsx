'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Sidebar } from '@/components/layout/sidebar';
import { TopBar } from '@/components/layout/top-bar';
import { BottomNav } from '@/components/layout/bottom-nav';
import { LogoZdProvider } from '@/components/layout/logo-context';
import { type Role } from '@/lib/nav-config';

interface AppShellProps {
  role: Role;
  userName?: string;
  pageTitle?: string;
  onLogout?: () => void;
  /** hrefs de nav à masquer (calculé côté serveur, ex : « Mon pack AG » §06.05 l.71). */
  hiddenNavHrefs?: string[];
  /** Compteurs par href (calculé côté serveur, ex : { '/admin/alertes': 3 }). */
  navBadges?: Record<string, number>;
  children: React.ReactNode;
  className?: string;
}

const AppShell = ({
  role,
  userName,
  pageTitle,
  onLogout,
  hiddenNavHrefs,
  navBadges,
  children,
  className,
}: AppShellProps) => {
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = React.useState(false);

  return (
    <LogoZdProvider>
      <div
        className={cn(
          'flex h-screen overflow-hidden bg-savr-neutral-50',
          className,
        )}
      >
        {/* Sidebar desktop (≥ 1024px) */}
        <div className="hidden lg:flex lg:shrink-0">
          <Sidebar
            role={role}
            collapsed={sidebarCollapsed}
            onToggle={() => setSidebarCollapsed((v) => !v)}
            hiddenNavHrefs={hiddenNavHrefs}
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
            'fixed inset-y-0 left-0 z-40 lg:hidden transition-transform duration-[200ms] ease-out',
            mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <Sidebar
            role={role}
            hiddenNavHrefs={hiddenNavHrefs}
            navBadges={navBadges}
          />
        </div>

        {/* Contenu principal */}
        <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
          <TopBar
            title={pageTitle}
            userName={userName}
            onMenuToggle={() => setMobileSidebarOpen((v) => !v)}
            onLogout={onLogout}
          />

          <main
            className="flex-1 overflow-y-auto p-6 pb-20 lg:pb-6"
            id="main-content"
            tabIndex={-1}
          >
            {children}
          </main>

          {/* Bottom nav mobile */}
          <BottomNav role={role} hiddenNavHrefs={hiddenNavHrefs} />
        </div>
      </div>
    </LogoZdProvider>
  );
};

export { AppShell };
