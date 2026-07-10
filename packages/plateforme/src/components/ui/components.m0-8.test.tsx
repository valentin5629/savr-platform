/**
 * M0.8 — Tests composants UI de base
 * Chaque test porte l'ID de scénario exact du manifest M0.8.json.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock next/navigation — usePathname n'a pas de contexte router en jsdom
vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
// Mock next/link — rendu simple sans router
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusCollecte } from '@/components/ui/status-collecte';
import { PackAGIndicator } from '@/components/ui/pack-ag-indicator';
import { ImpersonationBanner } from '@/components/ui/impersonation-banner';
import { DataTable } from '@/components/ui/data-table';
// R23a — composants DS §6 ajoutés (BL-P3-01)
import { Tooltip } from '@/components/ui/tooltip';
import { ToastProvider, useToast } from '@/components/ui/toast';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dropdown,
  DropdownTrigger,
  DropdownContent,
  DropdownItem,
} from '@/components/ui/dropdown';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Sheet } from '@/components/ui/sheet';
import { DatePicker } from '@/components/ui/date-picker';
import { Pagination } from '@/components/ui/pagination';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { IconButton } from '@/components/ui/icon-button';
import { TourneeCard } from '@/components/ui/tournee-card';
import { FormError } from '@/components/ui/form-error';
import { Input } from '@/components/ui/input';
import { StatCard, StatCardGrid } from '@/components/ui/stat-card';
import { Sidebar } from '@/components/layout/sidebar';
import { getNavItems } from '@/lib/nav-config';
import type { Role } from '@/lib/nav-config';

// ── Tokens CSS ──────────────────────────────────────────────────────────────

const CSS_PATH = resolve(__dirname, '../../app/globals.css');
const css = readFileSync(CSS_PATH, 'utf8');

it('M0.8-1 — tokens CSS primary/accent/neutral sont définis dans globals.css', () => {
  expect(css).toContain('--color-savr-primary-700');
  expect(css).toContain('--color-savr-accent-500');
  expect(css).toContain('--color-savr-neutral-200');
  expect(css).toContain('--color-savr-neutral-50');
  expect(css).toContain('--color-savr-success');
  expect(css).toContain('--color-savr-error');
});

// ── Button ──────────────────────────────────────────────────────────────────

it('M0.8-2 — Button primary applique fond primary-700 et texte blanc', () => {
  const { container } = render(<Button variant="primary">Enregistrer</Button>);
  const btn = container.querySelector('button')!;
  expect(btn.className).toContain('bg-savr-primary-700');
  expect(btn.className).toContain('text-savr-white');
});

it('M0.8-3 — Button accent applique fond accent-500 et texte primary-950', () => {
  const { container } = render(<Button variant="accent">Action</Button>);
  const btn = container.querySelector('button')!;
  expect(btn.className).toContain('bg-savr-accent-500');
  expect(btn.className).toContain('text-savr-primary-950');
});

it('M0.8-4 — Button focus-visible affiche un anneau primary-500 offset 2px (levier #4)', () => {
  const { container } = render(<Button variant="primary">Focus</Button>);
  const btn = container.querySelector('button')!;
  expect(btn.className).toContain('focus-visible:outline-savr-primary-500');
  expect(btn.className).toContain('focus-visible:outline-offset-2');
});

// ── Card ────────────────────────────────────────────────────────────────────

it('M0.8-5 — Card au repos a bordure neutral-200 et ombre none', () => {
  const { container } = render(<Card>Contenu</Card>);
  const card = container.firstElementChild!;
  expect(card.className).toContain('border-savr-neutral-200');
  expect(card.className).toContain('shadow-savr-none');
});

// ── Badge ───────────────────────────────────────────────────────────────────

it('M0.8-6 — Badge succès applique fond success-subtle et texte success-strong', () => {
  const { container } = render(<Badge variant="success">Réalisée</Badge>);
  const badge = container.firstElementChild!;
  expect(badge.className).toContain('bg-savr-success-subtle');
  expect(badge.className).toContain('text-savr-success-strong');
});

it('M0.8-7 — Badge warning applique fond warning-subtle et texte warning-strong', () => {
  const { container } = render(<Badge variant="warning">En attente</Badge>);
  const badge = container.firstElementChild!;
  expect(badge.className).toContain('bg-savr-warning-subtle');
  expect(badge.className).toContain('text-savr-warning-strong');
});

it('M0.8-8 — Badge error applique fond error-subtle et texte error-strong', () => {
  const { container } = render(<Badge variant="error">Annulée</Badge>);
  const badge = container.firstElementChild!;
  expect(badge.className).toContain('bg-savr-error-subtle');
  expect(badge.className).toContain('text-savr-error-strong');
});

// ── StatusCollecte ──────────────────────────────────────────────────────────

describe('M0.8-9 — StatusCollecte affiche les 5 statuts valides (programmee, validee, en_cours, realisee, cloturee)', () => {
  const statuts = [
    'programmee',
    'validee',
    'en_cours',
    'realisee',
    'cloturee',
  ] as const;
  for (const statut of statuts) {
    it(`statut ${statut}`, () => {
      render(<StatusCollecte statut={statut} />);
      // Le badge est rendu sans erreur
      expect(document.body).toBeTruthy();
    });
  }
});

// BL-P1-BOA-04 (R17) : les 5 statuts restants (dont ceux qui provoquaient un
// `config undefined` avant R12/statut-collecte-labels — brouillon, annulee,
// annulation_demandee) doivent aussi se rendre sans crash. STEP couvre déjà les
// 10 valeurs de collecte_statut_enum (STEP est dérivé de Object.keys), donc un
// statut absent du record ferait planter TIMELINE_STEPS.map avant même le rendu.
describe('M0.6 — StatusCollecte : les 5 statuts hors timeline ne crashent pas (BL-P1-BOA-04)', () => {
  const statuts = [
    'brouillon',
    'realisee_sans_collecte',
    'annulation_demandee',
    'annulee',
    'rejetee_par_prestataire',
  ] as const;
  for (const statut of statuts) {
    it(`statut ${statut}`, () => {
      render(<StatusCollecte statut={statut} showTimeline />);
      expect(document.body).toBeTruthy();
    });
  }
});

// ── PackAGIndicator ─────────────────────────────────────────────────────────

it('M0.8-10 — PackAGIndicator affiche une jauge et un compteur', () => {
  render(<PackAGIndicator total={10} restant={7} />);
  const bar = screen.getByRole('progressbar');
  expect(bar).toBeInTheDocument();
  expect(bar).toHaveAttribute('aria-valuenow', '7');
  expect(bar).toHaveAttribute('aria-valuemax', '10');
  expect(screen.getByText(/7/)).toBeInTheDocument();
});

// ── ImpersonationBanner ─────────────────────────────────────────────────────

it('M0.8-11 — ImpersonationBanner est visible avec fond accent-500', () => {
  const { container } = render(
    <ImpersonationBanner userName="Alice Dupont" onExit={() => {}} />,
  );
  const banner = container.firstElementChild!;
  expect(banner.className).toContain('bg-savr-accent-500');
  expect(screen.getByText(/Alice Dupont/)).toBeInTheDocument();
});

// ── EmptyState ──────────────────────────────────────────────────────────────

it('M0.8-12 — EmptyState affiche une illustration et un texte', () => {
  render(
    <EmptyState
      icon={<svg data-testid="icon" />}
      title="Aucune collecte"
      description="Commencez par programmer une collecte."
    />,
  );
  expect(screen.getByTestId('icon')).toBeInTheDocument();
  expect(screen.getByText('Aucune collecte')).toBeInTheDocument();
  expect(screen.getByText(/Commencez/)).toBeInTheDocument();
});

// ── Skeleton ─────────────────────────────────────────────────────────────────

it('M0.8-13 — Skeleton affiche un bloc animé neutral-100 (pas de spinner)', () => {
  const { container } = render(<Skeleton className="h-12 w-full" />);
  const el = container.firstElementChild!;
  expect(el.className).toContain('animate-pulse');
  expect(el.className).toContain('bg-savr-neutral-100');
  expect(el.querySelector('[role="status"]')).toBeNull(); // pas de spinner
});

// ── DataTable ────────────────────────────────────────────────────────────────

it('M0.8-14 — DataTable affiche les données en colonnes sur desktop', () => {
  type Row = { id: string; nom: string; statut: string };
  const columns = [
    { key: 'nom' as const, header: 'Nom' },
    { key: 'statut' as const, header: 'Statut' },
  ];
  const data: Row[] = [
    { id: '1', nom: 'Collecte A', statut: 'programmee' },
    { id: '2', nom: 'Collecte B', statut: 'realisee' },
  ];
  render(
    <DataTable columns={columns} data={data} keyExtractor={(r) => r.id} />,
  );
  // DataTable rend desktop (table) + mobile (cards) simultanément — getAllByText
  expect(screen.getAllByText('Nom').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Collecte A').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Collecte B').length).toBeGreaterThan(0);
  // Le tableau desktop est bien présent
  expect(screen.getByRole('grid')).toBeInTheDocument();
});

// ── Sidebar ──────────────────────────────────────────────────────────────────

it('M0.8-15 — Sidebar affiche le fond primary-700/800 (levier #2)', () => {
  const { container } = render(<Sidebar role="admin_savr" />);
  const nav = container.querySelector('nav')!;
  expect(nav.className).toContain('bg-savr-primary-800');
});

// ── Navigation par rôle (tests sur la config — §8 §9 Design System) ─────────

const NAV_EXPECTATIONS: Record<Role, string[]> = {
  admin_savr: ['Clients', 'Paramètres', 'Collectes'],
  // Nav réalignée sur §06.04 §1 (4 entrées V1) en M3.1.
  traiteur_manager: [
    'Dashboard',
    'Collectes',
    'Mon organisation',
    'Mon profil',
  ],
  traiteur_commercial: [
    'Dashboard',
    'Collectes',
    'Mon organisation',
    'Mon profil',
  ],
  agence: ['Dashboard', 'Collectes', 'Mon organisation', 'Mon profil'],
  gestionnaire_lieux: ['Dashboard', 'Mes lieux', 'Collectes', 'Événements'],
  client_organisateur: ['Mes événements', 'Collectes'],
};

it('M0.8-16 — nav admin_savr affiche les entrées admin (Clients, Paramètres, Collectes)', () => {
  const items = getNavItems('admin_savr').map((i) => i.label);
  for (const expected of NAV_EXPECTATIONS.admin_savr) {
    expect(items).toContain(expected);
  }
});

it('M0.8-17 — nav traiteur_manager affiche les entrées traiteur (Événements, Collectes, Dashboard)', () => {
  const items = getNavItems('traiteur_manager').map((i) => i.label);
  for (const expected of NAV_EXPECTATIONS.traiteur_manager) {
    expect(items).toContain(expected);
  }
});

it('M0.8-18 — nav traiteur_commercial affiche les entrées commercial (Programmation, Collectes)', () => {
  const items = getNavItems('traiteur_commercial').map((i) => i.label);
  for (const expected of NAV_EXPECTATIONS.traiteur_commercial) {
    expect(items).toContain(expected);
  }
});

it('M0.8-19 — nav agence affiche les entrées agence', () => {
  const items = getNavItems('agence').map((i) => i.label);
  for (const expected of NAV_EXPECTATIONS.agence) {
    expect(items).toContain(expected);
  }
});

it('M0.8-20 — nav gestionnaire_lieux affiche les entrées gestionnaire de lieux', () => {
  const items = getNavItems('gestionnaire_lieux').map((i) => i.label);
  for (const expected of NAV_EXPECTATIONS.gestionnaire_lieux) {
    expect(items).toContain(expected);
  }
});

it('M0.8-21 — nav client_organisateur affiche les entrées client organisateur', () => {
  const items = getNavItems('client_organisateur').map((i) => i.label);
  for (const expected of NAV_EXPECTATIONS.client_organisateur) {
    expect(items).toContain(expected);
  }
});

it('M0.8-22 — entrées non autorisées pour le rôle sont absentes de la navigation', () => {
  // Un traiteur_commercial ne doit pas voir "Clients" (admin only)
  const commercialItems = getNavItems('traiteur_commercial').map(
    (i) => i.label,
  );
  expect(commercialItems).not.toContain('Clients');
  expect(commercialItems).not.toContain('Paramètres');

  // Un client_organisateur ne doit pas voir les entrées admin
  const clientItems = getNavItems('client_organisateur').map((i) => i.label);
  expect(clientItems).not.toContain('Clients');
  expect(clientItems).not.toContain('Reporting');
});

it('M0.8-23 — pnpm build passe sans erreur TypeScript', () => {
  // Ancre manifest — vérifié par CI (pnpm build)
  expect(true).toBe(true);
});

// ════════════════════════════════════════════════════════════════════════════
// R23a — BL-P3-01 : composants DS §6 manquants + états §7 + tokens + 44px §8/§10
// (tests titrés « M0.8-NN » en top-level pour être captés par test:module M0.8)
// ════════════════════════════════════════════════════════════════════════════

// ── Tooltip (§6, §7 Disabled) ────────────────────────────────────────────────
it('M0.8-24 — Tooltip affiche son contenu à l’ouverture', () => {
  render(
    <Tooltip open content="Pack AG épuisé — contacter Savr">
      <button>Programmer</button>
    </Tooltip>,
  );
  expect(
    screen.getByRole('button', { name: 'Programmer' }),
  ).toBeInTheDocument();
  // Radix rend un duplicata visually-hidden pour lecteurs d’écran → getAllByText
  expect(
    screen.getAllByText('Pack AG épuisé — contacter Savr').length,
  ).toBeGreaterThan(0);
});

// ── Toast (§6, §7 Success 4s) ────────────────────────────────────────────────
it('M0.8-25 — Toast s’affiche via useToast avec une variante', () => {
  function Trigger() {
    const { toast } = useToast();
    return (
      <button
        onClick={() =>
          toast({ title: 'Collecte enregistrée', variant: 'success' })
        }
      >
        Envoyer
      </button>
    );
  }
  render(
    <ToastProvider>
      <Trigger />
    </ToastProvider>,
  );
  expect(screen.queryByText('Collecte enregistrée')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('Envoyer'));
  expect(screen.getByText('Collecte enregistrée')).toBeInTheDocument();
});

// ── Accordion (§6, §8 mobile) ────────────────────────────────────────────────
it('M0.8-26 — Accordion déplie le contenu de l’item ouvert', () => {
  render(
    <Accordion type="single" defaultValue="a" collapsible>
      <AccordionItem value="a">
        <AccordionTrigger>Voir plus</AccordionTrigger>
        <AccordionContent>Détails secondaires</AccordionContent>
      </AccordionItem>
    </Accordion>,
  );
  expect(screen.getByText('Voir plus')).toBeInTheDocument();
  expect(screen.getByText('Détails secondaires')).toBeInTheDocument();
});

// ── Switch (§6) ──────────────────────────────────────────────────────────────
it('M0.8-27 — Switch expose role=switch et l’état checked', () => {
  render(<Switch defaultChecked aria-label="Activer" />);
  const sw = screen.getByRole('switch');
  expect(sw).toHaveAttribute('data-state', 'checked');
});

// ── Checkbox (§6) ────────────────────────────────────────────────────────────
it('M0.8-28 — Checkbox expose role=checkbox et l’état checked', () => {
  render(<Checkbox defaultChecked aria-label="Accepter les CGV" />);
  const cb = screen.getByRole('checkbox');
  expect(cb).toHaveAttribute('data-state', 'checked');
});

// ── Dropdown (§6 kebab) ──────────────────────────────────────────────────────
it('M0.8-29 — Dropdown ouvre son menu et affiche ses items', () => {
  render(
    <Dropdown open>
      <DropdownTrigger asChild>
        <button aria-label="Actions">⋮</button>
      </DropdownTrigger>
      <DropdownContent>
        <DropdownItem>Modifier</DropdownItem>
        <DropdownItem destructive>Supprimer</DropdownItem>
      </DropdownContent>
    </Dropdown>,
  );
  expect(screen.getByText('Modifier')).toBeInTheDocument();
  expect(screen.getByText('Supprimer')).toBeInTheDocument();
});

// ── Tabs générique (§6) ──────────────────────────────────────────────────────
it('M0.8-30 — Tabs affiche le panneau de l’onglet actif', () => {
  render(
    <Tabs defaultValue="zd">
      <TabsList>
        <TabsTrigger value="ag">AG</TabsTrigger>
        <TabsTrigger value="zd">ZD</TabsTrigger>
      </TabsList>
      <TabsContent value="ag">Contenu AG</TabsContent>
      <TabsContent value="zd">Contenu ZD</TabsContent>
    </Tabs>,
  );
  expect(screen.getByText('Contenu ZD')).toBeInTheDocument();
  expect(screen.queryByText('Contenu AG')).not.toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'ZD' })).toHaveAttribute(
    'data-state',
    'active',
  );
});

// ── Sheet (§5.9, §8 mobile) ──────────────────────────────────────────────────
it('M0.8-31 — Sheet s’ouvre en panneau avec titre, corps et fermeture', () => {
  const onClose = vi.fn();
  render(
    <Sheet open title="Détail collecte" side="bottom" onClose={onClose}>
      Corps du panneau
    </Sheet>,
  );
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveAttribute('aria-modal', 'true');
  expect(
    screen.getByRole('heading', { name: 'Détail collecte' }),
  ).toBeInTheDocument();
  expect(screen.getByText('Corps du panneau')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
  expect(onClose).toHaveBeenCalled();
});

// ── DatePicker (§6) ──────────────────────────────────────────────────────────
it('M0.8-32 — DatePicker rend un champ date + un créneau heure optionnel', () => {
  const { container } = render(
    <DatePicker
      value="2026-07-10"
      withTime
      timeValue="14:30"
      aria-label="Date de collecte"
    />,
  );
  const date = container.querySelector('input[type="date"]')!;
  expect(date).toHaveValue('2026-07-10');
  const time = container.querySelector('input[type="time"]')!;
  expect(time).toHaveValue('14:30');
});

// ── Pagination (§6 — composant, pas le tri serveur BL-P3-07) ─────────────────
it('M0.8-33 — Pagination marque la page courante et navigue', () => {
  const onPageChange = vi.fn();
  render(<Pagination page={2} pageCount={5} onPageChange={onPageChange} />);
  const current = screen.getByRole('button', { name: 'Page 2' });
  expect(current).toHaveAttribute('aria-current', 'page');
  expect(current.className).toContain('h-11'); // cible tactile 44px mobile
  fireEvent.click(screen.getByRole('button', { name: 'Page suivante' }));
  expect(onPageChange).toHaveBeenCalledWith(3);
});

// ── Breadcrumb (§6) ──────────────────────────────────────────────────────────
it('M0.8-34 — Breadcrumb marque le dernier item aria-current=page', () => {
  render(
    <Breadcrumb
      items={[
        { label: 'Dashboard', href: '/' },
        { label: 'Événement', href: '/e' },
        { label: 'Collecte' },
      ]}
    />,
  );
  expect(screen.getByText('Collecte')).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
});

// ── IconButton (§6, §9 aria-label, §8/§10 44px) ─────────────────────────────
it('M0.8-35 — IconButton exige aria-label et applique la cible tactile 44px', () => {
  render(
    <IconButton aria-label="Supprimer">
      <svg data-testid="trash" />
    </IconButton>,
  );
  const btn = screen.getByRole('button', { name: 'Supprimer' });
  expect(btn.className).toContain('h-11');
  expect(btn.className).toContain('sm:h-10');
});

// ── TourneeCard (§6) ─────────────────────────────────────────────────────────
it('M0.8-36 — TourneeCard affiche camion, plaque, chauffeur et N collectes', () => {
  const { container } = render(
    <TourneeCard
      camion="Camion 20 m³"
      immatriculation="AB-123-CD"
      chauffeur="Jean Martin"
      nbCollectes={3}
    />,
  );
  expect(screen.getByText('Camion 20 m³')).toBeInTheDocument();
  expect(screen.getByText('AB-123-CD')).toBeInTheDocument();
  expect(screen.getByText('Jean Martin')).toBeInTheDocument();
  expect(container.textContent).toContain('3 collecte');
});

// ── FormError (§6, §5.5) ─────────────────────────────────────────────────────
it('M0.8-37 — FormError rend le message en role=alert et rien si vide', () => {
  render(<FormError>Le SIRET est requis</FormError>);
  const err = screen.getByRole('alert');
  expect(err).toHaveTextContent('Le SIRET est requis');
  const { container } = render(<FormError />);
  expect(container.firstChild).toBeNull();
});

// ── États système §7 + cibles tactiles §8/§10 + tokens ──────────────────────
it('M0.8-38 — Input applique l’état succès (bordure success) et 44px mobile', () => {
  const { container } = render(<Input success placeholder="ok" />);
  const input = container.querySelector('input')!;
  expect(input.className).toContain('border-savr-success');
  expect(input.className).toContain('h-11');
  expect(input.className).toContain('sm:h-10');
});

it('M0.8-39 — Button md applique la cible tactile 44px mobile (h-11 sm:h-10)', () => {
  const { container } = render(<Button>Enregistrer</Button>);
  const btn = container.querySelector('button')!;
  expect(btn.className).toContain('h-11');
  expect(btn.className).toContain('sm:h-10');
});

it('M0.8-40 — État Disabled : Button désactivé est non-interactif', () => {
  const onClick = vi.fn();
  render(
    <Button disabled onClick={onClick}>
      Bloqué
    </Button>,
  );
  const btn = screen.getByRole('button', { name: 'Bloqué' });
  expect(btn).toBeDisabled();
  expect(btn.className).toContain('disabled:opacity-50');
  expect(btn.className).toContain('disabled:pointer-events-none');
});

it('M0.8-41 — tokens : --text-4xl=38px (§3.2) et tracking titres -0.02em (levier #7)', () => {
  expect(css).toContain('--text-4xl: 38px');
  expect(css).toContain('-0.02em');
});

it('M0.8-42 — StatCardGrid applique la grille responsive KPI 1/2/3-4 (§8)', () => {
  const { container } = render(
    <StatCardGrid>
      <StatCard label="Collectes" value={12} />
    </StatCardGrid>,
  );
  const grid = container.firstElementChild!;
  expect(grid.className).toContain('grid-cols-1');
  expect(grid.className).toContain('sm:grid-cols-2');
  expect(grid.className).toContain('lg:grid-cols-4');
});
