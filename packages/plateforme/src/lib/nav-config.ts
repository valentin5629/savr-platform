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

  traiteur_manager: [
    {
      items: [
        { label: 'Dashboard', href: '/traiteur', icon: LayoutDashboard },
        {
          label: 'Événements',
          href: '/traiteur/evenements',
          icon: CalendarDays,
        },
        { label: 'Collectes', href: '/traiteur/collectes', icon: Truck },
        { label: 'Lieux', href: '/traiteur/lieux', icon: MapPin },
        { label: 'Documents', href: '/traiteur/documents', icon: FileText },
        { label: 'Reporting', href: '/traiteur/reporting', icon: BarChart3 },
      ],
    },
  ],

  traiteur_commercial: [
    {
      items: [
        {
          label: 'Programmation',
          href: '/traiteur/collectes/nouvelle',
          icon: PlusCircle,
        },
        { label: 'Mes collectes', href: '/traiteur/collectes', icon: Truck },
        {
          label: 'Événements',
          href: '/traiteur/evenements',
          icon: CalendarDays,
        },
        { label: 'Documents', href: '/traiteur/documents', icon: FileText },
      ],
    },
  ],

  agence: [
    {
      items: [
        { label: 'Dashboard', href: '/agence', icon: LayoutDashboard },
        { label: 'Collectes', href: '/agence/collectes', icon: Truck },
        { label: 'Lieux', href: '/agence/lieux', icon: MapPin },
        { label: 'Reporting', href: '/agence/reporting', icon: BarChart3 },
      ],
    },
  ],

  gestionnaire_lieux: [
    {
      items: [
        { label: 'Mes lieux', href: '/lieux', icon: MapPin },
        { label: 'Collectes', href: '/lieux/collectes', icon: Truck },
        { label: 'Documents', href: '/lieux/documents', icon: FileText },
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
