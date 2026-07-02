'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Truck, Plus, FileText, CheckCircle2, RotateCw } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Autocomplete,
  type AutocompleteOption,
} from '@/components/ui/autocomplete';
import {
  StatusCollecte,
  type StatutCollecte,
} from '@/components/ui/status-collecte';
import {
  statutCollecteDisplay,
  type StatutCollecteDb,
} from '@/lib/statut-collecte-labels';

interface RapportRse {
  disponible_a: string | null;
  genere_at: string | null;
  regenere_at: string | null;
  consulte_par_user_at: string | null;
  version: number | null;
}

interface Collecte {
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
  // Présence d'attribution AG (to-one via contrainte unique) : null = à attribuer.
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
}

const CHIPS = [
  { key: 'non_transmises', label: 'Non transmises TMS' },
  { key: 'attente_prestataire', label: 'Attente prestataire' },
  { key: 'dirty_tms', label: 'Modifiées sans renvoi' },
  { key: 'ag_attente_attribution', label: 'Collectes à attribuer' },
  { key: 'zd_48h', label: 'ZD 48h' },
  { key: 'ag_48h', label: 'AG 48h' },
];

// Statuts sélectionnables dans le filtre multi (§06.06 §3 — 9 valeurs de l'enum
// collectes.statut, source unique statut-collecte-labels).
const STATUTS_FILTRE: StatutCollecteDb[] = [
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
];

const STATUTS_TERMINAUX = new Set([
  'realisee',
  'realisee_sans_collecte',
  'cloturee',
  'annulee',
  'rejetee_par_prestataire',
]);

// Collecte AG « à attribuer » : programmée et sans attribution encore (≈ « Créée »).
// Une fois attribuée, elle a une ligne attributions_antgaspi → statut « Programmée ».
function aAttribuer(row: Collecte): boolean {
  return (
    row.type === 'anti_gaspi' &&
    row.statut === 'programmee' &&
    row.attributions_antgaspi == null
  );
}

// Criticité (§06.09 §1 / ALGO-02) : collecte à attribuer ET à moins de 48h.
function estUrgente(row: Collecte): boolean {
  if (!aAttribuer(row)) return false;
  const ts = new Date(
    `${row.date_collecte}T${row.heure_collecte ?? '00:00:00'}`,
  ).getTime();
  return Number.isFinite(ts) && ts < Date.now() + 48 * 60 * 60 * 1000;
}

// Format CDC §06.06 §3 : "Jeu 23 Avr · 08h30".
function formatDateHeure(date: string, heure: string | null): string {
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
  return h ? `${jour} · ${h}` : jour;
}

function poidsTotalZd(row: Collecte): number {
  return row.collecte_flux.reduce((s, f) => s + (f.poids_reel_kg ?? 0), 0);
}

// Statut d'attribution AG affiché sur la liste (§06.06 §3 l.182). 3 des 4 états
// CDC sont dérivables : « Validée » (mode_validation manuel_top1/override),
// « Auto-accept » (auto_accept), « En attente » (aucune attribution). Le 4e état
// « aucune reco » n'a pas de marqueur persisté pré-validation (cf. divergence).
function attributionBadge(row: Collecte): {
  label: string;
  variant: 'success' | 'primary' | 'neutral';
} {
  const a = row.attributions_antgaspi;
  if (!a) return { label: 'En attente', variant: 'neutral' };
  if (a.mode_validation === 'auto_accept')
    return { label: 'Auto-accept', variant: 'success' };
  return { label: 'Validée', variant: 'primary' };
}

