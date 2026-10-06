import type { LucideIcon } from 'lucide-react';
import type { NavRole } from '@/lib/roles';
import { ROUTES } from '@/lib/routes';
import {
  LayoutDashboard,
  Building2,
  MapPin,
  CalendarDays,
  Truck,
  UserCircle,
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

export const NAV_CONFIG: Record<NavRole, NavGroup[]> = {
  admin_savr: [
    {
      items: [
        {
          label: 'Dashboard Admin',
          href: ROUTES.admin.dashboard,
          icon: LayoutDashboard,
        },
        {
          label: 'Dashboard Client',
          href: ROUTES.admin.dashboardClient,
          icon: BarChart3,
        },
        { label: 'Collectes', href: ROUTES.admin.collectes, icon: Truck },
        { label: 'Facturation', href: ROUTES.admin.factures, icon: Receipt },
        { label: 'Associations', href: ROUTES.admin.associations, icon: Heart },
        {
          label: 'Transporteurs',
          href: ROUTES.admin.transporteurs,
          icon: Truck,
        },
        { label: 'Lieux', href: ROUTES.admin.lieux, icon: MapPin },
        { label: 'Clients', href: ROUTES.admin.clients, icon: Building2 },
        { label: 'Paramètres', href: ROUTES.admin.parametres, icon: Settings },
        { label: 'Mon profil', href: ROUTES.admin.monProfil, icon: UserCircle },
        { label: 'Alertes', href: ROUTES.admin.alertes, icon: Bell },
        {
          label: 'Santé système',
          href: ROUTES.admin.santeSysteme,
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
        {
          label: 'Dashboard',
          href: ROUTES.traiteur.racine,
          icon: LayoutDashboard,
        },
        { label: 'Collectes', href: ROUTES.traiteur.collectes, icon: Truck },
        {
          label: 'Mon organisation',
          href: ROUTES.traiteur.monOrganisation,
          icon: Building2,
        },
        {
          label: 'Mon profil',
          href: ROUTES.traiteur.monProfil,
          icon: Settings,
        },
      ],
    },
  ],

  traiteur_commercial: [
    {
      items: [
        {
          label: 'Dashboard',
          href: ROUTES.traiteur.racine,
          icon: LayoutDashboard,
        },
        { label: 'Collectes', href: ROUTES.traiteur.collectes, icon: Truck },
        {
          label: 'Mon organisation',
          href: ROUTES.traiteur.monOrganisation,
          icon: Building2,
        },
        {
          label: 'Mon profil',
          href: ROUTES.traiteur.monProfil,
          icon: Settings,
        },
      ],
    },
  ],

  // §06.11 Navigation — réplique stricte §06.04 §1 : 4 entrées V1.
  // Pas de Registre (non productrice, diff #5), pas de section Événements/Lieux/
  // Reporting dédiée (export RSE via Bloc 8 dashboard, pack AG via onglet AG).
  agence: [
    {
      items: [
        {
          label: 'Dashboard',
          href: ROUTES.agence.racine,
          icon: LayoutDashboard,
        },
        { label: 'Collectes', href: ROUTES.agence.collectes, icon: Truck },
        {
          label: 'Mon organisation',
          href: ROUTES.agence.monOrganisation,
          icon: Building2,
        },
        { label: 'Mon profil', href: ROUTES.agence.monProfil, icon: Settings },
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
        {
          label: 'Dashboard',
          href: ROUTES.gestionnaire.racine,
          icon: LayoutDashboard,
        },
        {
          label: 'Événements',
          href: ROUTES.gestionnaire.evenements,
          icon: CalendarDays,
        },
        { label: 'Mes lieux', href: ROUTES.gestionnaire.lieux, icon: MapPin },
        {
          label: 'Collectes',
          href: ROUTES.gestionnaire.collectes,
          icon: ClipboardList,
        },
        {
          label: 'Registre réglementaire',
          href: ROUTES.registre,
          icon: FileText,
        },
        {
          label: 'Traiteurs',
          href: ROUTES.gestionnaire.traiteurs,
          icon: Truck,
        },
        {
          label: 'Mon pack AG',
          href: ROUTES.gestionnaire.monPackAg,
          icon: Package,
        },
        {
          label: 'Mon organisation',
          href: ROUTES.gestionnaire.monOrganisation,
          icon: Building2,
        },
        {
          label: 'Paramètres',
          href: ROUTES.gestionnaire.parametres,
          icon: Settings,
        },
      ],
    },
  ],

  client_organisateur: [
    {
      items: [
        {
          label: 'Mes événements',
          href: ROUTES.organisateur.racine,
          icon: CalendarDays,
        },
        {
          label: 'Collectes',
          href: ROUTES.organisateur.collectes,
          icon: ClipboardList,
        },
        {
          label: 'Documents',
          href: ROUTES.organisateur.documents,
          icon: FileText,
        },
        {
          label: 'Registre réglementaire',
          href: ROUTES.registre,
          icon: ClipboardList,
        },
        {
          label: 'Mon organisation',
          href: ROUTES.organisateur.monOrganisation,
          icon: Building2,
        },
        {
          label: 'Mon profil',
          href: ROUTES.organisateur.monProfil,
          icon: Settings,
        },
      ],
    },
  ],
};

export function getNavItems(role: NavRole): NavItem[] {
  return NAV_CONFIG[role]?.flatMap((g) => g.items) ?? [];
}
