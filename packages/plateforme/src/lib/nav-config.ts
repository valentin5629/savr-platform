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
  ClipboardList,
  Heart,
  Receipt,
  Activity,
  Package,
  Bell,
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
        {
          label: 'Dashboard Admin',
          href: '/admin/dashboard',
          icon: LayoutDashboard,
        },
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
        { label: 'Paramètres', href: '/admin/parametres', icon: Settings },
        { label: 'Alertes', href: '/admin/alertes', icon: Bell },
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

  // §06.11 Navigation — réplique stricte §06.04 §1 : 4 entrées V1.
  // Pas de Registre (non productrice, diff #5), pas de section Événements/Lieux/
  // Reporting dédiée (export RSE via Bloc 8 dashboard, pack AG via onglet AG).
  agence: [
    {
      items: [
        { label: 'Dashboard', href: '/agence', icon: LayoutDashboard },
        { label: 'Collectes', href: '/agence/collectes', icon: Truck },
        {
          label: 'Mon organisation',
          href: '/agence/mon-organisation',
          icon: Building2,
        },
        { label: 'Mon profil', href: '/agence/mon-profil', icon: Settings },
      ],
    },
  ],

  // §06.05 §Navigation. Le CDC fige 7 sections (sans Collectes ni Registre), mais
  // Val a demandé le 2026-07-06 de CONSERVER « Collectes » + « Registre réglementaire »
  // (override explicite de la décision CDC l.79 « Pas de section Collectes » —
  // cf. _Divergences/M3.2_20260706_nav_collectes_registre.md, type: ambigu).
  // → 9 entrées. Seule règle CDC-conforme appliquée ici : « Mon pack AG » masqué si
  // l'organisation n'a aucun pack (filtrage `hiddenNavHrefs` calculé côté layout,
  // appliqué dans Sidebar/BottomNav — CDC l.71).
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
        {
          label: 'Collectes',
          href: '/gestionnaire/collectes',
          icon: ClipboardList,
        },
        {
          label: 'Registre réglementaire',
          href: '/registre',
          icon: FileText,
        },
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
        {
          label: 'Registre réglementaire',
          href: '/registre',
          icon: ClipboardList,
        },
        {
          label: 'Mon profil',
          href: '/organisateur/mon-profil',
          icon: Settings,
        },
      ],
    },
  ],
};

export function getNavItems(role: Role): NavItem[] {
  return NAV_CONFIG[role]?.flatMap((g) => g.items) ?? [];
}
