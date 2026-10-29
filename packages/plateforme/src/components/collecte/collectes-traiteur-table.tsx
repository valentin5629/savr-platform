'use client';

import { useId, type ReactNode } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import {
  CopyIcon,
  DotsThreeIcon,
  DownloadSimpleIcon,
  FileTextIcon,
  LeafIcon,
  PackageIcon,
  PencilSimpleIcon,
  RecycleIcon,
  ScalesIcon,
  XCircleIcon,
} from '@/components/ui/icones';
import { Badge } from '@/components/ui/badge';
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownSeparator,
  DropdownTrigger,
} from '@/components/ui/dropdown';
import { ChevronLigne, RepereJour } from '@/components/collecte/repere-jour';
import { CollecteStatutBadge } from '@/components/ui/collecte-statut-badge';
import { IconButton } from '@/components/ui/icon-button';
import { libelleDateHeure } from '@/lib/format-date-collecte';
import { LIBELLE_RAPPORT_RESERVE } from '@/lib/collectes/fiche-client-types';
import { LIBELLE_SANS_EXCEDENT } from '@/lib/statut-collecte-labels';
import { CelluleVide } from '@/components/ui/data-grid';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import { fmtKgAuto, fmtPct, fmtInt, fmtPax, UNITE_KG_CO2E } from '@/lib/format';

// Ligne de la Data Table Collectes traiteur (BL-P2-14, refonte liste 2026-07-05,
// revue écran 2026-07-15, passage en Data Table 2026-09-28 — décisions Val).
// Colonnes : Date · Lieu · Client (revue écran 2026-10-01) · Pax · Résultats
// (collecte réalisée) · Statut · menu « ⋯ » Modifier / Dupliquer / Annuler
// (revue écran 2026-10-29) + chevron. Le contenu métier détaillé reste sur la
// fiche (clic ligne).
export interface TraiteurCollecteLigne {
  id: string;
  type: string; // 'zero_dechet' | 'anti_gaspi'
  statut: string;
  date_collecte: string;
  heure_collecte: string | null;
  lieu_nom: string | null;
  lieu_adresse: string | null;
  /** Client organisateur saisi à la programmation (`nom_client_organisateur`). */
  client_nom: string | null;
  pax: number | null;
  programmee_par_tiers: boolean;
  /** Rapport de don réservé au donneur d'ordre (D12) : pas de téléchargement. */
  rapport_reserve_donneur_ordre: boolean;
  /** Droit d'écriture de l'appelant sur cette collecte (manager, ou commercial
   *  créateur de l'événement). */
  canWrite: boolean;
  // Résultats affichés sur la collecte réalisée (statut cloturee ; une collecte
  // AG sans excédent affiche « Sans excédent » à leur place).
  // ZD : poids total (Σ flux) + taux de recyclage. AG : repas donnés. Les deux : CO₂ évité.
  poids_total_kg: number | null;
  taux_recyclage: number | null;
  co2_evite_kg: number | null;
  nb_repas_donnes: number | null;
}

// Gates d'action alignés sur la fiche (§05 §4), menu « ⋯ » (revue écran
// 2026-10-29) :
//  - Modifier : statut programmee / validee
//  - Annuler  : statut brouillon / programmee / validee (validee = demande Admin)
// Hors de ces statuts l'action est absente du menu, comme sur la fiche ; sans
// droit d'écriture elle est grisée, sa raison écrite sous elle. Dupliquer est
// toujours disponible (crée une NOUVELLE collecte à partir du modèle, y compris
// depuis une collecte passée à reprogrammer).
const STATUTS_EDITABLES = ['programmee', 'validee'];
const STATUTS_ANNULABLES = ['brouillon', 'programmee', 'validee'];
const STATUTS_ANNULES = ['annulee', 'annulation_demandee'];