// Indicateurs par ligne (§06.06 §3). NB : « Anomalie pesée » = détection seuils
// par flux → exception actée V2 (non calculée en V1), donc pas d'indicateur ici.
function Indicateurs({ row }: { row: Collecte }) {
  const rapport = row.rapports_rse[0];
  const upcoming = !STATUTS_TERMINAUX.has(row.statut);
  const poids = poidsTotalZd(row);
  const repas = row.attributions_antgaspi?.volume_repas_realise;
  const regenere =
    rapport != null &&
    (rapport.regenere_at != null || (rapport.version ?? 1) > 1);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {/* Info incomplète (à venir / en cours) */}
      {upcoming && !row.informations_completes && (
        <Badge variant="warning" className="text-[10px]">
          Info incomplète
        </Badge>
      )}

      {/* Rapport RSE (toutes collectes passées) */}
      {rapport && (
        <span
          className="inline-flex items-center gap-0.5 text-savr-neutral-500"
          title={
            rapport.consulte_par_user_at
              ? `Rapport consulté le ${new Date(rapport.consulte_par_user_at).toLocaleDateString('fr-FR')}`
              : 'Rapport disponible (non consulté)'
          }
        >
          <FileText className="h-3.5 w-3.5" aria-label="Rapport disponible" />
          {rapport.consulte_par_user_at && (
            <CheckCircle2
              className="h-3 w-3 text-savr-success-strong"
              aria-label="Rapport consulté"
            />
          )}
          {regenere && (
            <RotateCw
              className="h-3 w-3 text-savr-info-strong"
              aria-label="Rapport régénéré"
            />
          )}
        </span>
      )}

      {/* ZD passées : poids total + taux de recyclage */}
      {row.type === 'zero_dechet' && poids > 0 && (
        <Badge variant="success" className="text-[10px]">
          {poids.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} kg
        </Badge>
      )}
      {row.type === 'zero_dechet' && row.taux_recyclage != null && (
        <Badge variant="info" className="text-[10px]">
          {row.taux_recyclage.toLocaleString('fr-FR', {
            maximumFractionDigits: 1,
          })}{' '}
          %
        </Badge>
      )}

      {/* AG passées : nombre de repas collectés */}
      {row.type === 'anti_gaspi' && repas != null && (
        <Badge variant="success" className="text-[10px]">
          {repas} repas
        </Badge>
      )}

      {/* AG à venir : statut attribution (§06.06 §3 l.182). mode_validation
          distingue « Validée » (manuel_top1/override) de « Auto-accept ». Le 4e
          état CDC « aucune reco » n'a pas de représentation persistée pré-validation
          en V1 (seul un audit_log post-validation existe) → confondu avec « En
          attente » ici, cf. _Divergences/BOA-COLLECTES_20260702.md. */}
      {row.type === 'anti_gaspi' && upcoming && (
        <Badge variant={attributionBadge(row).variant} className="text-[10px]">
          {attributionBadge(row).label}
        </Badge>
      )}
    </div>
  );
}

const columns: Column<Collecte>[] = [
  {
    key: 'date_collecte',
    header: 'Date + heure',
    render: (row) => (
      <div className="flex flex-col leading-tight">
        <Link
          href={`/admin/collectes/${row.id}`}
          className="font-medium text-primary-700 hover:underline"
        >
          {formatDateHeure(row.date_collecte, row.heure_collecte)}
        </Link>
        {estUrgente(row) && (
          <span className="text-[10px] font-bold uppercase text-savr-error-strong">
            Urgent
          </span>
        )}
      </div>
    ),
  },
  {
    key: 'type',
    header: 'Type',
    render: (row) => (
      <Badge variant={row.type === 'zero_dechet' ? 'success' : 'warning'}>
        {row.type === 'zero_dechet' ? 'ZD' : 'AG'}
      </Badge>
    ),
  },
  {
    key: 'traiteur',
    header: 'Traiteur',
    render: (row) => row.evenements.organisations.raison_sociale,
  },
  {
    key: 'pax',
    header: 'Pax',
    render: (row) => row.evenements.pax ?? '—',
  },
  {
    key: 'lieu',
    header: 'Lieu',
    render: (row) => {
      const l = row.evenements.lieux;
      const adresse = [
        l.adresse_acces,
        [l.code_postal, l.ville].filter(Boolean).join(' '),
      ]
        .filter(Boolean)
        .join(', ');
      return (
        <div className="flex flex-col leading-tight">
          <span className="font-medium text-savr-neutral-900">{l.nom}</span>
          {adresse && (
            <span className="text-xs text-savr-neutral-500">{adresse}</span>
          )}
        </div>
      );
    },
  },
  {
    key: 'client_organisateur',
    header: 'Client organisateur',
    render: (row) =>
      row.evenements.client_organisateur?.raison_sociale ??
      row.evenements.nom_client_organisateur ?? (
        <span className="text-savr-neutral-400">—</span>
      ),
  },
  {
    key: 'controle_acces',
    header: 'Contrôle accès',
    render: (row) => (
      <span title="Plaque + nom chauffeur communiqués avant exécution">
        <Badge variant={row.controle_acces_requis ? 'info' : 'neutral'}>
          {row.controle_acces_requis ? 'Oui' : 'Non'}
        </Badge>
      </span>
    ),
  },
  {
    key: 'statut',
    header: 'Statut',
    render: (row) =>
      aAttribuer(row) ? (
        <Badge variant="neutral">Créée</Badge>
      ) : (
        <StatusCollecte statut={row.statut as StatutCollecte} />
      ),
  },
  {
    key: 'indicateurs',
    header: 'Indicateurs',
    render: (row) => <Indicateurs row={row} />,
  },
  {
    // §06.09 — accès direct à l'écran d'attribution AG depuis la liste collectes.
    // Affiché uniquement pour les collectes AG « à attribuer » (= « Créée » :
    // programmée + sans attribution). Une fois attribuée, plus de bouton.
    key: 'attribution',
    header: '',
    render: (row) =>
      aAttribuer(row) ? (
        <Link
          href={`/admin/attributions-ag/${row.id}`}
          className="text-sm font-medium text-primary-600 hover:underline"
        >
          Attribuer →
        </Link>
      ) : null,
  },
];

