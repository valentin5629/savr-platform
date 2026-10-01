'use client';

/**
 * Vitrine Design System — page de dev, jamais servie en production (garde 404
 * dans src/app/dev/layout.tsx, cliquet tests/securite/dev-routes-prod.test.ts).
 *
 * Monte côte à côte les primitives `components/ui` et les recettes ad hoc
 * relevées dans docs/design-system/RATIONALISATION_UI.md (les identifiants
 * A1…K3 renvoient aux lignes de l'inventaire), pour valider visuellement chaque
 * consolidation. Données codées en dur, aucun appel réseau, aucune donnée réelle.
 *
 * Captures : `node docs/design-system/captures.mjs` (dev server sur :3001) →
 * docs/design-system/captures/*.png, référencées par docs/design-system/GALERIE.md.
 */

import { useState } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  Download,
  Inbox,
  Info,
  Leaf,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Badge } from '@/components/ui/badge';
import { CollecteStatutBadge } from '@/components/ui/collecte-statut-badge';
import { StatusCollecte } from '@/components/ui/status-collecte';
import { TypeCollecteBadge } from '@/components/collecte/type-collecte-badge';
import {
  ACTION_DESTRUCTIVE_CONTOUR,
  BadgeTypeCollecte,
  BlocHeader,
  EnTetePuce,
} from '@/components/collecte/fiche-blocs';
import { CollecteStatutFrise } from '@/components/admin/collecte-statut-frise';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { CollecteTypeTabs } from '@/components/dashboards/CollecteTypeTabs';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { FilterChips } from '@/components/ui/filter-chips';
import { FilterBar } from '@/components/ui/filter-bar';
import {
  BarreFiltres,
  FiltreCoches,
  FiltreRecherche,
} from '@/components/ui/filtre-en-ligne';
import { Combobox } from '@/components/ui/combobox';
import {
  DateRangePicker,
  PERIODE_VIDE,
  type PeriodeIso,
} from '@/components/ui/date-range-picker';
import { DatePicker } from '@/components/ui/date-picker';
import { TimePicker } from '@/components/ui/time-picker';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Pagination } from '@/components/ui/pagination';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { FormError } from '@/components/ui/form-error';
import { AlertBar } from '@/components/ui/alert-bar';
import { ToastProvider, useToast } from '@/components/ui/toast';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHero } from '@/components/ui/page-hero';
import {
  Card,
  CardClickable,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { StatCard, StatCardGrid } from '@/components/ui/stat-card';
import { KpiCockpitCard } from '@/components/dashboards/charts/cockpit/KpiCockpitCard';
import { Timeline, TimelineItem } from '@/components/ui/timeline';
import { TourneeCard } from '@/components/ui/tournee-card';
import { PackAGIndicator } from '@/components/ui/pack-ag-indicator';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { Modal } from '@/components/ui/modal';
import { Sheet } from '@/components/ui/sheet';
import { authLienClass } from '@/components/auth/auth-card';

// ─── Gabarits de la vitrine ──────────────────────────────────────────────────

function Section({
  id,
  titre,
  refs,
  children,
}: {
  id: string;
  titre: string;
  /** Lignes de l'inventaire concernées (ex. « B1, B2 »). */
  refs: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      data-capture={id}
      className="scroll-mt-8 space-y-5 rounded-savr-lg border border-savr-neutral-200 bg-savr-white p-6"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-savr-neutral-100 pb-3">
        <h2 className="text-xl font-extrabold tracking-[-0.02em] text-savr-neutral-900">
          {titre}
        </h2>
        <span className="text-xs font-semibold uppercase tracking-wide text-savr-neutral-500">
          Inventaire : {refs}
        </span>
      </header>
      {children}
    </section>
  );
}

// Deux colonnes : la primitive DS à gauche, les recettes ad hoc trouvées dans
// l'app à droite (chaque ligne = une recette distincte relevée).
function Duo({
  ds,
  adhoc,
  note,
}: {
  ds: React.ReactNode;
  adhoc: React.ReactNode;
  note?: string;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-3 rounded-savr-md border border-savr-success/40 bg-savr-success-subtle/40 p-4">
        <p className="text-xs font-bold uppercase tracking-wide text-savr-success-strong">
          Primitive DS (source unique)
        </p>
        {ds}
      </div>
      <div className="space-y-3 rounded-savr-md border border-savr-warning/40 bg-savr-warning-subtle/40 p-4">
        <p className="text-xs font-bold uppercase tracking-wide text-savr-warning-strong">
          Recettes ad hoc trouvées dans l&apos;app
        </p>
        {adhoc}
        {note && <p className="text-xs text-savr-neutral-600">{note}</p>}
      </div>
    </div>
  );
}

function Ligne({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="w-44 shrink-0 text-xs text-savr-neutral-500">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function Swatches({ titre, classes }: { titre: string; classes: string[] }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold text-savr-neutral-700">
        {titre}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {classes.map((c) => (
          <div key={c} className="w-16 text-center">
            <div
              className={`h-10 rounded-savr-sm border border-savr-neutral-200 ${c}`}
            />
            <span className="block truncate text-[10px] text-savr-neutral-500">
              {c.replace('bg-savr-', '')}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Données factices ────────────────────────────────────────────────────────

const STATUTS = [
  'brouillon',
  'programmee',
  'validee',
  'en_cours',
  'realisee',
  'realisee_sans_collecte',
  'cloturee',
  'annulation_demandee',
  'annulee',
  'rejetee_par_prestataire',
] as const;

interface LigneDemo {
  id: string;
  reference: string;
  type: string;
  statut: string;
  poids: number;
}

const LIGNES: LigneDemo[] = [
  {
    id: '1',
    reference: 'CMD-2026-0412',
    type: 'zero_dechet',
    statut: 'cloturee',
    poids: 184,
  },
  {
    id: '2',
    reference: 'CMD-2026-0418',
    type: 'anti_gaspi',
    statut: 'validee',
    poids: 0,
  },
  {
    id: '3',
    reference: 'CMD-2026-0421',
    type: 'zero_dechet',
    statut: 'en_cours',
    poids: 92,
  },
];

const COLONNES: Column<LigneDemo>[] = [
  { key: 'reference', header: 'Référence', sortable: true },
  {
    key: 'type',
    header: 'Type',
    render: (r) => <TypeCollecteBadge type={r.type} />,
  },
  {
    key: 'statut',
    header: 'Statut',
    render: (r) => <CollecteStatutBadge statut={r.statut} vue="admin" />,
  },
  {
    key: 'poids',
    header: 'Poids',
    sortable: true,
    render: (r) => `${r.poids} kg`,
  },
];

const LIEUX = [
  { id: 'l1', nom: 'Pavillon Gabriel' },
  { id: 'l2', nom: 'Palais Brongniart' },
  { id: 'l3', nom: 'Carreau du Temple' },
];

const STATUTS_OPTIONS = [
  { value: 'programmee', label: 'Programmée' },
  { value: 'validee', label: 'Validée' },
  { value: 'cloturee', label: 'Clôturée' },
];

// ─── Sections ────────────────────────────────────────────────────────────────

function SectionTokens() {
  const echelle = (base: string) =>
    ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950']
      .map((n) => `bg-savr-${base}-${n}`)
      .filter(Boolean);
  return (
    <Section id="tokens" titre="A. Tokens" refs="A1 à A10">
      <Swatches
        titre="Primary (navy)"
        classes={[
          'bg-savr-primary-50',
          'bg-savr-primary-100',
          'bg-savr-primary-200',
          'bg-savr-primary-300',
          'bg-savr-primary-400',
          'bg-savr-primary-500',
          'bg-savr-primary-600',
          'bg-savr-primary-700',
          'bg-savr-primary-800',
          'bg-savr-primary-900',
          'bg-savr-primary-950',
        ]}
      />
      <Swatches
        titre="Accent (orange)"
        classes={[
          'bg-savr-accent-50',
          'bg-savr-accent-100',
          'bg-savr-accent-200',
          'bg-savr-accent-300',
          'bg-savr-accent-400',
          'bg-savr-accent-500',
          'bg-savr-accent-600',
          'bg-savr-accent-700',
          'bg-savr-accent-800',
          'bg-savr-accent-900',
          'bg-savr-accent-950',
        ]}
      />
      <Swatches
        titre="Neutres tintés navy"
        classes={[
          'bg-savr-neutral-50',
          'bg-savr-neutral-100',
          'bg-savr-neutral-200',
          'bg-savr-neutral-300',
          'bg-savr-neutral-400',
          'bg-savr-neutral-500',
          'bg-savr-neutral-600',
          'bg-savr-neutral-700',
          'bg-savr-neutral-800',
          'bg-savr-neutral-900',
          'bg-savr-neutral-950',
        ]}
      />
      <Swatches
        titre="Sémantique (subtle / base / strong)"
        classes={[
          'bg-savr-success-subtle',
          'bg-savr-success',
          'bg-savr-success-strong',
          'bg-savr-warning-subtle',
          'bg-savr-warning',
          'bg-savr-warning-strong',
          'bg-savr-error-subtle',
          'bg-savr-error',
          'bg-savr-error-strong',
          'bg-savr-info-subtle',
          'bg-savr-info',
          'bg-savr-info-strong',
        ]}
      />
      <Swatches
        titre="Data-viz (ordre des séries)"
        classes={[
          'bg-savr-dataviz-1',
          'bg-savr-dataviz-2',
          'bg-savr-dataviz-3',
          'bg-savr-dataviz-4',
          'bg-savr-dataviz-5',
          'bg-savr-dataviz-6',
        ]}
      />
      {/* Les échelles ci-dessus sont écrites en littéral (Tailwind ne génère
          que les classes présentes dans le source) ; `echelle` sert au test
          de cohérence ci-dessous. */}
      <p className="text-[10px] text-savr-neutral-400">
        {echelle('primary').length} nuances par échelle de marque.
      </p>
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <p className="mb-1.5 text-xs font-semibold text-savr-neutral-700">
            Rayons
          </p>
          <div className="flex items-end gap-2">
            {(
              [
                ['sm 4', 'rounded-savr-sm'],
                ['md 8', 'rounded-savr-md'],
                ['lg 12', 'rounded-savr-lg'],
                ['xl 14', 'rounded-savr-xl'],
                ['full', 'rounded-savr-full'],
              ] as const
            ).map(([l, c]) => (
              <div key={c} className="text-center">
                <div
                  className={`h-12 w-12 border-2 border-savr-primary-700 bg-savr-primary-50 ${c}`}
                />
                <span className="text-[10px] text-savr-neutral-500">{l}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-semibold text-savr-neutral-700">
            Ombres
          </p>
          <div className="flex gap-4">
            {(
              [
                ['sm', 'shadow-savr-sm'],
                ['md', 'shadow-savr-md'],
                ['lg', 'shadow-savr-lg'],
              ] as const
            ).map(([l, c]) => (
              <div key={c} className="text-center">
                <div
                  className={`h-12 w-16 rounded-savr-md border border-savr-neutral-200 bg-savr-white ${c}`}
                />
                <span className="text-[10px] text-savr-neutral-500">{l}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-semibold text-savr-neutral-700">
            Échelle typographique (Nunito)
          </p>
          <div className="space-y-0.5 leading-tight">
            <p className="text-4xl font-extrabold tracking-[-0.02em]">4xl 38</p>
            <p className="text-2xl font-bold tracking-[-0.02em]">2xl 24</p>
            <p className="text-lg font-medium">lg 18</p>
            <p className="text-base">base 16</p>
            <p className="text-sm">sm 14</p>
            <p className="text-xs">xs 12</p>
          </div>
        </div>
      </div>
      <Duo
        ds={
          <>
            <Ligne label="Texte courant (A8)">
              <span className="text-sm text-savr-neutral-500">
                text-sm neutral-500 (×95)
              </span>
              <span className="text-xs text-savr-neutral-500">
                text-xs neutral-500 (×76)
              </span>
            </Ligne>
          </>
        }
        adhoc={
          <>
            <Ligne label="3 gris pour le même rôle">
              <span className="text-sm text-savr-neutral-400">neutral-400</span>
              <span className="text-sm text-savr-neutral-500">neutral-500</span>
              <span className="text-sm text-savr-neutral-600">neutral-600</span>
            </Ligne>
            <Ligne label="Tailles arbitraires (A6)">
              <span className="text-[13px] text-savr-neutral-500">
                text-[13px] ×34
              </span>
              <span className="text-[11px] text-savr-neutral-500">
                text-[11px] ×28
              </span>
              <span className="text-[10px] text-savr-neutral-500">
                text-[10px] ×11
              </span>
            </Ligne>
            <Ligne label="Palette Tailwind brute (A1)">
              <span className="rounded-md bg-red-50 px-2 py-0.5 text-sm text-red-700">
                red-50 / red-700
              </span>
              <span className="rounded-md bg-amber-50 px-2 py-0.5 text-sm text-amber-800">
                amber-50 / amber-800
              </span>
              <span className="text-sm text-neutral-500">
                neutral-500 (gris pur)
              </span>
            </Ligne>
          </>
        }
        note="88 classes de palette Tailwind brute dans 12 fichiers ; 54 rayons et 5 ombres hors token."
      />
    </Section>
  );
}

function SectionBoutons() {
  return (
    <Section id="boutons" titre="B. Boutons, actions, liens" refs="B1 à B11">
      <Ligne label="Variants">
        <Button variant="primary">Primaire</Button>
        <Button variant="secondary">Secondaire</Button>
        <Button variant="accent">Accent</Button>
        <Button variant="destructive">Destructif</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="link">Lien (0 usage)</Button>
        <Button disabled>Désactivé</Button>
      </Ligne>
      <Ligne label="Tailles">
        <Button size="sm">sm 32</Button>
        <Button size="md">md 40 / 44</Button>
        <Button size="lg">lg 44</Button>
        <Button size="icon" aria-label="Ajouter">
          <Plus className="h-5 w-5" />
        </Button>
      </Ligne>
      <Ligne label="IconButton">
        <IconButton aria-label="Modifier">
          <Pencil />
        </IconButton>
        <IconButton aria-label="Supprimer" variant="destructive">
          <Trash2 />
        </IconButton>
        <IconButton aria-label="Ajouter" variant="primary">
          <Plus />
        </IconButton>
        <IconButton aria-label="Menu" size="sm">
          <MoreHorizontal />
        </IconButton>
      </Ligne>

      <Duo
        ds={
          <>
            <Ligne label="Chargement (B1, proposé)">
              <Button disabled aria-busy>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Enregistrement…
              </Button>
            </Ligne>
            <Ligne label="Destructif secondaire (B3, proposé)">
              <Button
                variant="secondary"
                className={ACTION_DESTRUCTIVE_CONTOUR}
              >
                Désactiver
              </Button>
              <Button variant="ghost" className="text-savr-error-strong">
                Retirer
              </Button>
            </Ligne>
            <Ligne label="Lien texte (B2)">
              <Button variant="link">Télécharger le bordereau</Button>
            </Ligne>
            <Ligne label="Icône seule (B4)">
              <IconButton aria-label="Fermer">
                <X />
              </IconButton>
              <IconButton aria-label="Supprimer" variant="destructive">
                <Trash2 />
              </IconButton>
            </Ligne>
          </>
        }
        adhoc={
          <>
            <Ligne label="Chargement : 52 ternaires">
              <Button disabled>Enregistrement…</Button>
              <Button disabled>…</Button>
              <Button disabled>Enregistrer</Button>
              <span className="text-xs text-savr-neutral-500">
                (désactivé sans libellé ×5)
              </span>
            </Ligne>
            <Ligne label="Destructif : 4 rendus">
              <Button
                variant="ghost"
                size="sm"
                className="text-savr-error text-xs"
              >
                Supprimer
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="text-savr-error hover:bg-red-50 hover:border-savr-error"
              >
                Supprimer
              </Button>
              <Button
                variant="secondary"
                className={ACTION_DESTRUCTIVE_CONTOUR}
              >
                Annuler la collecte
              </Button>
              <Button
                variant="secondary"
                className="border-savr-warning-strong text-savr-warning-strong hover:bg-savr-white"
              >
                Contour warning
              </Button>
            </Ligne>
            <Ligne label="Liens : 34 occurrences">
              <a
                href="#boutons"
                className="text-xs text-savr-primary-700 underline"
              >
                text-xs souligné
              </a>
              <a
                href="#boutons"
                className="font-medium text-savr-primary-700 hover:underline"
              >
                primary-700 hover
              </a>
              <a
                href="#boutons"
                className="text-savr-primary-600 hover:underline"
              >
                primary-600 hover
              </a>
              <a href="#boutons" className={authLienClass}>
                authLienClass
              </a>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-sm text-savr-primary-700 hover:underline"
              >
                <Download className="h-4 w-4" /> bouton-lien
              </button>
            </Ligne>
            <Ligne label="Icônes seules : 13 brutes">
              <button
                type="button"
                aria-label="Fermer"
                className="flex h-9 w-9 items-center justify-center rounded-savr-md text-savr-neutral-600 hover:bg-savr-neutral-100"
              >
                <X className="h-5 w-5" />
              </button>
              <button
                type="button"
                aria-label="Ouvrir"
                className="inline-flex text-savr-neutral-400 hover:text-savr-primary-700"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                aria-label="Supprimer"
                className="p-2 text-savr-neutral-400 hover:text-savr-error-strong"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </Ligne>
          </>
        }
        note="Les 2 recettes destructives de gauche sont les variants à créer (ghost-destructive, outline-destructive) ; aujourd'hui la constante vit dans components/collecte/fiche-blocs.tsx."
      />
    </Section>
  );
}

function SectionBadges() {
  return (
    <Section id="badges" titre="C. Badges et libellés d'enums" refs="C1 à C15">
      <Ligne label="Badge (7 variants)">
        <Badge variant="success">Succès</Badge>
        <Badge variant="warning">Warning</Badge>
        <Badge variant="error">Erreur</Badge>
        <Badge variant="info">Info</Badge>
        <Badge variant="action">Action requise</Badge>
        <Badge variant="neutral">Neutre</Badge>
        <Badge variant="primary">Primaire</Badge>
        <Badge variant="success" dot={false}>
          Sans point
        </Badge>
      </Ligne>
      <Ligne label="Statut collecte · vue admin">
        {STATUTS.map((s) => (
          <CollecteStatutBadge key={s} statut={s} vue="admin" />
        ))}
      </Ligne>
      <Ligne label="Statut collecte · vue client">
        {STATUTS.map((s) => (
          <CollecteStatutBadge key={s} statut={s} vue="client" />
        ))}
      </Ligne>
      <Ligne label="StatusCollecte + timeline">
        <StatusCollecte statut="en_cours" showTimeline />
      </Ligne>
      <Ligne label="Frise admin (C1)">
        <div className="w-full max-w-xl">
          <CollecteStatutFrise statut="en_cours" />
        </div>
      </Ligne>

      <Duo
        ds={
          <>
            <Ligne label="Type ZD/AG (C2, à trancher Q1)">
              <BadgeTypeCollecte type="zero_dechet" />
              <BadgeTypeCollecte type="anti_gaspi" />
              <span className="text-xs text-savr-neutral-500">
                (option a : ZD navy / AG orange, §2.4)
              </span>
            </Ligne>
            <Ligne label="Actif / inactif (C6)">
              <Badge variant="success">Actif</Badge>
              <Badge variant="neutral">Inactif</Badge>
            </Ligne>
            <Ligne label="Puce d'en-tête">
              <EnTetePuce>MTS-1</EnTetePuce>
            </Ligne>
          </>
        }
        adhoc={
          <>
            <Ligne label="Type ZD/AG : 4 codes couleur">
              <TypeCollecteBadge type="zero_dechet" />
              <TypeCollecteBadge type="anti_gaspi" />
              <Badge variant="primary">ZD</Badge>
              <Badge variant="action">AG</Badge>
              <span className="rounded-savr-md border border-savr-success bg-green-50 px-2 py-0.5 text-xs">
                ZD (sous-bloc)
              </span>
              <span className="rounded-savr-md border border-savr-primary-400 bg-savr-primary-50 px-2 py-0.5 text-xs">
                AG (sous-bloc)
              </span>
            </Ligne>
            <Ligne label="Inactif : 3 libellés">
              <Badge variant="neutral">Inactif</Badge>
              <Badge variant="neutral">Désactivé</Badge>
              <Badge variant="neutral">Suspendu</Badge>
            </Ligne>
            <Ligne label="Enum brut affiché (bug B2)">
              <Badge variant="neutral">payee</Badge>
              <Badge variant="neutral">epuise</Badge>
              <Badge variant="neutral">traiteur_manager</Badge>
            </Ligne>
            <Ligne label="Compteur : 3 recettes (C15)">
              <span className="rounded-full bg-savr-error px-1.5 py-0.5 text-xs font-semibold text-savr-white">
                3
              </span>
              <span className="rounded-full bg-savr-error px-1.5 py-0.5 text-[10px] font-extrabold uppercase text-savr-white">
                3
              </span>
              <span className="rounded-full bg-savr-error-strong px-1.5 py-0.5 text-xs font-semibold text-savr-white">
                3
              </span>
            </Ligne>
            <Ligne label="Taille forcée (C14)">
              <Badge variant="info" className="text-xs">
                text-xs
              </Badge>
              <Badge variant="info" className="text-[11px]">
                text-[11px]
              </Badge>
              <Badge variant="info" className="text-[10px]">
                text-[10px]
              </Badge>
            </Ligne>
          </>
        }
        note="≈ 45 mappings enum → libellé dupliqués (statut facture ×4, type collecte ×13, rôles ×4…) ; cible = lib/libelles/*.ts."
      />
    </Section>
  );
}

function SectionFiltres() {
  const [type, setType] = useState('tous');
  const [typeTabs, setTypeTabs] = useState<'zero_dechet' | 'anti_gaspi'>(
    'zero_dechet',
  );
  const [chip, setChip] = useState('tous');
  const [lieux, setLieux] = useState<string[]>(['l1']);
  const [periode, setPeriode] = useState<PeriodeIso>(PERIODE_VIDE);
  const [recherche, setRecherche] = useState('');
  const [statut, setStatut] = useState<string | null>(null);
  const [pill, setPill] = useState('ouvertes');
  const [onglet, setOnglet] = useState<'infos' | 'membres'>('infos');
  const tabCls = (t: 'infos' | 'membres') =>
    `px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
      onglet === t
        ? 'border-savr-primary-600 text-savr-primary-700'
        : 'border-transparent text-savr-neutral-500 hover:text-savr-neutral-700'
    }`;

  return (
    <Section
      id="filtres"
      titre="D. Filtres, recherche, segmentation"
      refs="D1 à D11"
    >
      <p className="text-sm text-savr-neutral-600">
        Barre de filtres complète (`FilterBar` : onglets + segment + filtres en
        ligne + compteur + réinitialiser). Seul 1 écran sur 18 l&apos;utilise en
        entier (D5).
      </p>
      <FilterBar
        tabs={
          <Tabs defaultValue="programmees">
            <TabsList>
              <TabsTrigger value="programmees">Programmées</TabsTrigger>
              <TabsTrigger value="historique">Historique</TabsTrigger>
            </TabsList>
          </Tabs>
        }
        toggle={
          <ToggleGroup
            type="single"
            value={type}
            onValueChange={(v) => v && setType(v)}
          >
            <ToggleGroupItem value="tous">Toutes</ToggleGroupItem>
            <ToggleGroupItem value="zd">Zéro Déchet</ToggleGroupItem>
            <ToggleGroupItem value="ag">Anti-Gaspi</ToggleGroupItem>
          </ToggleGroup>
        }
        count="16 collectes correspondent aux filtres"
        actif={lieux.length > 0 || periode.from !== ''}
        onReset={() => {
          setLieux([]);
          setPeriode(PERIODE_VIDE);
          setRecherche('');
        }}
      >
        <FiltreRecherche
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          placeholder="Rechercher…"
        />
        <DateRangePicker
          titre="Période"
          value={periode}
          onChange={setPeriode}
        />
        <FiltreCoches
          label="Lieu"
          options={LIEUX}
          selected={lieux}
          onChange={setLieux}
        />
        <Combobox
          titre="Statut"
          options={STATUTS_OPTIONS}
          value={statut}
          onChange={setStatut}
          placeholder="Tous"
        />
      </FilterBar>

      <p className="text-sm text-savr-neutral-600">
        Bandeau seul (`BarreFiltres surface=&quot;page&quot;`, dashboards).
      </p>
      <BarreFiltres surface="page" onReset={() => setPeriode(PERIODE_VIDE)}>
        <DateRangePicker
          titre="Période"
          value={periode}
          onChange={setPeriode}
        />
      </BarreFiltres>

      <Duo
        ds={
          <>
            <Ligne label="Segment ZD/AG (D1)">
              <ToggleGroup
                type="single"
                value={type}
                onValueChange={(v) => v && setType(v)}
              >
                <ToggleGroupItem value="tous">Toutes</ToggleGroupItem>
                <ToggleGroupItem value="zd">Zéro Déchet</ToggleGroupItem>
                <ToggleGroupItem value="ag">Anti-Gaspi</ToggleGroupItem>
              </ToggleGroup>
            </Ligne>
            <Ligne label="Onglets (D4)">
              <Tabs defaultValue="a">
                <TabsList>
                  <TabsTrigger value="a">Informations</TabsTrigger>
                  <TabsTrigger value="b">Membres</TabsTrigger>
                </TabsList>
                <TabsContent value="a" className="hidden" />
              </Tabs>
            </Ligne>
            <Ligne label="Pastilles à compteur (D3)">
              <FilterChips
                chips={[
                  { key: 'tous', label: 'Toutes' },
                  { key: 'nt', label: 'Non transmises', count: 4 },
                  { key: 'ag', label: 'AG en attente', count: 2 },
                ]}
                activeKey={chip}
                onSelect={setChip}
                ariaLabel="Filtres rapides"
              />
            </Ligne>
            <Ligne label="Recherche (D7)">
              <FiltreRecherche
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
                placeholder="Rechercher…"
              />
            </Ligne>
          </>
        }
        adhoc={
          <>
            <Ligne label="CollecteTypeTabs (clone ×6)">
              <CollecteTypeTabs value={typeTabs} onChange={setTypeTabs} />
            </Ligne>
            <Ligne label="Pilules admin collectes">
              {['Toutes', 'AG', 'ZD'].map((l) => (
                <button
                  key={l}
                  type="button"
                  aria-pressed={l === 'Toutes'}
                  className={`rounded-savr-full px-5 py-2 text-sm font-bold transition-colors duration-[120ms] ${
                    l === 'Toutes'
                      ? 'bg-savr-primary-700 text-savr-white'
                      : 'border border-savr-neutral-300 bg-savr-white text-savr-neutral-600'
                  }`}
                >
                  {l}
                </button>
              ))}
            </Ligne>
            <Ligne label="Pilules alertes (hors tokens)">
              {['ouvertes', 'resolues', 'toutes'].map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setPill(k)}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                    pill === k
                      ? 'bg-savr-primary-600 text-white'
                      : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                  }`}
                >
                  {k}
                </button>
              ))}
            </Ligne>
            <Ligne label="tabCls (copié ×2)">
              <div className="flex border-b border-savr-neutral-200">
                <button
                  type="button"
                  className={tabCls('infos')}
                  onClick={() => setOnglet('infos')}
                >
                  Informations
                </button>
                <button
                  type="button"
                  className={tabCls('membres')}
                  onClick={() => setOnglet('membres')}
                >
                  Membres
                </button>
              </div>
            </Ligne>
            <Ligne label="Chips de sélection (chipClass)">
              <span className="inline-flex min-h-[40px] items-center rounded-savr-full border border-savr-primary-700 bg-savr-primary-700 px-4 text-sm font-medium text-savr-white">
                Camion 16 m³
              </span>
              <span className="inline-flex min-h-[40px] items-center rounded-savr-full border border-savr-neutral-300 bg-savr-white px-4 text-sm font-medium text-savr-neutral-700">
                Camion 20 m³
              </span>
            </Ligne>
            <Ligne label="Recherche brute (combobox)">
              <div className="flex h-10 w-64 items-center rounded-savr-md border border-savr-neutral-300 bg-savr-white px-3 text-sm text-savr-neutral-400">
                <Search className="mr-2 h-4 w-4" /> Rechercher un lieu…
              </div>
            </Ligne>
          </>
        }
        note="6 façons de construire une barre de filtres ; 4 implémentations du segment ZD/AG ; état URL recodé 5 fois, 7 écrans perdent leurs filtres au rechargement (D6)."
      />
    </Section>
  );
}

function SectionTableaux() {
  const [page, setPage] = useState(2);
  return (
    <Section id="tableaux" titre="E. Tableaux et pagination" refs="E1 à E6">
      <DataTable
        columns={COLONNES}
        data={LIGNES}
        keyExtractor={(r) => r.id}
        clientSort
      />
      <Duo
        ds={
          <Ligne label="Pagination (E2)">
            <Pagination page={page} pageCount={7} onPageChange={setPage} />
          </Ligne>
        }
        adhoc={
          <>
            <Ligne label="Pied maison registre">
              <Button variant="ghost" size="sm">
                Précédent
              </Button>
              <span className="text-sm text-savr-neutral-600">page 2 / 7</span>
              <Button variant="ghost" size="sm">
                Suivant
              </Button>
            </Ligne>
            <Ligne label="<table> brute (registre)">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-savr-neutral-500">
                  <tr>
                    <th className="py-1">Flux</th>
                    <th className="py-1 text-right">kg</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-savr-neutral-100">
                    <td className="py-1">Biodéchets</td>
                    <td className="py-1 text-right">120</td>
                  </tr>
                  <tr className="border-t border-savr-neutral-200 font-medium">
                    <td className="py-1">Total</td>
                    <td className="py-1 text-right">184</td>
                  </tr>
                </tbody>
              </table>
            </Ligne>
          </>
        }
        note="3 habillages de pagination, 3 seuils d'affichage, taille de page 50 écrite 16 fois ; 4 <table> brutes et 4 pseudo-tableaux."
      />
    </Section>
  );
}

function SectionFormulaires() {
  const [date, setDate] = useState('');
  const [heure, setHeure] = useState('');
  const [coche, setCoche] = useState(true);
  const [actif, setActif] = useState(true);
  return (
    <Section id="formulaires" titre="F. Formulaires" refs="F1 à F11">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <FormField label="Nom du lieu" htmlFor="f-nom" required>
          <Input id="f-nom" placeholder="Pavillon Gabriel" />
        </FormField>
        <FormField
          label="SIREN"
          htmlFor="f-siren"
          required
          error="SIREN invalide (9 chiffres attendus)"
        >
          <Input id="f-siren" defaultValue="12345" error />
        </FormField>
        <FormField
          label="Email"
          htmlFor="f-email"
          hint="Adresse professionnelle"
        >
          <Input id="f-email" defaultValue="contact@traiteur.fr" success />
        </FormField>
        <FormField label="Date de collecte" htmlFor="f-date">
          <DatePicker id="f-date" value={date} onChange={setDate} />
        </FormField>
        <FormField label="Heure" htmlFor="f-heure">
          <TimePicker id="f-heure" value={heure} onChange={setHeure} />
        </FormField>
        <FormField label="Statut" htmlFor="f-statut">
          <Combobox
            id="f-statut"
            options={STATUTS_OPTIONS}
            placeholder="Choisir…"
          />
        </FormField>
        <FormField
          label="Consignes"
          htmlFor="f-notes"
          className="sm:col-span-2"
        >
          <Textarea id="f-notes" rows={2} placeholder="Accès par le quai…" />
        </FormField>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Checkbox
              id="f-cb"
              checked={coche}
              onCheckedChange={(v) => setCoche(v === true)}
            />
            <Label htmlFor="f-cb" className="mb-0">
              Collecte récurrente
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="f-sw" checked={actif} onCheckedChange={setActif} />
            <Label htmlFor="f-sw" className="mb-0">
              Auto-accept
            </Label>
          </div>
          <FormError>Erreur de formulaire autonome</FormError>
        </div>
      </div>
      <Duo
        ds={
          <Ligne label="Label DS (F1)">
            <Label htmlFor="x1" required>
              text-sm font-semibold neutral-700
            </Label>
          </Ligne>
        }
        adhoc={
          <>
            <Ligne label="21 recettes de <label>">
              <label className="mb-1 block text-sm font-medium text-savr-neutral-700">
                font-medium mb-1 (×8)
              </label>
              <label className="space-y-1 text-xs text-savr-neutral-500">
                text-xs gris (×5)
              </label>
            </Ligne>
            <Ligne label="Checkbox native (F2)">
              <label className="flex items-center gap-2 text-sm text-savr-neutral-700">
                <input type="checkbox" defaultChecked /> native sans classe (×4)
              </label>
            </Ligne>
            <Ligne label="Obligatoire : 3 conventions (F7)">
              <span className="text-sm">Nom *</span>
              <span className="text-sm">Nom (obligatoire)</span>
              <span className="text-sm">Téléphone (facultatif)</span>
            </Ligne>
          </>
        }
        note="9 recettes de grille 2 colonnes (7 non responsives) ; ni zod ni react-hook-form, 4 validate() maison, regex SIREN ×5."
      />
    </Section>
  );
}

function BoutonsToast() {
  const { toast } = useToast();
  return (
    <Ligne label="Toast (H1, 0 usage)">
      <Button
        variant="secondary"
        size="sm"
        data-testid="toast-succes"
        onClick={() =>
          toast({
            variant: 'success',
            title: 'Collecte enregistrée',
            description: 'Le transporteur a été notifié.',
          })
        }
      >
        Toast succès
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={() =>
          toast({
            variant: 'error',
            title: 'Échec de l’enregistrement',
            description: 'Réessayez dans un instant.',
          })
        }
      >
        Toast erreur
      </Button>
    </Ligne>
  );
}

function SectionFeedback() {
  return (
    <Section id="feedback" titre="H. Feedback et états système" refs="H1 à H6">
      <div className="space-y-2">
        <AlertBar variant="warn" icon={<AlertTriangle />}>
          Pack AG faible : 2 collectes restantes.
        </AlertBar>
        <AlertBar variant="err" icon={<AlertTriangle />}>
          Impossible de transmettre la collecte au transporteur.
        </AlertBar>
        <AlertBar variant="info" icon={<Info />}>
          La collecte sera confirmée par le transporteur sous 24 h.
        </AlertBar>
        <AlertBar variant="neutral">Aucune action requise.</AlertBar>
      </div>
      <BoutonsToast />
      <Duo
        ds={
          <>
            <Ligne label="EmptyState (H4)">
              <EmptyState
                icon={<Inbox />}
                title="Aucune collecte programmée"
                description="Programmez votre première collecte."
                action={{ label: 'Programmer une collecte', onClick: () => {} }}
                className="py-6"
              />
            </Ligne>
            <Ligne label="Skeleton (H3)">
              <div className="w-64 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-10 w-full" />
              </div>
            </Ligne>
          </>
        }
        adhoc={
          <>
            <Ligne label="28 bandeaux hors AlertBar (H2)">
              <div className="w-full space-y-2">
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  Tailwind brut : red-50 / red-200 / red-700
                </div>
                <div className="rounded-savr-md border border-savr-error bg-red-50 px-3 py-2 text-sm text-savr-error">
                  Hybride : bg-red-50 + text-savr-error
                </div>
                <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
                  Succès maison (AlertBar n&apos;a pas de variant success)
                </div>
                <div className="rounded-md border border-savr-warning bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Warning amber-50 / amber-800
                </div>
              </div>
            </Ligne>
            <Ligne label="27 « Chargement… » (H3)">
              <p className="text-sm text-savr-neutral-500">Chargement…</p>
              <p className="p-4 text-sm">Chargement… (sans couleur)</p>
            </Ligne>
            <Ligne label="48 « Aucun… » inline (H4)">
              <p className="text-sm text-savr-neutral-500">Aucune facture.</p>
              <p className="py-10 text-center text-sm text-savr-neutral-500">
                Aucun résultat
              </p>
            </Ligne>
            <Ligne label="Succès texte inline (H1)">
              <p className="text-sm text-savr-success-strong" role="status">
                Modifications enregistrées.
              </p>
              <p className="text-sm text-savr-neutral-600">
                Message succès OU erreur, indiscernable (×4)
              </p>
            </Ligne>
          </>
        }
        note="ToastProvider n'est monté nulle part dans l'app ; 0 loading.tsx et 0 error.tsx de route."
      />
    </Section>
  );
}

function SectionEnTetes() {
  return (
    <Section id="en-tetes" titre="I. En-têtes, cards, KPI" refs="I1 à I9, G3">
      <PageHero
        title="Collectes"
        subtitle="16 collectes · 3 lieux"
        actions={
          <>
            <Button variant="secondary" size="sm">
              <Download className="h-4 w-4" /> Export CSV
            </Button>
            <Button variant="accent" size="sm">
              <Plus className="h-4 w-4" /> Programmer une collecte
            </Button>
          </>
        }
      />
      <Duo
        ds={
          <>
            <Ligne label="PageHero (I1)">
              <span className="text-xs text-savr-neutral-500">
                ci-dessus — 10 pages sur 55
              </span>
            </Ligne>
            <Ligne label="Breadcrumb (B8)">
              <Breadcrumb
                items={[
                  { label: 'Lieux', href: '#en-tetes' },
                  { label: 'Pavillon Gabriel' },
                ]}
              />
            </Ligne>
            <Ligne label="BlocHeader (F4)">
              <BlocHeader icon={Leaf} title="Flux et pesées" />
            </Ligne>
          </>
        }
        adhoc={
          <Ligne label="45 h1 faits main, 7 recettes">
            <div className="space-y-2">
              <h1 className="text-2xl font-bold text-savr-primary-800">
                text-2xl bold primary-800 (×23)
              </h1>
              <h1 className="text-2xl font-bold text-savr-neutral-900">
                text-2xl bold neutral-900 (×8)
              </h1>
              <h1 className="text-xl font-semibold text-savr-neutral-900">
                text-xl semibold neutral-900 (×3)
              </h1>
              <h1 className="text-2xl font-semibold text-savr-primary-950">
                text-2xl semibold primary-950 (×2)
              </h1>
            </div>
          </Ligne>
        }
        note="Le h1 de top-bar.tsx s'ajoute à celui de la page : risque de double h1."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Card DS</CardTitle>
            <CardDescription>
              Bordure neutral-200, radius md, ombre none, padding 24.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-savr-neutral-700">
            Contenu de la carte.
          </CardContent>
        </Card>
        <CardClickable className="p-6">
          <p className="text-lg font-semibold text-savr-neutral-900">
            CardClickable
          </p>
          <p className="text-sm text-savr-neutral-500">
            Hover : bordure primary-200 + ombre sm.
          </p>
        </CardClickable>
        <div className="rounded-savr-lg border border-savr-neutral-200 bg-savr-white p-6 shadow-savr-sm">
          <p className="text-lg font-semibold text-savr-neutral-900">
            Carte « cockpit » inline (I4)
          </p>
          <p className="text-sm text-savr-neutral-500">
            radius lg + shadow sm, recopiée ×5 hors Card (I5 : lg contre la
            règle « md partout »).
          </p>
        </div>
      </div>

      <p className="text-sm text-savr-neutral-600">
        KPI : 3 familles concurrentes (I6) — StatCard DS (1 usage),
        KpiCockpitCard (55 usages), tuile inline admin collectes.
      </p>
      <StatCardGrid desktopCols={4}>
        <StatCard
          label="Tonnage collecté"
          value="48,6 t"
          variation={{ value: 12, label: 'vs N-1' }}
          icon={<Leaf />}
        />
        <KpiCockpitCard
          label="Repas donnés"
          value="18 700"
          dotColor="var(--color-savr-accent-500)"
          variationPct={8.4}
          sparkPoints={[4, 6, 5, 8, 9, 12, 11]}
          sparkColor="var(--color-savr-accent-500)"
        />
        <div className="flex items-center gap-4 rounded-savr-lg border border-savr-neutral-200 bg-savr-white px-5 py-4 text-left shadow-savr-sm">
          <span className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-savr-md bg-savr-warning-subtle text-savr-warning-strong">
            <UtensilsCrossed className="h-6 w-6" aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="text-3xl font-extrabold leading-none tracking-tight text-savr-neutral-900 tabular-nums">
              4
            </div>
            <div className="mt-1 text-sm font-bold text-savr-neutral-800">
              AG à attribuer
            </div>
            <div className="text-xs font-semibold text-savr-neutral-500">
              KpiTile inline
            </div>
          </div>
        </div>
        <div className="rounded-savr-md border border-savr-neutral-200 bg-savr-white p-4">
          <div className="text-xs text-savr-neutral-500">Taux de recyclage</div>
          <div className="text-xl font-bold">78.4 %</div>
          <div className="text-xs text-savr-neutral-400">
            inline traiteurs/[id] (toFixed, point anglais — bug B6)
          </div>
        </div>
      </StatCardGrid>

      <div className="grid gap-4 lg:grid-cols-3">
        <div>
          <p className="mb-2 text-xs font-semibold text-savr-neutral-700">
            Timeline
          </p>
          <Timeline>
            <TimelineItem>
              <span className="text-xs text-savr-neutral-500">
                12/09/2026 · 08:14
              </span>
              <p className="text-sm text-savr-neutral-900">Collecte validée</p>
            </TimelineItem>
            <TimelineItem>
              <span className="text-xs text-savr-neutral-500">
                13/09/2026 · 02:40
              </span>
              <p className="text-sm text-savr-neutral-900">Pesées reçues</p>
            </TimelineItem>
          </Timeline>
        </div>
        <TourneeCard
          camion="Camion 16 m³"
          immatriculation="AB-123-CD"
          chauffeur="M. Durand"
          nbCollectes={3}
          statut={<Badge variant="info">En cours</Badge>}
        />
        <PackAGIndicator total={10} restant={3} label="Pack AG" />
      </div>
    </Section>
  );
}

function SectionModales() {
  const [modal, setModal] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [confirm, setConfirm] = useState(false);
  return (
    <Section id="modales" titre="G. Modales, confirmations" refs="G1 à G5, B5">
      <Ligne label="Ouvrir">
        <Button
          variant="secondary"
          data-testid="ouvrir-modale"
          onClick={() => setModal(true)}
        >
          Modal
        </Button>
        <Button
          variant="secondary"
          data-testid="ouvrir-sheet"
          onClick={() => setSheet(true)}
        >
          Sheet (0 usage)
        </Button>
        <Button
          variant="destructive"
          data-testid="ouvrir-confirm"
          onClick={() => setConfirm(true)}
        >
          Confirmation destructive
        </Button>
      </Ligne>
      <p className="text-sm text-savr-neutral-600">
        Aujourd&apos;hui : 6 `window.confirm()` natifs + 8 modales de
        confirmation recodées (G1) ; pied « Annuler / Valider » recopié 8 fois
        dans le corps (B5). Cible : `ConfirmDialog` + `FormActions`.
      </p>
      <Modal
        open={modal}
        title="Modifier le lieu"
        onClose={() => setModal(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(false)}>
              Annuler
            </Button>
            <Button onClick={() => setModal(false)}>Enregistrer</Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Nom" htmlFor="m-nom" required>
            <Input id="m-nom" defaultValue="Pavillon Gabriel" />
          </FormField>
          <FormField label="Ville" htmlFor="m-ville" required>
            <Input id="m-ville" defaultValue="Paris" />
          </FormField>
        </div>
      </Modal>
      <Modal
        open={confirm}
        title="Annuler la collecte ?"
        onClose={() => setConfirm(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(false)}>
              Retour
            </Button>
            <Button variant="destructive" onClick={() => setConfirm(false)}>
              Annuler la collecte
            </Button>
          </>
        }
      >
        <p className="text-sm text-savr-neutral-700">
          Cette action est irréversible. Le transporteur sera informé.
        </p>
      </Modal>
      <Sheet
        open={sheet}
        title="Détail de la collecte"
        onClose={() => setSheet(false)}
        side="right"
      >
        <p className="text-sm text-savr-neutral-700">
          Panneau latéral prévu par le DS §8 pour le mobile, jamais branché.
        </p>
      </Sheet>
    </Section>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

const SOMMAIRE = [
  ['tokens', 'A. Tokens'],
  ['boutons', 'B. Boutons'],
  ['badges', 'C. Badges'],
  ['filtres', 'D. Filtres'],
  ['tableaux', 'E. Tableaux'],
  ['formulaires', 'F. Formulaires'],
  ['modales', 'G. Modales'],
  ['feedback', 'H. Feedback'],
  ['en-tetes', 'I. En-têtes / KPI'],
] as const;

export default function DesignSystemShowcasePage() {
  return (
    <ToastProvider>
      <main className="mx-auto max-w-[1200px] space-y-8 p-8">
        <header data-capture="intro" className="space-y-3">
          <h1 className="text-3xl font-extrabold tracking-[-0.02em] text-savr-primary-800">
            Vitrine Design System — primitives et recettes ad hoc
          </h1>
          <p className="max-w-3xl text-sm text-savr-neutral-600">
            Page de dev (404 en production). Colonne verte = la primitive
            `components/ui` à conserver comme source unique ; colonne orange =
            les recettes recopiées dans les écrans, relevées dans
            `docs/design-system/RATIONALISATION_UI.md`.
          </p>
          <nav aria-label="Sommaire" className="flex flex-wrap gap-2">
            {SOMMAIRE.map(([id, label]) => (
              <a
                key={id}
                href={`#${id}`}
                className="rounded-savr-full border border-savr-neutral-300 bg-savr-white px-3 py-1 text-xs font-semibold text-savr-neutral-700 hover:border-savr-primary-300"
              >
                {label}
              </a>
            ))}
          </nav>
        </header>
        <SectionTokens />
        <SectionBoutons />
        <SectionBadges />
        <SectionFiltres />
        <SectionTableaux />
        <SectionFormulaires />
        <SectionModales />
        <SectionFeedback />
        <SectionEnTetes />
      </main>
    </ToastProvider>
  );
}
