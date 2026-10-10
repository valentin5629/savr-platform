'use client';

import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import {
  ArrowRight,
  CheckCircle2,
  Eye,
  FileText,
  MoreHorizontal,
  Package,
  Recycle,
  Scale,
  Send,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { TypeCollecteBadge } from '@/components/ui/type-collecte-badge';
import { StatusCollecte } from '@/components/ui/status-collecte';
import { statutCollecteAdmin } from '@/lib/statut-collecte-admin';
import { LIBELLE_SANS_EXCEDENT } from '@/lib/statut-collecte-labels';
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownTrigger,
} from '@/components/ui/dropdown';
import { statutTmsDisplay } from '@/lib/statut-tms-labels';
import { estADispatcher } from '@/lib/collectes-chips';
import { cn } from '@/lib/utils';
import { instantParis } from '@savr/shared/src/temps/index.js';
import { formatDateHeure, heureOuMinuit } from '@/lib/format-date-collecte';
import { CelluleVide } from '@/components/ui/data-grid';
import { Text } from '@/components/ui/text';
import { fmtEuro, fmtKgAuto, fmtPct } from '@/lib/format';
import { IconButton } from '@/components/ui/icon-button';
import { ROUTES } from '@/lib/routes';

// ── Type de ligne collecte de la liste Admin (§06.06 §3) ──────────────────────
// Superset du SELECT liste : les champs transporteur_nom / montant_ht / pack sont
// optionnels → la ligne se rend même si la route ne les câble pas encore.
interface RapportRse {
  disponible_a: string | null;
  genere_at: string | null;
  regenere_at: string | null;
  consulte_par_user_at: string | null;
  version: number | null;
}

export interface CollecteRow {
  id: string;
  type: 'zero_dechet' | 'anti_gaspi';
  statut: string;
  statut_tms: string;
  tms_reference: string | null;
  // Prestataire posé au dispatch — l'un des signaux « demande partie » qui
  // séparent « Créée » de « Programmée » (lib/statut-collecte-admin).
  prestataire_logistique_id: string | null;
  dirty_tms: boolean;
  date_collecte: string;
  heure_collecte: string;
  controle_acces_requis: boolean;
  informations_completes: boolean;
  taux_recyclage: number | null;
  attributions_antgaspi: {
    id: string;
    valide_at: string | null;
    mode_validation: 'manuel_top1' | 'manuel_override' | 'auto_accept' | null;
    volume_repas_realise: number | null;
  } | null;
  collecte_flux: { poids_reel_kg: number | null }[];
  rapports_rse: RapportRse[];
  evenements: {
    nom_evenement: string | null;
    pax: number | null;
    nom_client_organisateur: string | null;
    organisations: { raison_sociale: string };
    client_organisateur: { raison_sociale: string } | null;
    lieux: {
      nom: string;
      adresse_acces: string | null;
      code_postal: string | null;
      ville: string;
    };
  };
  // Champs additifs (câblés par la route liste) — optionnels.
  transporteur_nom?: string | null;
  // Montant résolu côté route (ZD = facture, AG = pack actif de l'org).
  montant_ht?: number | null;
  factures_collectes?: { montant_ht: number | null }[];
  packs_antgaspi?: { prix_unitaire_ht: number | null } | null;
}

// ── Statuts terminaux (= vue Historique). Source unique. ───────────────────────
export const STATUTS_TERMINAUX = new Set([
  'realisee',
  'realisee_sans_collecte',
  'cloturee',
  'annulee',
  'rejetee_par_prestataire',
]);

function estTerminale(row: CollecteRow): boolean {
  return STATUTS_TERMINAUX.has(row.statut);
}

// Collecte AG « à attribuer » : `programmee` en base et sans attribution. La
// colonne Statut la nomme par l'action attendue tant qu'elle est « Créée ».
function aAttribuer(row: CollecteRow): boolean {
  return (
    row.type === 'anti_gaspi' &&
    row.statut === 'programmee' &&
    row.attributions_antgaspi == null
  );
}

// Collecte ZD « à dispatcher » : définition canonique §11 §1.1, écrite une
// seule fois dans lib/collectes-chips (`estADispatcher`) — la même que le chip
// « Non transmises ZD » et la tuile « ZD à dispatcher ». Pas d'attribution
// manuelle ZD (CDC §06.06 l.231) → l'action ouvre la fiche (Bloc 0 « Envoyer à
// MTS-1 »).
export function aDispatcherZd(row: CollecteRow): boolean {
  return row.type === 'zero_dechet' && estADispatcher(row);
}