export default function CollectesPage() {
  const [collectes, setCollectes] = useState<Collecte[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [chip, setChip] = useState('');
  const [type, setType] = useState('');
  const [statuts, setStatuts] = useState<string[]>([]);
  const [traiteur, setTraiteur] = useState<AutocompleteOption | null>(null);
  const [lieu, setLieu] = useState<AutocompleteOption | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [infoIncomplete, setInfoIncomplete] = useState(false);
  const [rapportNonConsulte, setRapportNonConsulte] = useState(false);
  const [page, setPage] = useState(1);

  // Cache de la liste des traiteurs (filtrage autocomplete côté client — ~80 orgas).
  const traiteursCache = useRef<AutocompleteOption[] | null>(null);

  const fetchTraiteurs = useCallback(
    async (q: string): Promise<AutocompleteOption[]> => {
      if (!traiteursCache.current) {
        const res = await fetch('/api/v1/admin/organisations?type=traiteur');
        if (res.ok) {
          const json = (await res.json()) as {
            data: { id: string; raison_sociale: string }[];
          };
          traiteursCache.current = json.data.map((o) => ({
            id: o.id,
            label: o.raison_sociale,
          }));
        } else {
          traiteursCache.current = [];
        }
      }
      const needle = q.toLowerCase();
      return traiteursCache.current
        .filter((o) => o.label.toLowerCase().includes(needle))
        .slice(0, 20);
    },
    [],
  );

  const fetchLieux = useCallback(
    async (q: string): Promise<AutocompleteOption[]> => {
      const res = await fetch(`/api/v1/admin/lieux?q=${encodeURIComponent(q)}`);
      if (!res.ok) return [];
      const json = (await res.json()) as {
        data: { id: string; nom: string; ville: string | null }[];
      };
      return json.data.slice(0, 20).map((l) => ({
        id: l.id,
        label: l.ville ? `${l.nom} — ${l.ville}` : l.nom,
      }));
    },
    [],
  );

  const fetchCollectes = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page) });
    if (chip) {
      params.set('chip', chip);
    } else {
      if (type) params.set('type', type);
      if (statuts.length > 0) params.set('statuts', statuts.join(','));
      if (traiteur) params.set('organisation_id', traiteur.id);
      if (lieu) params.set('lieu_id', lieu.id);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (infoIncomplete) params.set('info_incomplete', 'true');
      if (rapportNonConsulte) params.set('rapport_non_consulte', 'true');
    }
    const res = await fetch(`/api/v1/admin/collectes?${params}`);
    if (res.ok) {
      const json = (await res.json()) as {
        data: Collecte[];
        total: number;
      };
      setCollectes(json.data);
      setTotal(json.total);
    }
    setLoading(false);
  }, [
    page,
    chip,
    type,
    statuts,
    traiteur,
    lieu,
    from,
    to,
    infoIncomplete,
    rapportNonConsulte,
  ]);

  useEffect(() => {
    void fetchCollectes();
  }, [fetchCollectes]);

  const toggleStatut = (s: string) => {
    setStatuts((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Truck className="h-6 w-6 text-savr-neutral-600" />
          <h1 className="text-2xl font-bold text-savr-neutral-900">
            Collectes
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/collectes/nouvelle">
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Nouvelle collecte
            </Button>
          </Link>
        </div>
      </div>

      {/* Chips filtres prédéfinis */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => {
            setChip('');
            setPage(1);
          }}
          className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
            chip === ''
              ? 'bg-primary-600 text-white'
              : 'bg-savr-neutral-100 text-savr-neutral-700 hover:bg-savr-neutral-200'
          }`}
        >
          Toutes
        </button>
        {CHIPS.map((c) => (
          <button
            key={c.key}
            onClick={() => {
              setChip(c.key);
              setPage(1);
            }}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              chip === c.key
                ? 'bg-primary-600 text-white'
                : 'bg-savr-neutral-100 text-savr-neutral-700 hover:bg-savr-neutral-200'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Filtres libres (§06.06 §3) */}
      {!chip && (
        <div className="space-y-3 rounded-savr-md border border-savr-neutral-200 bg-savr-neutral-50 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-savr-neutral-600">
                Type
              </label>
              <select
                className="h-10 w-full rounded-savr-md border border-savr-neutral-300 bg-savr-white px-3 text-sm"
                value={type}
                onChange={(e) => {
                  setType(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Tous types</option>
                <option value="zero_dechet">ZD</option>
                <option value="anti_gaspi">AG</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-savr-neutral-600">
                Traiteur
              </label>
              <Autocomplete
                aria-label="Filtrer par traiteur"
                placeholder="Rechercher un traiteur…"
                fetchOptions={fetchTraiteurs}
                selected={traiteur}
                onChange={(o) => {
                  setTraiteur(o);
                  setPage(1);
                }}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-savr-neutral-600">
                Lieu
              </label>
              <Autocomplete
                aria-label="Filtrer par lieu"
                placeholder="Rechercher un lieu…"
                fetchOptions={fetchLieux}
                selected={lieu}
                onChange={(o) => {
                  setLieu(o);
                  setPage(1);
                }}
              />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-savr-neutral-600">
                  Du
                </label>
                <input
                  type="date"
                  value={from}
                  onChange={(e) => {
                    setFrom(e.target.value);
                    setPage(1);
                  }}
                  className="h-10 w-full rounded-savr-md border border-savr-neutral-300 bg-savr-white px-2 text-sm"
                />
              </div>
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-savr-neutral-600">
                  Au
                </label>
                <input
                  type="date"
                  value={to}
                  onChange={(e) => {
                    setTo(e.target.value);
                    setPage(1);
                  }}
                  className="h-10 w-full rounded-savr-md border border-savr-neutral-300 bg-savr-white px-2 text-sm"
                />
              </div>
            </div>
          </div>

          {/* Statut — multi-sélection */}
          <div>
            <span className="mb-1 block text-xs font-medium text-savr-neutral-600">
              Statut
            </span>
            <div className="flex flex-wrap gap-1.5">
              {STATUTS_FILTRE.map((s) => {
                const active = statuts.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleStatut(s)}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                      active
                        ? 'bg-primary-600 text-white'
                        : 'bg-savr-white text-savr-neutral-700 border border-savr-neutral-200 hover:bg-savr-neutral-100'
                    }`}
                  >
                    {statutCollecteDisplay(s, 'admin').label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Booléens */}
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm text-savr-neutral-700">
              <input
                type="checkbox"
                checked={infoIncomplete}
                onChange={(e) => {
                  setInfoIncomplete(e.target.checked);
                  setPage(1);
                }}
              />
              Info incomplète
            </label>
            <label className="flex items-center gap-2 text-sm text-savr-neutral-700">
              <input
                type="checkbox"
                checked={rapportNonConsulte}
                onChange={(e) => {
                  setRapportNonConsulte(e.target.checked);
                  setPage(1);
                }}
              />
              Rapport non consulté
            </label>
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[...Array(8)].map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : collectes.length === 0 ? (
        <EmptyState
          icon={<Truck className="h-8 w-8" />}
          title="Aucune collecte"
          description="Aucune collecte ne correspond à votre filtre."
        />
      ) : (
        <DataTable
          columns={columns}
          // Urgents (AG à attribuer < 48h) remontés en tête (§06.09 §1)
          data={[...collectes].sort(
            (a, b) => Number(estUrgente(b)) - Number(estUrgente(a)),
          )}
          keyExtractor={(row) => row.id}
          rowClassName={(r) => (estUrgente(r) ? 'bg-red-50' : '')}
          pagination={{ page, total, limit: 50, onPageChange: setPage }}
        />
      )}
    </div>
  );
}