// Raison d'une action grisée. Le texte « créateur ou manager » est celui de la
// fiche ; celui du tiers est propre à la liste (la fiche affiche le premier).
function motifLectureSeule(c: TraiteurCollecteLigne): string {
  return c.programmee_par_tiers
    ? 'Collecte programmée par un tiers : adressez-vous à lui ou à l’équipe Savr.'
    : 'Seul le créateur de la collecte ou un manager peut la modifier.';
}

export interface ActionsTraiteur {
  onModifier: (c: TraiteurCollecteLigne) => void;
  onAnnuler: (c: TraiteurCollecteLigne) => void;
  onDupliquer: (c: TraiteurCollecteLigne) => void;
  onTelecharger: (c: TraiteurCollecteLigne) => void;
}

// Cellule « Lieu » (nom + adresse d'accès) — partagée avec la liste Collectes
// gestionnaire, qui reprend les colonnes de celle-ci (décision Val 2026-10-01).
export function CelluleLieu({
  nom,
  adresse,
  pastille,
}: {
  nom: string | null;
  adresse: string | null;
  /** Pastille écrite à droite du nom (ex. « Par un tiers »). */
  pastille?: ReactNode;
}) {
  if (!nom && !adresse) return <CelluleVide />;
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
        <span>{nom ?? '—'}</span>
        {pastille}
      </div>
      {adresse && (
        <Text as="div" variant="hint">
          {adresse}
        </Text>
      )}
    </div>
  );
}

// « Réalisée » (vue client) : résultats + rapport. Statut cloturee, ou collecte
// AG sans excédent — son résultat est alors la mention « Sans excédent », et son
// rapport de don se télécharge comme les autres (décision Val 2026-10-09).
// Partagée avec la liste Collectes gestionnaire.
export function ResultatsCollecte({
  c,
  onTelecharger,
}: {
  c: Pick<
    TraiteurCollecteLigne,
    | 'type'
    | 'statut'
    | 'rapport_reserve_donneur_ordre'
    | 'poids_total_kg'
    | 'taux_recyclage'
    | 'co2_evite_kg'
    | 'nb_repas_donnes'
  >;
  onTelecharger: () => void;
}) {
  const sansExcedent = c.statut === 'realisee_sans_collecte';
  if (c.statut !== 'cloturee' && !sansExcedent) return <CelluleVide />;
  const zd = c.type === 'zero_dechet';
  return (
    <Text
      as="div"
      variant="hint"
      tone="soft"
      className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 font-bold sm:justify-start"
    >
      {sansExcedent ? (
        <span className="inline-flex items-center gap-1.5">
          <PackageIcon className="h-3.5 w-3.5 text-savr-neutral-400" />
          {LIBELLE_SANS_EXCEDENT}
        </span>
      ) : zd ? (
        <>
          {c.poids_total_kg != null && c.poids_total_kg > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <ScalesIcon className="h-3.5 w-3.5 text-savr-neutral-400" />
              {fmtKgAuto(c.poids_total_kg)}
            </span>
          )}
          {c.taux_recyclage != null && (
            <span className="inline-flex items-center gap-1.5">
              <RecycleIcon className="h-3.5 w-3.5 text-savr-neutral-400" />
              {fmtPct(c.taux_recyclage, 0)}
            </span>
          )}
        </>
      ) : (
        c.nb_repas_donnes != null &&
        c.nb_repas_donnes > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <PackageIcon className="h-3.5 w-3.5 text-savr-neutral-400" />
            {fmtInt(c.nb_repas_donnes)} repas
          </span>
        )
      )}
      {c.co2_evite_kg != null && c.co2_evite_kg > 0 && (
        <span className="inline-flex items-center gap-1.5">
          <LeafIcon className="h-3.5 w-3.5 text-savr-neutral-400" />
          {fmtInt(c.co2_evite_kg)}
          {'\u00a0'}
          {UNITE_KG_CO2E}
        </span>
      )}
      {/* Rapport réservé au donneur d'ordre : action retirée (liste, §10 §7)
          et remplacée par la mention de la fiche, précédée du picto document
          pour qu'elle se lise « rapport réservé », pas « résultats réservés ». */}
      {c.rapport_reserve_donneur_ordre ? (
        <span className="inline-flex items-center gap-1.5 font-normal text-savr-neutral-500">
          <FileTextIcon
            className="h-3.5 w-3.5 text-savr-neutral-400"
            aria-hidden="true"
          />
          {LIBELLE_RAPPORT_RESERVE}
        </span>
      ) : (
        <IconButton
          variant="ghost"
          // Le clic s'arrête au bouton : le reste de la cellule (chiffres,
          // « — ») ouvre la fiche comme toute la ligne.
          onClick={(e) => {
            e.stopPropagation();
            onTelecharger();
          }}
          title="Télécharger le rapport"
          aria-label="Télécharger le rapport de la collecte"
        >
          <DownloadSimpleIcon />
        </IconButton>
      )}
    </Text>
  );
}

