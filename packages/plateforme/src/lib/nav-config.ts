import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard,
  Building2,
  MapPin,
  CalendarDays,
  Truck,
  FileText,
  Settings,
  BarChart3,
  PlusCircle,
  ClipboardList,
  Heart,
  Receipt,
  Activity,
  Package,
} from 'lucide-react';

export type Role =
  | 'admin_savr'
  | 'traiteur_manager'
  | 'traiteur_commercial'
  | 'agence'
  | 'gestionnaire_lieux'
  | 'client_organisateur';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: string;
}

export interface NavGroup {
  title?: string;
  items: NavItem[];
}

export const NAV_CONFIG: Record<Role, NavGroup[]> = {
  admin_savr: [
    {
      items: [
        { label: 'Dashboard Admin', href: '/admin', icon: LayoutDashboard },
        {
          label: 'Dashboard Client',
          href: '/admin/dashboard-client',
          icon: BarChart3,
        },
        { label: 'Collectes', href: '/admin/collectes', icon: Truck },
        { label: 'Facturation', href: '/admin/factures', icon: Receipt },
        { label: 'Associations', href: '/admin/associations', icon: Heart },
        { label: 'Transporteurs', href: '/admin/transporteurs', icon: Truck },
        { label: 'Lieux', href: '/admin/lieux', icon: MapPin },
        { label: 'Clients', href: '/admin/clients', icon: Building2 },
        { label: 'Paramètres', href: '/admin/settings/users', icon: Settings },
        {
          label: 'Santé système',
          href: '/admin/sante-systeme',
          icon: Activity,
        },
      ],
    },
  ],

  // §06.04 §1 — nav traiteur = 4 entrées V1 (refonte 2026-05-05) :
  // Dashboard / Collectes / Mon organisation / Mon profil.
  // Identique manager et commercial (le contrôle d'accès intra-page masque
  // l'édition + la sous-section Équipe au commercial — révision 2026-05-29).
  traiteur_manager: [
    {
      items: [
        { label: 'Dashboard', href: '/traiteur', icon: LayoutDashboard },
        { label: 'Collectes', href: '/traiteur/collectes', icon: Truck },
        {
          label: 'Mon organisation',
          href: '/traiteur/mon-organisation',
          icon: Building2,
        },
        { label: 'Mon profil', href: '/traiteur/mon-profil', icon: Settings },
      ],
    },
  ],

  traiteur_commercial: [
    {
      items: [
        { label: 'Dashboard', href: '/traiteur', icon: LayoutDashboard },
        { label: 'Collectes', href: '/traiteur/collectes', icon: Truck },
        {
          label: 'Mon organisation',
          href: '/traiteur/mon-organisation',
          icon: Building2,
        },
        { label: 'Mon profil', href: '/traiteur/mon-profil', icon: Settings },
      ],
    },
  ],

  agence: [
    {
      items: [
        { label: 'Dashboard', href: '/agence', icon: LayoutDashboard },
        {
          label: 'Programmer une collecte',
          href: '/programmer/nouveau',
          icon: PlusCircle,
        },
        { label: 'Mes brouillons', href: '/brouillons', icon: ClipboardList },
        { label: 'Collectes', href: '/agence/collectes', icon: Truck },
        { label: 'Lieux', href: '/agence/lieux', icon: MapPin },
        { label: 'Reporting', href: '/agence/reporting', icon: BarChart3 },
      ],
    },
  ],

  // §06.05 §Navigation — 7 sections (refonte sobriété 2026-05-30).
  // "Mon pack AG" affiché conditionnellement côté layout si packs_antgaspi existe.
  gestionnaire_lieux: [
    {
      items: [
        { label: 'Dashboard', href: '/gestionnaire', icon: LayoutDashboard },
        {
          label: 'Événements',
          href: '/gestionnaire/evenements',
          icon: CalendarDays,
        },
        { label: 'Mes lieux', href: '/gestionnaire/lieux', icon: MapPin },
        { label: 'Traiteurs', href: '/gestionnaire/traiteurs', icon: Truck },
        {
          label: 'Mon pack AG',
          href: '/gestionnaire/mon-pack-ag',
          icon: Package,
        },
        {
          label: 'Mon organisation',
          href: '/gestionnaire/mon-organisation',
          icon: Building2,
        },
        {
          label: 'Paramètres',
          href: '/gestionnaire/parametres',
          icon: Settings,
        },
      ],
    },
  ],

  client_organisateur: [
    {
      items: [
        { label: 'Mes événements', href: '/organisateur', icon: CalendarDays },
        {
          label: 'Collectes',
          href: '/organisateur/collectes',
          icon: ClipboardList,
        },
        { label: 'Documents', href: '/organisateur/documents', icon: FileText },
      ],
    },
  ],
};

export function getNavItems(role: Role): NavItem[] {
  return NAV_CONFIG[role]?.flatMap((g) => g.items) ?? [];
}
