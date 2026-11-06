import {
  type Icone,
  BellIcon,
  BuildingsIcon,
  CalendarDotsIcon,
  ChartBarIcon,
  BookOpenIcon,
  ChefHatIcon,
  FileTextIcon,
  GearIcon,
  HeartIcon,
  MapPinIcon,
  PackageIcon,
  PulseIcon,
  ReceiptIcon,
  SquaresFourIcon,
  TruckIcon,
  UserCircleIcon,
} from '@/components/ui/icones';
import type { NavRole } from '@/lib/roles';
import { ROUTES } from '@/lib/routes';
import { TITRE_MON_PACK_AG } from '@/lib/libelles/pack';

export interface NavItem {
  label: string;
  href: string;
  icon: Icone;
  badge?: string;
  /**
   * Autres adresses (et leurs sous-pages) qui allument cette entrée. Sert à
   * « Événements » des espaces clients : les pages collectes n'ont plus
   * d'entrée à elles (Val 2026-11-05), on y arrive depuis un événement.
   */
  aussiActifSur?: string[];
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
          icon: SquaresFourIcon,
        },
        {
          label: 'Dashboard Client',
          href: ROUTES.admin.dashboardClient,
          icon: ChartBarIcon,
        },
        // « Événements » sous « Collectes » : décision Val 2026-10-29.
        { label: 'Collectes', href: ROUTES.admin.collectes, icon: TruckIcon },
        {
          label: 'Événements',
          href: ROUTES.admin.evenements,
          icon: CalendarDotsIcon,
        },
        {
          label: 'Facturation',
          href: ROUTES.admin.factures,
          icon: ReceiptIcon,
        },
        {
          label: 'Associations',
          href: ROUTES.admin.associations,
          icon: HeartIcon,
        },
        {
          label: 'Transporteurs',
          href: ROUTES.admin.transporteurs,
          icon: TruckIcon,
        },
        { label: 'Lieux', href: ROUTES.admin.lieux, icon: MapPinIcon },
        { label: 'Clients', href: ROUTES.admin.clients, icon: BuildingsIcon },
        { label: 'Paramètres', href: ROUTES.admin.parametres, icon: GearIcon },
        {
          label: 'Mon profil',
          href: ROUTES.admin.monProfil,
          icon: UserCircleIcon,
        },
        { label: 'Alertes', href: ROUTES.admin.alertes, icon: BellIcon },
        {
          label: 'Santé système',
          href: ROUTES.admin.santeSysteme,
          icon: PulseIcon,
        },
      ],
    },
  ],

  // Espaces clients (5 rôles) : plus d'entrée « Collectes » dans le menu,
  // « Événements » seule (décision Val 2026-11-05). Les pages
  // `…/collectes` et les fiches collecte restent ouvertes (liens depuis un
  // événement, le dashboard, les emails) ; seul l'Admin garde l'entrée.
  //
  // §06.04 §1 — nav traiteur (refonte 2026-05-05) : Dashboard / Collectes /
  // Paramètres, plus « Événements » sous « Collectes »
  // (décision Val 2026-10-29 : la liste Événements est commune à tous les rôles).
  // « Mon organisation » et « Mon profil » sont des onglets de « Paramètres »,
  // dans tous les espaces client (décision Val 2026-10-31).
  // Identique manager et commercial (le contrôle d'accès intra-page masque
  // l'édition + la sous-section Équipe au commercial — révision 2026-05-29).
  traiteur_manager: [
    {
      items: [
        {
          label: 'Dashboard',
          href: ROUTES.traiteur.racine,
          icon: SquaresFourIcon,
        },
        {
          label: 'Événements',
          href: ROUTES.traiteur.evenements,
          icon: CalendarDotsIcon,
          aussiActifSur: [ROUTES.traiteur.collectes],
        },
        {
          label: 'Paramètres',
          href: ROUTES.traiteur.parametres,
          icon: GearIcon,
        },
        {
          label: TITRE_MON_PACK_AG,
          href: ROUTES.traiteur.monPackAg,
          icon: PackageIcon,
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
          icon: SquaresFourIcon,
        },
        {
          label: 'Événements',
          href: ROUTES.traiteur.evenements,
          icon: CalendarDotsIcon,
          aussiActifSur: [ROUTES.traiteur.collectes],
        },
        {
          label: 'Paramètres',
          href: ROUTES.traiteur.parametres,
          icon: GearIcon,
        },
        {
          label: TITRE_MON_PACK_AG,
          href: ROUTES.traiteur.monPackAg,
          icon: PackageIcon,
        },
      ],
    },
  ],

  // §06.11 Navigation — réplique §06.04 §1. Pas de Registre (non productrice,
  // diff #5), pas de section Lieux/Reporting dédiée (export RSE via Bloc 8
  // dashboard). « Événements » sous « Collectes » : décision Val 2026-10-29
  // (liste commune à tous les rôles).
  agence: [
    {
      items: [
        {
          label: 'Dashboard',
          href: ROUTES.agence.racine,
          icon: SquaresFourIcon,
        },
        {
          label: 'Événements',
          href: ROUTES.agence.evenements,
          icon: CalendarDotsIcon,
          aussiActifSur: [ROUTES.agence.collectes],
        },
        {
          label: 'Paramètres',
          href: ROUTES.agence.parametres,
          icon: GearIcon,
        },
        {
          label: TITRE_MON_PACK_AG,
          href: ROUTES.agence.monPackAg,
          icon: PackageIcon,
        },
      ],
    },
  ],

  // §06.05 §Navigation (l.66-76) : 9 sections (8 depuis que « Mon organisation »
  // est un onglet de « Paramètres », décision Val 2026-10-31), dont « Collectes » et « Registre
  // réglementaire », réintégrées par Val le 2026-07-06 (CDC re-synchronisé depuis).
  // « Événements », retirée le 2026-10-07 (doublon de Collectes), est remise par
  // Val le 2026-10-18 : vue consolidée d'un événement à plusieurs collectes.
  // « Mon pack Anti-Gaspi » figure dans le menu de tous les rôles clients, même
  // sans pack (Val 2026-11-02 : l'entrée n'est plus masquée).
  // Traiteur, agence, organisateur : elle suit « Paramètres », qui passe dans le
  // menu de l'utilisateur ; elle est donc la dernière entrée visible de la
  // barre latérale, et la barre mobile (4 premières entrées) garde
  // « Paramètres ».
  // Ordre fixé par Val le 2026-10-07 (il diffère de la liste du CDC), sans
  // « Collectes » depuis le 2026-11-05. La barre mobile affiche les 4
  // premières entrées : Dashboard, Événements, Traiteurs, Mes lieux.
  gestionnaire_lieux: [
    {
      items: [
        {
          label: 'Dashboard',
          href: ROUTES.gestionnaire.racine,
          icon: SquaresFourIcon,
        },
        {
          label: 'Événements',
          href: ROUTES.gestionnaire.evenements,
          icon: CalendarDotsIcon,
          aussiActifSur: [ROUTES.gestionnaire.collectes],
        },
        {
          label: 'Traiteurs',
          href: ROUTES.gestionnaire.traiteurs,
          icon: ChefHatIcon,
        },
        {
          label: 'Mes lieux',
          href: ROUTES.gestionnaire.lieux,
          icon: MapPinIcon,
        },
        {
          label: 'Registre réglementaire',
          href: ROUTES.registre,
          icon: BookOpenIcon,
        },
        {
          label: TITRE_MON_PACK_AG,
          href: ROUTES.gestionnaire.monPackAg,
          icon: PackageIcon,
        },
        {
          label: 'Paramètres',
          href: ROUTES.gestionnaire.parametres,
          icon: GearIcon,
        },
      ],
    },
  ],

  // « Dashboard » (ex « Mes événements », renommé par Val le 2026-10-29) puis
  // « Événements » sous « Collectes » : la liste commune à tous les rôles.
  client_organisateur: [
    {
      items: [
        {
          label: 'Dashboard',
          href: ROUTES.organisateur.racine,
          icon: SquaresFourIcon,
        },
        {
          label: 'Événements',
          href: ROUTES.organisateur.evenements,
          icon: CalendarDotsIcon,
          aussiActifSur: [ROUTES.organisateur.collectes],
        },
        {
          label: 'Documents',
          href: ROUTES.organisateur.documents,
          icon: FileTextIcon,
        },
        {
          label: 'Registre réglementaire',
          href: ROUTES.registre,
          icon: BookOpenIcon,
        },
        {
          label: 'Paramètres',
          href: ROUTES.organisateur.parametres,
          icon: GearIcon,
        },
        {
          label: TITRE_MON_PACK_AG,
          href: ROUTES.organisateur.monPackAg,
          icon: PackageIcon,
        },
      ],
    },
  ],
};