// Criticité (§06.09 §1 / ALGO-02) : à attribuer ET à moins de 48h.
export function estUrgente(row: CollecteRow): boolean {
  if (!aAttribuer(row)) return false;
  const ts = instantParis(
    row.date_collecte,
    heureOuMinuit(row.heure_collecte),
  ).getTime();
  return Number.isFinite(ts) && ts < Date.now() + 48 * 60 * 60 * 1000;
}

// Urgences (AG à attribuer < 48h) remontées en tête de liste (§06.09 §1).
// Tri stable → l'ordre reçu (celui de la colonne triée) est conservé au sein
// des urgentes comme des autres.
export function urgentesEnTete(rows: CollecteRow[]): CollecteRow[] {
  return [...rows].sort(
    (a, b) => Number(estUrgente(b)) - Number(estUrgente(a)),
  );
}

function poidsTotalZd(row: CollecteRow): number {
  return row.collecte_flux.reduce((s, f) => s + (f.poids_reel_kg ?? 0), 0);
}

// Montant de la collecte (§ décision Val 2026-07-04) :
//   ZD  → montant HT facturé (factures_collectes) quand la facture existe ;
//   AG  → prix du pack ramené à la collecte = packs_antgaspi.prix_unitaire_ht.
// Retourne null si non déterminable (ZD non encore facturée) → affiché « — ».
function montantCollecte(row: CollecteRow): number | null {
  // Priorité au montant résolu côté route (source unique : pack actif / facture).
  if (row.montant_ht != null) return row.montant_ht;
  if (row.type === 'anti_gaspi') {
    return row.packs_antgaspi?.prix_unitaire_ht ?? null;
  }
  const fc = row.factures_collectes?.find((f) => f.montant_ht != null);
  return fc?.montant_ht ?? null;
}

// Statut d'attribution AG (§06.06 §3 l.182) — 3 des 4 états dérivables.
function attributionBadge(row: CollecteRow): {
  label: string;
  variant: 'success' | 'primary' | 'neutral';
} {
  const a = row.attributions_antgaspi;
  if (!a) return { label: 'En attente', variant: 'neutral' };
  if (a.mode_validation === 'auto_accept')
    return { label: 'Auto-accept', variant: 'success' };
  return { label: 'Validée', variant: 'primary' };
}

function formatEuro(n: number, type: CollecteRow['type']): string {
  const v = fmtEuro(n, 0);
  return type === 'zero_dechet' ? `${v} HT` : v;
}

// ── Indicateurs de résultat (vue Historique) — repas AG ou « Sans excédent » /
// kg + taux ZD / rapport. « Sans excédent » est le résultat d'une collecte AG
// qui n'a rien donné, pas son statut (décision Val 2026-10-09).
function IndicateursHistorique({ row }: { row: CollecteRow }) {
  const sansExcedent = row.statut === 'realisee_sans_collecte';
  // Une collecte AG avec excédents n'a pas de rapport : son document est
  // l'attestation de don. Une ligne rapports_rse peut exister en base pour elle
  // (anciens batchs, jamais rendue en PDF) : elle n'annonce rien ici. Même règle
  // que le filtre « Rapport non consulté » (lib/collectes-admin).
  const aUnRapport = row.type === 'zero_dechet' || sansExcedent;
  const rapport = aUnRapport ? row.rapports_rse[0] : undefined;
  const poids = poidsTotalZd(row);
  const repas = row.attributions_antgaspi?.volume_repas_realise;

  return (
    <Text
      as="div"
      variant="hint"
      tone="soft"
      className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 font-bold sm:justify-start"
    >
      {sansExcedent && (
        <span className="inline-flex items-center gap-1.5">
          <Package className="h-3.5 w-3.5 text-savr-neutral-400" />
          {LIBELLE_SANS_EXCEDENT}
        </span>
      )}
      {row.type === 'anti_gaspi' && !sansExcedent && repas != null && (
        <span className="inline-flex items-center gap-1.5">
          <Package className="h-3.5 w-3.5 text-savr-neutral-400" />
          {repas} repas
        </span>
      )}
      {row.type === 'zero_dechet' && poids > 0 && (
        <span className="inline-flex items-center gap-1.5">
          <Scale className="h-3.5 w-3.5 text-savr-neutral-400" />
          {fmtKgAuto(poids)}
        </span>
      )}
      {row.type === 'zero_dechet' && row.taux_recyclage != null && (
        <span className="inline-flex items-center gap-1.5">
          <Recycle className="h-3.5 w-3.5 text-savr-neutral-400" />
          {fmtPct(row.taux_recyclage, 0)}
        </span>
      )}
      {rapport &&
        (rapport.consulte_par_user_at ? (
          <span className="inline-flex items-center gap-1.5 text-savr-success-strong">
            <CheckCircle2 className="h-3.5 w-3.5 text-savr-success" />
            Rapport consulté
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-savr-warning-strong">
            <FileText className="h-3.5 w-3.5 text-savr-warning" />
            Rapport non consulté
          </span>
        ))}
    </Text>
  );
}

