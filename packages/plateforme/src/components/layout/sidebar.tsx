'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { NAV_CONFIG, hrefNavActif } from '@/lib/nav-config';
import type { NavRole } from '@/lib/roles';
import { useLogoZd, isZdSectionPath } from '@/components/layout/logo-context';
import { SavrLogoMark } from '@/components/layout/savr-logo';
import {
  CaretLeftIcon,
  CaretRightIcon,
  CaretUpDownIcon,
  GearIcon,
  SignOutIcon,
} from '@/components/ui/icones';
import {
  Dropdown,
  DropdownTrigger,
  DropdownContent,
  DropdownItem,
  DropdownSeparator,
} from '@/components/ui/dropdown';
import { Badge } from '@/components/ui/badge';
import { IconButton } from '@/components/ui/icon-button';
import { Button } from '@/components/ui/button';
import { createBrowserSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { ROUTES } from '@/lib/routes';
import { initiales } from '@/components/dashboards/charts/cockpit/fmt';
import type { IdentiteSession } from '@/lib/identite-session';

interface SidebarProps {
  role: NavRole;
  collapsed?: boolean;
  onToggle?: () => void;
  /** Utilisateur et son poste, à gauche du picto « Se déconnecter ». */
  identite?: IdentiteSession | null;
  /**
   * Handler de déconnexion. Par défaut (non fourni) : `signOut()` côté client
   * puis redirection dure vers `/login` (les layouts, Server Components, ne
   * peuvent pas passer de handler).
   */
  onLogout?: () => void;
  /** hrefs à masquer (ex : « Mon pack AG » si l'org n'a aucun pack). */
  hiddenNavHrefs?: string[];
  /** Compteurs par href (ex : { '/admin/alertes': 3 }) → pastille sur l'item. */
  navBadges?: Record<string, number>;
  className?: string;
}

const PARAMETRES_CLIENTS = new Set<string>([
  ROUTES.traiteur.parametres,
  ROUTES.agence.parametres,
  ROUTES.gestionnaire.parametres,
  ROUTES.organisateur.parametres,
]);

// Sidebar — bloc primaire plein primary-800 (levier #2)
// Item actif : fond primary-700 + barre accent-500 3px gauche
const Sidebar = React.forwardRef<HTMLElement, SidebarProps>(
  (
    {
      role,
      collapsed = false,
      onToggle,
      onLogout,
      identite,
      hiddenNavHrefs,
      navBadges,
      className,
    },
    ref,
  ) => {
    const pathname = usePathname();
    const [loggingOut, setLoggingOut] = React.useState(false);

    const handleLogout = React.useCallback(async () => {
      if (onLogout) {
        onLogout();
        return;
      }
      setLoggingOut(true);
      try {
        const supabase = createBrowserSupabaseClient();
        await supabase.auth.signOut();
      } catch {
        /* on redirige vers /login même si le signOut échoue */
      }
      window.location.href = ROUTES.login;
    }, [onLogout]);
    const { zdSelected } = useLogoZd();
    // Logo Savr : orange par défaut, vert dès qu'on est en contexte ZD — soit
    // par la navigation (section ZD-only), soit par une sélection ZD en cours
    // dans la page (ex : type de collecte ZD coché).
    const logoZd = zdSelected || isZdSectionPath(pathname);
    const hidden = new Set(hiddenNavHrefs ?? []);
    const hrefActif = hrefNavActif(role, pathname);
    const avecIdentite = !!identite?.utilisateur;
    // « Paramètres » des espaces clients (profil, organisation, membres) passe
    // dans le menu de l'utilisateur quand il est affiché. Celui de l'Admin
    // (réglages métier du back-office, §06.06) reste dans la barre.
    const hrefParametres = (NAV_CONFIG[role] ?? [])
      .flatMap((g) => g.items)
      .find((i) => PARAMETRES_CLIENTS.has(i.href))?.href;
    const parametresActif = !!hrefParametres && hrefActif === hrefParametres;
    if (avecIdentite && hrefParametres) hidden.add(hrefParametres);
    const groups = (NAV_CONFIG[role] ?? [])
      .map((g) => ({
        ...g,
        items: g.items.filter((i) => !hidden.has(i.href)),
      }))
      .filter((g) => g.items.length > 0);

    return (
      <nav
        ref={ref}
        aria-label="Navigation principale"
        className={cn(
          'flex h-full flex-col bg-savr-primary-800 transition-[width] duration-savr-base ease-out',
          // 204 px déplié (Val 2026-11-02 : −20 % sur les 256 px d'avant).
          collapsed ? 'w-16' : 'w-51',
          className,
        )}
      >
        {/* Logo / marque — asset officiel « + savr » teinté (orange par défaut,
            vert en contexte ZD), comme l'asset de marque monochrome */}
        <div
          data-testid="savr-logo"
          className={cn(
            // h-14 : même hauteur que la barre du haut, le logo est sur sa ligne.
            'flex h-14 shrink-0 items-center px-4 transition-colors duration-savr-base',
            collapsed && 'justify-center px-0',
            logoZd ? 'text-savr-success' : 'text-savr-accent-500',
          )}
        >
          {/* Clic sur le logo = retour au Dashboard du rôle, première entrée
              de son menu (Val 2026-10-30). */}
          <Link
            href={NAV_CONFIG[role]?.[0]?.items[0]?.href ?? '/'}
            aria-label="Aller au Dashboard"
            className="flex items-center rounded-savr-md"
          >
            <SavrLogoMark
              title="savr"
              variant={collapsed ? 'mark' : 'full'}
              className={collapsed ? 'h-7 w-7' : 'h-8 w-auto'}
            />
          </Link>
        </div>

        {/* Items de nav */}
        <div className="flex-1 overflow-y-auto py-4 space-y-1 px-2">
          {groups.map((group, gi) => (
            <div key={gi} className="space-y-0.5">
              {group.title && !collapsed && (
                <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-savr-primary-300">
                  {group.title}
                </p>
              )}
              {group.items.map((item) => {
                const isActive = item.href === hrefActif;
                const Icon = item.icon;
                const badgeCount = navBadges?.[item.href] ?? 0;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'group relative flex h-10 items-center gap-3 rounded-savr-md px-3 text-sm font-medium transition-colors duration-savr-fast',
                      isActive
                        ? 'bg-savr-primary-700 text-savr-white'
                        : 'text-savr-primary-200 hover:bg-savr-primary-700 hover:text-savr-white',
                      collapsed && 'justify-center px-0',
                    )}
                    title={collapsed ? item.label : undefined}
                  >
                    {/* Barre accent gauche sur item actif */}
                    {isActive && (
                      <span
                        className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-[3px] rounded-r-savr-full bg-savr-accent-500"
                        aria-hidden="true"
                      />
                    )}
                    <span className="relative shrink-0">
                      <Icon
                        className={cn(
                          'h-5 w-5',
                          isActive
                            ? 'text-savr-white'
                            : 'text-savr-primary-200 group-hover:text-savr-white',
                        )}
                        aria-hidden="true"
                      />
                      {/* Collapsé : point rouge (le compteur n'a pas la place). */}
                      {collapsed && badgeCount > 0 && (
                        <span
                          className="absolute -right-1 -top-1 h-2 w-2 rounded-savr-full bg-savr-error ring-2 ring-savr-primary-800"
                          aria-hidden="true"
                        />
                      )}
                    </span>
                    {!collapsed && <span>{item.label}</span>}
                    {!collapsed && badgeCount > 0 && (
                      <Badge
                        variant="count"
                        className="ml-auto"
                        aria-label={`${badgeCount} alerte${badgeCount > 1 ? 's' : ''} ouverte${badgeCount > 1 ? 's' : ''}`}
                      >
                        {badgeCount > 99 ? '99+' : badgeCount}
                      </Badge>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </div>

        {/* Toggle collapse */}
        {onToggle && (
          <div className="shrink-0 border-t border-savr-primary-700 p-2">
            <IconButton
              size="sm"
              onClick={onToggle}
              className="w-full text-savr-primary-300 hover:bg-savr-primary-700 hover:text-savr-white [&>svg]:h-4 [&>svg]:w-4"
              aria-label={
                collapsed ? 'Développer la navigation' : 'Réduire la navigation'
              }
            >
              {collapsed ? (
                <CaretRightIcon className="h-4 w-4" aria-hidden="true" />
              ) : (
                <CaretLeftIcon className="h-4 w-4" aria-hidden="true" />
              )}
            </IconButton>
          </div>
        )}
        {/* Pied du menu (Val 2026-11-02) : avatar, nom et poste forment un
            bouton qui ouvre un menu « Paramètres » / « Se déconnecter ». Le
            logo de l'organisation est dans le bandeau de page. Sans identité :
            bouton « Se déconnecter » avec libellé. */}
        <div className="shrink-0 border-t border-savr-primary-700 p-2">
          {avecIdentite ? (
            <Dropdown>
              <DropdownTrigger asChild>
                <Button
                  variant="ghost"
                  data-testid="menu-utilisateur"
                  aria-label={`Menu de ${identite.utilisateur}`}
                  title={[identite.utilisateur, identite.poste]
                    .filter(Boolean)
                    .join(' — ')}
                  aria-busy={loggingOut || undefined}
                  className={cn(
                    // Button ghost du DS, recalé sur le fond primary-800.
                    'relative h-auto min-h-11 w-full gap-2 text-left font-normal hover:bg-savr-primary-700 active:bg-savr-primary-700 data-[state=open]:bg-savr-primary-700 sm:h-auto',
                    collapsed
                      ? 'justify-center px-0'
                      : 'justify-start px-1 py-1',
                    // Page Paramètres ouverte : même marque que l'entrée active.
                    parametresActif && 'bg-savr-primary-700',
                  )}
                >
                  {parametresActif && (
                    <span
                      className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-savr-full bg-savr-accent-500"
                      aria-hidden="true"
                    />
                  )}
                  {/* Avatar aux initiales « Prénom Nom » (Val 2026-11-01). */}
                  <span
                    data-testid="avatar-utilisateur"
                    aria-hidden="true"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-savr-full bg-savr-primary-600 font-display text-sm font-semibold text-savr-white"
                  >
                    {initiales(identite.utilisateur)}
                  </span>
                  {!collapsed && (
                    <span
                      data-testid="identite-session"
                      className="min-w-0 flex-1"
                    >
                      <span className="block truncate text-sm font-semibold text-savr-white">
                        {identite.utilisateur}
                      </span>
                      {identite.poste && (
                        <span className="block truncate text-sm text-savr-primary-200">
                          {identite.poste}
                        </span>
                      )}
                    </span>
                  )}
                  {!collapsed && (
                    <CaretUpDownIcon
                      className="mr-1 h-4 w-4 shrink-0 text-savr-primary-300"
                      aria-hidden="true"
                    />
                  )}
                </Button>
              </DropdownTrigger>
              <DropdownContent
                side={collapsed ? 'right' : 'top'}
                align={collapsed ? 'end' : 'start'}
                className={cn(
                  'min-w-56',
                  !collapsed && 'w-[var(--radix-dropdown-menu-trigger-width)]',
                )}
              >
                {hrefParametres && (
                  <DropdownItem asChild className="min-h-11">
                    <Link
                      href={hrefParametres}
                      aria-current={parametresActif ? 'page' : undefined}
                    >
                      <GearIcon aria-hidden="true" />
                      Paramètres
                    </Link>
                  </DropdownItem>
                )}
                {hrefParametres && <DropdownSeparator />}
                <DropdownItem
                  className="min-h-11"
                  disabled={loggingOut}
                  onSelect={(e) => {
                    // Menu gardé ouvert : « Déconnexion… » reste visible.
                    e.preventDefault();
                    void handleLogout();
                  }}
                >
                  <SignOutIcon aria-hidden="true" />
                  {loggingOut ? 'Déconnexion…' : 'Se déconnecter'}
                </DropdownItem>
              </DropdownContent>
            </Dropdown>
          ) : (
            <Button
              variant="ghost"
              onClick={() => void handleLogout()}
              loading={loggingOut}
              loadingText={collapsed ? '' : <span>Déconnexion…</span>}
              aria-label="Se déconnecter"
              title={collapsed ? 'Se déconnecter' : undefined}
              className={cn(
                // Mêmes teintes que les entrées du menu (fond primary-800).
                'h-10 w-full justify-start gap-3 px-3 font-medium text-savr-primary-200 hover:bg-savr-primary-700 hover:text-savr-white active:bg-savr-primary-700 sm:h-10 [&>svg]:h-5 [&>svg]:w-5',
                collapsed && 'justify-center px-0',
              )}
            >
              <SignOutIcon aria-hidden="true" />
              {!collapsed && <span>Se déconnecter</span>}
            </Button>
          )}
        </div>
      </nav>
    );
  },
);
Sidebar.displayName = 'Sidebar';

export { Sidebar };