export function getNavItems(role: NavRole): NavItem[] {
  return NAV_CONFIG[role]?.flatMap((g) => g.items) ?? [];
}

/**
 * Entrée du menu active pour un chemin : UNE seule (Design System §10,
 * `aria-current` sur l'item de nav actif). Plusieurs entrées peuvent préfixer le
 * chemin courant — le Dashboard d'un espace client vit à la racine de l'espace
 * (`/gestionnaire`), donc préfixe toutes ses voisines (`/gestionnaire/collectes`).
 * La plus précise l'emporte : celle dont l'adresse (`href` ou `aussiActifSur`)
 * est la plus longue.
 *
 * Cherchée parmi TOUTES les entrées du rôle, y compris celles que l'écran ne
 * montre pas (entrée masquée, au-delà des 4 de la barre mobile) : sur leur page,
 * aucune autre entrée ne doit s'allumer à leur place.
 */
export function hrefNavActif(
  role: NavRole,
  pathname: string,
): string | undefined {
  let actif: string | undefined;
  let longueur = 0;
  for (const { href, aussiActifSur = [] } of getNavItems(role)) {
    for (const adresse of [href, ...aussiActifSur]) {
      const correspond =
        pathname === adresse || pathname.startsWith(adresse + '/');
      if (correspond && adresse.length > longueur) {
        actif = href;
        longueur = adresse.length;
      }
    }
  }
  return actif;
}