// Indicateurs des collectes à venir / en cours (§06.06 §3 « Indicateurs »).
function IndicateursAVenir({ row }: { row: CollecteRow }) {
  const attribution = attributionBadge(row);
  const badges = [
    !row.informations_completes && (
      <Badge size="sm" key="info" variant="warning">
        Info incomplète
      </Badge>
    ),
    row.type === 'anti_gaspi' && !aAttribuer(row) && (
      <Badge size="sm" key="attr" variant={attribution.variant}>
        {attribution.label}
      </Badge>
    ),
  ].filter(Boolean);
  if (badges.length === 0) return <CelluleVide />;
  return (
    <div className="flex flex-wrap justify-end gap-1.5 sm:justify-start">
      {badges}
    </div>
  );
}

// ── Colonnes de la Data Table Collectes Admin (§06.06 §3 « Colonnes par
// ligne »). L'`id` des colonnes triables = valeur du paramètre API `tri`
// (tri serveur : la liste est paginée).
export function colonnesCollectesAdmin({
  onOpen,
}: {
  onOpen: (id: string) => void;
}): ColumnDef<CollecteRow, unknown>[] {
  return [
    {
      id: 'date',
      header: 'Date',
      enableHiding: false,
      accessorFn: (r) => `${r.date_collecte} ${r.heure_collecte ?? ''}`,
      cell: ({ row: { original: r } }) => {
        const { jour, heure } = formatDateHeure(
          r.date_collecte,
          r.heure_collecte,
        );
        return (
          <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 sm:justify-start">
            <span className="whitespace-nowrap font-extrabold text-savr-neutral-900 tabular-nums">
              {jour}
              {heure ? ` · ${heure}` : ''}
            </span>
            {estUrgente(r) && (
              <Badge
                variant="count"
                size="sm"
                className="uppercase tracking-wide"
              >
                Urgent
              </Badge>
            )}
          </div>
        );
      },
    },
    {
      id: 'type',
      header: 'Type',
      accessorFn: (r) => r.type,
      cell: ({ row: { original: r } }) => <TypeCollecteBadge type={r.type} />,
    },
    {
      id: 'traiteur',
      header: 'Traiteur',
      cell: ({ row: { original: r } }) => (
        <span className="whitespace-nowrap font-bold text-savr-neutral-900">
          {r.evenements.organisations.raison_sociale}
        </span>
      ),
    },
    {
      id: 'lieu',
      header: 'Lieu',
      cell: ({ row: { original: r } }) => {
        const l = r.evenements.lieux;
        const adresse = [
          l.adresse_acces,
          [l.code_postal, l.ville].filter(Boolean).join(' '),
        ]
          .filter(Boolean)
          .join(', ');
        return (
          // Une ligne chacun, coupés en « … » (adresse complète au survol) :
          // sans borne, la colonne se repliait sur 4 lignes et poussait le
          // tableau hors écran.
          <div className="min-w-0 sm:w-[240px]" title={adresse || undefined}>
            <div className="overflow-hidden text-ellipsis whitespace-nowrap font-semibold text-savr-neutral-800">
              {l.nom}
            </div>
            {adresse && (
              <Text
                as="div"
                variant="hint"
                className="overflow-hidden text-ellipsis whitespace-nowrap"
              >
                {adresse}
              </Text>
            )}
          </div>
        );
      },
    },
    {
      id: 'statut',
      header: 'Statut',
      accessorFn: (r) => r.statut,
      cell: ({ row: { original: r } }) =>
        // « À attribuer » nomme une AG « Créée » par l'action attendue : le
        // badge cède dès qu'un signal d'envoi existe, comme la frise et l'export.
        aAttribuer(r) && statutCollecteAdmin(r) === 'creee' ? (
          <Badge variant="warning">À attribuer</Badge>
        ) : (
          <StatusCollecte statut={statutCollecteAdmin(r)} />
        ),
    },
    {
      id: 'statut_tms',
      header: 'TMS',
      accessorFn: (r) => r.statut_tms,
      cell: ({ row: { original: r } }) => {
        const tms = statutTmsDisplay(r.statut_tms);
        return (
          <Badge size="sm" variant={tms.variant} className="whitespace-nowrap">
            {tms.label}
          </Badge>
        );
      },
    },
    {
      id: 'pax',
      header: 'Pax',
      meta: { className: 'text-right tabular-nums' },
      cell: ({ row: { original: r } }) => r.evenements.pax ?? <CelluleVide />,
    },
    {
      id: 'client',
      header: 'Client organisateur',
      meta: { hideOnMobile: true },
      cell: ({ row: { original: r } }) =>
        r.evenements.client_organisateur?.raison_sociale ??
        r.evenements.nom_client_organisateur ?? <CelluleVide />,
    },
    {
      id: 'transporteur',
      header: 'Transporteur',
      cell: ({ row: { original: r } }) => r.transporteur_nom ?? <CelluleVide />,
    },
    {
      id: 'controle_acces',
      header: 'Accès',
      meta: { label: 'Contrôle d’accès', hideOnMobile: true },
      cell: ({ row: { original: r } }) =>
        r.controle_acces_requis ? (
          <Badge
            size="sm"
            variant="info"
            title="Plaque + nom chauffeur communiqués avant exécution"
          >
            Oui
          </Badge>
        ) : (
          <span className="text-savr-neutral-500">Non</span>
        ),
    },
    {
      id: 'indicateurs',
      header: 'Indicateurs',
      cell: ({ row: { original: r } }) =>
        estTerminale(r) ? (
          <IndicateursHistorique row={r} />
        ) : (
          <IndicateursAVenir row={r} />
        ),
    },
    {
      id: 'montant',
      header: 'Montant',
      meta: { className: 'text-right' },
      cell: ({ row: { original: r } }) => {
        const m = montantCollecte(r);
        return m != null ? (
          <span className="whitespace-nowrap font-extrabold text-savr-neutral-900 tabular-nums">
            {formatEuro(m, r.type)}
          </span>
        ) : (
          <CelluleVide />
        );
      },
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      enableHiding: false,
      meta: {
        label: 'Actions',
        interactive: true,
        stickyRight: true,
        className: 'w-12 text-right',
      },
      cell: ({ row: { original: r } }) => (
        <ActionsCollecte row={r} onOpen={onOpen} />
      ),
    },
  ];
}