// Entrée du menu. Grisée, elle reste atteignable au clavier (`aria-disabled`,
// pas `disabled`, que Radix saute aux flèches) et ne fait rien ; sa raison est
// écrite sous elle sans être atténuée, et lue comme description (même rendu
// que le menu « ⋯ » de la fiche sur téléphone).
function EntreeMenu({
  icone,
  libelle,
  motif,
  destructive,
  onChoisir,
}: {
  icone: ReactNode;
  libelle: string;
  /** Présent = entrée grisée, avec sa raison. */
  motif?: string;
  destructive?: boolean;
  onChoisir: () => void;
}) {
  const idMotif = useId();
  const grisee = motif != null;
  return (
    <DropdownItem
      destructive={destructive && !grisee}
      aria-disabled={grisee || undefined}
      aria-describedby={grisee ? idMotif : undefined}
      className={cn(
        'items-start',
        grisee && 'cursor-not-allowed text-savr-neutral-700',
      )}
      onSelect={(e) => {
        if (grisee) {
          e.preventDefault();
          return;
        }
        onChoisir();
      }}
    >
      <span className={cn('mt-0.5 shrink-0', grisee && 'opacity-50')}>
        {icone}
      </span>
      <span className="min-w-0">
        <span className={cn('block', grisee && 'opacity-50')}>{libelle}</span>
        {grisee && (
          <span
            id={idMotif}
            className="mt-0.5 block text-xs text-savr-neutral-600"
          >
            {motif}
          </span>
        )}
      </span>
    </DropdownItem>
  );
}

// Menu « ⋯ » de fin de ligne (revue écran 2026-10-29, remplace les trois
// pictos de 10 px) : Modifier, Dupliquer, puis l'annulation, isolée en rouge.
function ActionsLigne({
  c,
  actions,
}: {
  c: TraiteurCollecteLigne;
  actions: ActionsTraiteur;
}) {
  const modifiable = STATUTS_EDITABLES.includes(c.statut);
  const annulable = STATUTS_ANNULABLES.includes(c.statut);
  const motif = c.canWrite ? undefined : motifLectureSeule(c);
  const icone = 'block h-4 w-4';
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <IconButton aria-label="Actions sur la collecte">
          <DotsThreeIcon aria-hidden="true" />
        </IconButton>
      </DropdownTrigger>
      <DropdownContent align="end" className="max-w-72">
        {modifiable && (
          <EntreeMenu
            icone={<PencilSimpleIcon aria-hidden="true" className={icone} />}
            libelle="Modifier la collecte"
            motif={motif}
            onChoisir={() => actions.onModifier(c)}
          />
        )}
        <EntreeMenu
          icone={<CopyIcon aria-hidden="true" className={icone} />}
          libelle="Dupliquer la collecte"
          onChoisir={() => actions.onDupliquer(c)}
        />
        {annulable && (
          <>
            <DropdownSeparator />
            <EntreeMenu
              icone={<XCircleIcon aria-hidden="true" className={icone} />}
              libelle={
                c.statut === 'validee'
                  ? 'Demander l’annulation'
                  : 'Annuler la collecte'
              }
              motif={motif}
              destructive
              onChoisir={() => actions.onAnnuler(c)}
            />
          </>
        )}
      </DropdownContent>
    </Dropdown>
  );
}

