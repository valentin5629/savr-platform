'use client';

import Link from 'next/link';
import {
  Clock,
  Users,
  MapPin,
  Briefcase,
  Truck,
  UtensilsCrossed,
  Leaf,
  ArrowRight,
  FileText,
  Scale,
  Recycle,
  CheckCircle2,
  Package,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { StatusCollecte } from '@/components/ui/status-collecte';
import { statutTmsDisplay } from '@/lib/statut-tms-labels';
import type { StatutCollecte } from '@/components/ui/status-collecte';
import { cn } from '@/lib/utils';

// ── Type de ligne collecte affichée par la carte (liste Admin, §06.06 §3) ──────
// Superset du SELECT liste : les champs transporteur_nom / montant_ht / pack sont
// optionnels → la carte se rend même si la route ne les câble pas encore
// (dégradation gracieuse, cf. plan refonte UI Collectes).
export interface RapportRse {
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

export function estTerminale(row: CollecteRow): boolean {
  return STATUTS_TERMINAUX.has(row.statut);
}

// Collecte AG « à attribuer » : programmée et sans attribution (≈ « Créée »).
export function aAttribuer(row: CollecteRow): boolean {
  return (
    row.type === 'anti_gaspi' &&
    row.statut === 'programmee' &&
    row.attributions_antgaspi == null
  );
}

// Criticité (§06.09 §1 / ALGO-02) : à attribuer ET à moins de 48h.
export function estUrgente(row: CollecteRow): boolean {
  if (!aAttribuer(row)) return false;
  const ts = new Date(
    `${row.date_collecte}T${row.heure_collecte ?? '00:00:00'}`,
  ).getTime();
  return Number.isFinite(ts) && ts < Date.now() + 48 * 60 * 60 * 1000;
}

function poidsTotalZd(row: CollecteRow): number {
  return row.collecte_flux.reduce((s, f) => s + (f.poids_reel_kg ?? 0), 0);
}

// Montant de la collecte (§ décision Val 2026-07-04) :
//   ZD  → montant HT facturé (factures_collectes) quand la facture existe ;
//   AG  → prix du pack ramené à la collecte = packs_antgaspi.prix_unitaire_ht.
// Retourne null si non déterminable (ZD non encore facturée) → affiché « — ».
export function montantCollecte(row: CollecteRow): number | null {
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

// Format CDC §06.06 §3 : "Dim 06 juil · 21h30".
export function formatDateHeure(
  date: string,
  heure: string | null,
): {
  jour: string;
  heure: string;
} {
  const d = new Date(`${date}T${heure ?? '00:00:00'}`);
  const jour = d
    .toLocaleDateString('fr-FR', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
    })
    .replace(/\./g, '')
    .replace(/\b\p{L}/gu, (c) => c.toUpperCase());
  const h = (heure ?? '').slice(0, 5).replace(':', 'h');
  return { jour, heure: h };
}

function formatEuro(n: number, type: CollecteRow['type']): string {
  const v = n.toLocaleString('fr-FR', { maximumFractionDigits: 0 });
  return type === 'zero_dechet' ? `${v} € HT` : `${v} €`;
}

// ── Groupement par semaine (lundi→dimanche) pour la liste. ─────────────────────
export interface SemaineGroupe {
  key: string;
  label: string;
  items: CollecteRow[];
}

function lundiDe(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const jour = (x.getDay() + 6) % 7; // 0 = lundi
  x.setDate(x.getDate() - jour);
  return x;
}

export function groupBySemaine(
  rows: CollecteRow[],
  ordre: 'asc' | 'desc',
): SemaineGroupe[] {
  const fmt = (d: Date) =>
    d
      .toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
      .replace(/\./g, '');
  const map = new Map<string, CollecteRow[]>();
  for (const r of rows) {
    const key = lundiDe(new Date(`${r.date_collecte}T00:00:00`))
      .toISOString()
      .slice(0, 10);
    const bucket = map.get(key);
    if (bucket) bucket.push(r);
    else map.set(key, [r]);
  }
  const groupes = [...map.entries()].map(([key, items]) => {
    const lundi = new Date(`${key}T00:00:00`);
    const dimanche = new Date(lundi);
    dimanche.setDate(dimanche.getDate() + 6);
    items.sort((a, b) =>
      `${a.date_collecte}${a.heure_collecte ?? ''}`.localeCompare(
        `${b.date_collecte}${b.heure_collecte ?? ''}`,
      ),
    );
    return {
      key,
      label: `Semaine du ${fmt(lundi)} — ${fmt(dimanche)}`,
      items,
    };
  });
  groupes.sort((a, b) =>
    ordre === 'asc' ? a.key.localeCompare(b.key) : b.key.localeCompare(a.key),
  );
  return groupes;
}

// ── Indicateurs de résultat (vue Historique) — repas AG / kg + taux ZD / rapport.
function IndicateursHistorique({ row }: { row: CollecteRow }) {
  const rapport = row.rapports_rse[0];
  const poids = poidsTotalZd(row);
  const repas = row.attributions_antgaspi?.volume_repas_realise;

  return (
    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs font-bold text-savr-neutral-600">
      {row.type === 'anti_gaspi' && repas != null && (
        <span className="inline-flex items-center gap-1.5">
          <Package className="h-3.5 w-3.5 text-savr-neutral-400" />
          {repas} repas
        </span>
      )}
      {row.type === 'zero_dechet' && poids > 0 && (
        <span className="inline-flex items-center gap-1.5">
          <Scale className="h-3.5 w-3.5 text-savr-neutral-400" />
          {poids.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} kg
        </span>
      )}
      {row.type === 'zero_dechet' && row.taux_recyclage != null && (
        <span className="inline-flex items-center gap-1.5">
          <Recycle className="h-3.5 w-3.5 text-savr-neutral-400" />
          {row.taux_recyclage.toLocaleString('fr-FR', {
            maximumFractionDigits: 0,
          })}{' '}
          %
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
    </div>
  );
}

interface CollecteCardProps {
  collecte: CollecteRow;
}

// Carte collecte — refonte UI Admin (§06.06 §3, Design System §10).
// Rail de type à gauche (AG ambre / ZD vert / urgent rouge), 2 lignes de contenu,
// colonne d'état à droite + montant. Lien « stretched » vers la fiche (le bouton
// Attribuer reste cliquable au-dessus via z-index — pas de <a> imbriqué).
export function CollecteCard({ collecte: row }: CollecteCardProps) {
  const terminale = estTerminale(row);
  const urgente = estUrgente(row);
  const { jour, heure } = formatDateHeure(
    row.date_collecte,
    row.heure_collecte,
  );
  const l = row.evenements.lieux;
  const adresse = [
    l.adresse_acces,
    [l.code_postal, l.ville].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join(', ');
  const client =
    row.evenements.client_organisateur?.raison_sociale ??
    row.evenements.nom_client_organisateur ??
    null;
  const montant = montantCollecte(row);
  const tms = statutTmsDisplay(row.statut_tms);
  const attribution = attributionBadge(row);
  const Icone = row.type === 'anti_gaspi' ? UtensilsCrossed : Leaf;

  return (
    <div
      className={cn(
        'group relative grid grid-cols-[42px_1fr_auto] items-center gap-4 rounded-savr-lg border bg-savr-white py-4 pl-[22px] pr-[18px]',
        'transition-[border-color,box-shadow,transform] duration-[120ms] ease-out',
        'hover:-translate-y-px hover:border-savr-primary-200 hover:shadow-savr-md',
        urgente
          ? 'border-savr-error/30 bg-savr-error-subtle'
          : 'border-savr-neutral-200',
      )}
    >
      {/* Rail de type (levier couleur ZD/AG, rouge si urgent) */}
      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-y-0 left-0 w-1 rounded-l-savr-lg',
          urgente
            ? 'bg-savr-error'
            : row.type === 'anti_gaspi'
              ? 'bg-savr-warning'
              : 'bg-savr-success',
        )}
      />

      {/* Lien « stretched » vers la fiche (couvre toute la carte) */}
      <Link
        href={`/admin/collectes/${row.id}`}
        aria-label={`Ouvrir la collecte du ${jour}${heure ? ` à ${heure}` : ''} — ${row.evenements.organisations.raison_sociale}`}
        className="absolute inset-0 rounded-savr-lg focus-visible:outline-2"
      />

      {/* Pastille de type */}
      <span
        className={cn(
          'grid h-[42px] w-[42px] place-items-center rounded-savr-md',
          row.type === 'anti_gaspi'
            ? 'bg-savr-warning-subtle text-savr-warning-strong'
            : 'bg-savr-success-subtle text-savr-success-strong',
        )}
      >
        <Icone className="h-5 w-5" aria-hidden="true" />
      </span>

      {/* Corps : ligne 1 (jour · heure · traiteur · lieu · pax) + ligne 2 */}
      <div className="min-w-0 flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="text-[15px] font-extrabold tracking-tight text-savr-neutral-900 tabular-nums">
            {jour}
          </span>
          {heure && (
            <>
              <span className="text-savr-neutral-300">·</span>
              <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-savr-neutral-500 tabular-nums">
                <Clock className="h-3.5 w-3.5 text-savr-neutral-400" />
                {heure}
              </span>
            </>
          )}
          <span className="text-savr-neutral-300">·</span>
          <span className="text-[15px] font-extrabold tracking-tight text-savr-neutral-900">
            {row.evenements.organisations.raison_sociale}
          </span>
          <span className="text-[14px] font-semibold text-savr-neutral-600">
            {l.nom}
          </span>
          {row.evenements.pax != null && (
            <>
              <span className="text-savr-neutral-300">·</span>
              <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-savr-neutral-500 tabular-nums">
                <Users className="h-3.5 w-3.5 text-savr-neutral-400" />
                {row.evenements.pax} pax
              </span>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-savr-neutral-600">
          {adresse && (
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 shrink-0 text-savr-neutral-400" />
              {adresse}
            </span>
          )}
          {client && (
            <span className="inline-flex items-center gap-1.5">
              <Briefcase className="h-3.5 w-3.5 shrink-0 text-savr-neutral-400" />
              {client}
            </span>
          )}
          {row.transporteur_nom && (
            <span className="inline-flex items-center gap-1.5">
              <Truck className="h-3.5 w-3.5 shrink-0 text-savr-neutral-400" />
              {row.transporteur_nom}
            </span>
          )}
        </div>
      </div>

      {/* Colonne d'état + montant */}
      <div className="flex min-w-[150px] flex-col items-end gap-2">
        {terminale ? (
          <>
            {/* Historique : statut collecte (statut_tms n'a pas d'état terminal) */}
            <StatusCollecte statut={row.statut as StatutCollecte} />
            <IndicateursHistorique row={row} />
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              {!row.informations_completes && (
                <Badge variant="warning" className="text-[11px]">
                  Info incomplète
                </Badge>
              )}
              {row.controle_acces_requis && (
                <Badge variant="info" className="text-[11px]">
                  Contrôle accès requis
                </Badge>
              )}
              <Badge variant={tms.variant} className="text-[11px]">
                TMS · {tms.label}
              </Badge>
              {row.type === 'anti_gaspi' && !aAttribuer(row) && (
                <Badge variant={attribution.variant} className="text-[11px]">
                  {attribution.label}
                </Badge>
              )}
            </div>
            {aAttribuer(row) && (
              <Link
                href={`/admin/attributions-ag/${row.id}`}
                className="relative z-[1] inline-flex h-8 items-center gap-1.5 rounded-savr-md bg-savr-accent-500 px-3.5 text-[13px] font-extrabold text-savr-primary-950 transition-[background-color,transform] duration-[120ms] hover:-translate-y-px hover:bg-savr-accent-600"
              >
                Attribuer
                <ArrowRight className="h-4 w-4" />
              </Link>
            )}
          </>
        )}

        {/* Montant (sous la colonne droite) */}
        <div className="flex w-full items-baseline justify-end gap-2 border-t border-savr-neutral-100 pt-2">
          <span className="mr-auto text-[10px] font-bold uppercase tracking-wide text-savr-neutral-400">
            Montant
          </span>
          {montant != null ? (
            <span className="text-[15px] font-extrabold tracking-tight text-savr-neutral-900 tabular-nums">
              {formatEuro(montant, row.type)}
            </span>
          ) : (
            <span className="text-[13px] font-bold text-savr-neutral-500">
              —
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