// Menu « ⋯ » de fin de ligne (décision Val 2026-09-28 : tableau plat, actions
// en menu). « Attribuer » mène au flux algo AG (§06.09) ; « Dispatcher »
// ouvre la fiche (Bloc 0 « Envoyer à MTS-1 »). Le déclencheur prend la couleur
// d'action quand une action est attendue, pour ne pas la noyer dans le menu.
function ActionsCollecte({
  row,
  onOpen,
}: {
  row: CollecteRow;
  onOpen: (id: string) => void;
}) {
  const attendue = aAttribuer(row) || aDispatcherZd(row);
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <IconButton
          aria-label={
            attendue
              ? 'Actions sur la collecte (action attendue)'
              : 'Actions sur la collecte'
          }
          className={cn(
            'sm:h-9 sm:w-9',
            attendue &&
              'bg-savr-accent-500 text-savr-primary-950 hover:bg-savr-accent-600 hover:text-savr-primary-950',
          )}
        >
          <MoreHorizontal aria-hidden="true" />
        </IconButton>
      </DropdownTrigger>
      <DropdownContent align="end">
        <DropdownItem onSelect={() => onOpen(row.id)}>
          <Eye aria-hidden="true" />
          Ouvrir la fiche
        </DropdownItem>
        {aAttribuer(row) && (
          <DropdownItem asChild>
            <Link href={ROUTES.admin.attributionAg(row.id)}>
              <ArrowRight aria-hidden="true" />
              Attribuer
            </Link>
          </DropdownItem>
        )}
        {aDispatcherZd(row) && (
          <DropdownItem onSelect={() => onOpen(row.id)}>
            <Send aria-hidden="true" />
            Dispatcher
          </DropdownItem>
        )}
      </DropdownContent>
    </Dropdown>
  );
}