// Colonnes de la Data Table (tri côté client : la route n'est pas paginée).
// `aujourdhui` (jour de Paris) pose le repère « Aujourd’hui » / « Demain ».
export function colonnesCollectesTraiteur(
  actions: ActionsTraiteur,
  aujourdhui?: string,
): ColumnDef<TraiteurCollecteLigne, unknown>[] {
  return [
    {
      id: 'date',
      header: 'Date',
      enableHiding: false,
      accessorFn: (c) => `${c.date_collecte} ${c.heure_collecte ?? ''}`,
      cell: ({ row: { original: c } }) => (
        <span className="inline-flex items-center gap-2 whitespace-nowrap font-semibold text-savr-neutral-900 tabular-nums">
          {libelleDateHeure(c.date_collecte, c.heure_collecte)}
          {aujourdhui && (
            <RepereJour
              date={c.date_collecte}
              aujourdhui={aujourdhui}
              masque={STATUTS_ANNULES.includes(c.statut)}
            />
          )}
        </span>
      ),
    },
    {
      id: 'lieu',
      header: 'Lieu',
      accessorFn: (c) => c.lieu_nom ?? '',
      cell: ({ row: { original: c } }) => (
        <CelluleLieu
          nom={c.lieu_nom}
          adresse={c.lieu_adresse}
          pastille={
            // Programmée par un tiers (§06.04 Vue liste) : pastille écrite,
            // l'ancien picto orange ne se comprenait qu'au survol.
            c.programmee_par_tiers && (
              <Badge
                variant="action"
                size="sm"
                title="Programmée par un tiers"
                className="font-medium"
              >
                Par un tiers
              </Badge>
            )
          }
        />
      ),
    },
    {
      id: 'client',
      header: 'Client',
      accessorFn: (c) => c.client_nom ?? '',
      // Non renseigné : cellule laissée vide (revue écran 2026-10-29), le
      // tiret répété sur la plupart des lignes chargeait la liste.
      cell: ({ row: { original: c } }) => c.client_nom ?? null,
    },
    {
      id: 'pax',
      header: 'Pax',
      accessorFn: (c) => c.pax ?? -1,
      meta: { className: 'text-right tabular-nums' },
      cell: ({ row: { original: c } }) =>
        c.pax != null ? fmtPax(c.pax) : <CelluleVide />,
    },
    {
      id: 'resultats',
      header: 'Résultats',
      cell: ({ row: { original: c } }) => (
        <ResultatsCollecte
          c={c}
          onTelecharger={() => actions.onTelecharger(c)}
        />
      ),
    },
    {
      id: 'statut',
      header: 'Statut',
      accessorFn: (c) => c.statut,
      // Colonne au contenu : le badge reste collé aux pictos d'action
      // (revue écran 2026-10-01).
      meta: { className: 'w-[1%] whitespace-nowrap' },
      cell: ({ row: { original: c } }) => (
        <CollecteStatutBadge statut={c.statut} />
      ),
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      enableHiding: false,
      meta: {
        label: 'Actions',
        interactive: true,
        stickyRight: true,
        // Colonne réduite à son contenu (revue écran 2026-10-01) : plus de
        // vide entre la dernière colonne de données et les pictos.
        className: 'w-[1%] whitespace-nowrap text-right',
      },
      cell: ({ row: { original: c } }) => (
        <div className="flex items-center justify-end gap-1">
          <ActionsLigne c={c} actions={actions} />
          {/* Chevron : la ligne ouvre la fiche (le clic est porté par la ligne). */}
          <ChevronLigne />
        </div>
      ),
    },
  ];
}
