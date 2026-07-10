'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Truck } from 'lucide-react';
import { createBrowserSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { PageHero } from '@/components/ui/page-hero';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import {
  CollecteTypeTabs,
  type CollecteType,
} from '@/components/dashboards/index.js';
import {
  TraiteurCollecteCard,
  type TraiteurCollecteCardData,
} from '@/components/collecte/collecte-card-traiteur';

// Refonte liste collectes traiteur (décision Val 2026-07-05, diverge du §04
// actuel — voir _Divergences/M3.1_20260705_liste_collectes.md) : onglets
// Programmées / Historique (statut) × sélecteur ZD / AG (type), cartes
// simplifiées groupées par semaine, actions Modifier / Annuler / Dupliquer.

// Répartition des statuts par onglet (aligné Admin, + brouillon/annulation_demandee).
const STATUTS_PROGRAMMEES = ['brouillon', 'programmee', 'validee', 'en_cours'];
const STATUTS_HISTORIQUE = [
  'realisee',
  'realisee_sans_collecte',
  'cloturee',
  'annulation_demandee',
  'annulee',
  'rejetee_par_prestataire',
];

type Onglet = 'programmees' | 'historique';

// Collectes pouvant porter un rapport RSE téléchargeable (§12 §1.2) — cibles de
// l'export ZIP groupé (BL-P3-06). Les autres statuts historique (annulée, rejetée,
// annulation_demandee) n'ont pas de rapport → non sélectionnables.
const STATUTS_RAPPORT = ['realisee', 'realisee_sans_collecte', 'cloturee'];

interface Lieu {
  nom: string;
  adresse_acces: string | null;
  code_postal: string | null;
  ville: string | null;
}
interface Evenement {
  created_by: string | null;
  pax: number | null;
  nom_client_organisateur: string | null;
  lieux: Lieu | Lieu[] | null;
}
interface CollecteRow {
  id: string;
  type: string;
  statut: string;
  date_collecte: string;
  heure_collecte: string | null;
  programmee_par_tiers: boolean;
  evenements: Evenement | Evenement[] | null;
}

function one<T>(v: T | T[] | null): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function parseJwt(token: string): Record<string, unknown> {
  try {
    const p = token.split('.')[1] ?? '';
    const padded = p.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// Groupe les cartes par semaine (lundi), semaines triées, cartes par date.
function lundiDe(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  if (isNaN(d.getTime())) return dateStr;
  const jour = (d.getDay() + 6) % 7; // 0 = lundi
  d.setDate(d.getDate() - jour);
  return d.toISOString().slice(0, 10);
}
function libelleSemaine(lundi: string): string {
  const d = new Date(`${lundi}T00:00:00`);
  if (isNaN(d.getTime())) return lundi;
  const fin = new Date(d);
  fin.setDate(fin.getDate() + 6);
  const fmt = (x: Date) =>
    x.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
  return `Semaine du ${fmt(d)} — ${fmt(fin)}`;
}

function CollectesContent() {
  const router = useRouter();
  const params = useSearchParams();

  const initialType: CollecteType =
    params.get('type') === 'anti_gaspi' ? 'anti_gaspi' : 'zero_dechet';
  const [typeFiltre, setTypeFiltre] = useState<CollecteType>(initialType);
  const [onglet, setOnglet] = useState<Onglet>(
    params.get('onglet') === 'historique' ? 'historique' : 'programmees',
  );
  const [rows, setRows] = useState<CollecteRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [role, setRole] = useState('');
  const [userId, setUserId] = useState('');

  // Export ZIP groupé des rapports RSE (BL-P3-06, onglet Historique). Mode sélection
  // OPT-IN : la liste reste épurée par défaut, les cases n'apparaissent qu'après
  // activation du bouton « Exporter des rapports (ZIP) ».
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [zipEnCours, setZipEnCours] = useState(false);
  const [zipErreur, setZipErreur] = useState<string | null>(null);

  // Annulation (modale liste — réutilise l'endpoint de la fiche).
  const [annulTarget, setAnnulTarget] = useState<CollecteRow | null>(null);
  const [annulMotif, setAnnulMotif] = useState('');
  const [annulEnCours, setAnnulEnCours] = useState(false);
  const [annulErreur, setAnnulErreur] = useState<string | null>(null);

  useEffect(() => {
    const sb = createBrowserSupabaseClient();
    void sb.auth.getSession().then(({ data }) => {
      const tok = data.session?.access_token;
      if (!tok) return;
      const claims = parseJwt(tok);
      setRole(String(claims.user_role ?? ''));
      setUserId(String(claims.sub ?? ''));
    });
  }, []);

  const charger = useCallback(() => {
    setLoading(true);
    const statuts =
      onglet === 'programmees' ? STATUTS_PROGRAMMEES : STATUTS_HISTORIQUE;
    const qs = new URLSearchParams({
      type: typeFiltre,
      statut: statuts.join(','),
    });
    setSelectionMode(false);
    setSelected(new Set());
    setZipErreur(null);
    fetch(`/api/v1/traiteur/collectes?${qs}`)
      .then((r) => r.json())
      .then((j) => setRows((j.data ?? []) as CollecteRow[]))
      .finally(() => setLoading(false));
  }, [typeFiltre, onglet]);

  useEffect(() => {
    charger();
  }, [charger]);

  function pushQuery(next: { type?: CollecteType; onglet?: Onglet }) {
    const usp = new URLSearchParams(Array.from(params.entries()));
    if (next.type) usp.set('type', next.type);
    if (next.onglet) usp.set('onglet', next.onglet);
    router.replace(`/traiteur/collectes?${usp}`);
  }
  function changeType(t: CollecteType) {
    setTypeFiltre(t);
    pushQuery({ type: t });
  }
  function changeOnglet(o: Onglet) {
    setOnglet(o);
    pushQuery({ onglet: o });
  }

  function exportCsv() {
    window.open(`/api/v1/exports/collectes?type=${typeFiltre}`);
  }

  function toggleSelection(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Export ZIP groupé des rapports RSE de la sélection (BL-P3-06) — POST + blob.
  async function exportZipSelection() {
    if (selected.size === 0) return;
    setZipEnCours(true);
    setZipErreur(null);
    try {
      const res = await fetch('/api/v1/traiteur/rapports-rse/export-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collecte_ids: [...selected] }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setZipErreur(j.error ?? "Échec de l'export.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'rapports-rse.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setSelected(new Set());
      setSelectionMode(false);
    } finally {
      setZipEnCours(false);
    }
  }

  function canWrite(row: CollecteRow): boolean {
    if (role === 'traiteur_manager') return true;
    const evt = one(row.evenements);
    return role === 'traiteur_commercial' && evt?.created_by === userId;
  }

  async function confirmerAnnulation() {
    if (!annulTarget) return;
    setAnnulEnCours(true);
    setAnnulErreur(null);
    try {
      const res = await fetch(
        `/api/v1/traiteur/collectes/${annulTarget.id}/annulation`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ motif: annulMotif }),
        },
      );
      if (res.ok) {
        setAnnulTarget(null);
        setAnnulMotif('');
        charger();
      } else {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setAnnulErreur(j.error ?? "Échec de l'annulation.");
      }
    } finally {
      setAnnulEnCours(false);
    }
  }

  // Cartes + groupement par semaine.
  const groupes = useMemo(() => {
    const cards = rows.map((c) => {
      const evt = one(c.evenements);
      const lieu = one(evt?.lieux ?? null);
      const data: TraiteurCollecteCardData = {
        id: c.id,
        type: c.type,
        statut: c.statut,
        date_collecte: c.date_collecte,
        heure_collecte: c.heure_collecte,
        lieu_nom: lieu?.nom ?? null,
        lieu_adresse:
          [lieu?.adresse_acces, lieu?.code_postal, lieu?.ville]
            .filter(Boolean)
            .join(' ') || null,
        pax: evt?.pax ?? null,
        programmee_par_tiers: c.programmee_par_tiers,
      };
      return { data, row: c };
    });
    const map = new Map<string, typeof cards>();
    for (const item of cards) {
      const k = lundiDe(item.data.date_collecte);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(item);
    }
    return [...map.entries()]
      .sort((a, b) =>
        onglet === 'historique'
          ? b[0].localeCompare(a[0])
          : a[0].localeCompare(b[0]),
      )
      .map(([lundi, items]) => ({
        lundi,
        libelle: libelleSemaine(lundi),
        items: items.sort((a, b) =>
          a.data.date_collecte.localeCompare(b.data.date_collecte),
        ),
      }));
  }, [rows, onglet]);

  const estDemande = annulTarget?.statut === 'validee';

  return (
    <div className="space-y-5">
      <PageHero
        title="Collectes"
        icon={<Truck className="h-6 w-6" />}
        subtitle="Vos collectes Zéro Déchet et Anti-Gaspi · cliquez une carte pour ouvrir la fiche"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={exportCsv}>
              Exporter CSV
            </Button>
            <Button asChild>
              <a href={`/programmer/nouveau?type=${typeFiltre}`}>
                Programmer un événement
              </a>
            </Button>
          </div>
        }
      />

      {/* Onglets Programmées / Historique */}
      <div
        role="tablist"
        aria-label="Statut des collectes"
        className="inline-flex rounded-savr-md border border-savr-neutral-200 bg-savr-white p-1"
      >
        {(
          [
            ['programmees', 'Programmées'],
            ['historique', 'Historique'],
          ] as [Onglet, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={onglet === key}
            onClick={() => changeOnglet(key)}
            className={`rounded px-4 py-1.5 text-sm font-semibold transition-colors ${
              onglet === key
                ? 'bg-savr-primary-700 text-savr-white'
                : 'text-savr-neutral-600 hover:bg-savr-neutral-100'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Sélecteur ZD / AG */}
      <CollecteTypeTabs value={typeFiltre} onChange={changeType} />

      {/* Barre d'export ZIP groupé des rapports RSE (BL-P3-06) — Historique only,
          sélection OPT-IN pour garder la liste épurée par défaut. */}
      {onglet === 'historique' && (
        <div
          className="flex flex-wrap items-center gap-3"
          data-testid="rse-zip-toolbar"
        >
          {!selectionMode ? (
            <Button variant="ghost" onClick={() => setSelectionMode(true)}>
              Exporter des rapports (ZIP)
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                disabled={selected.size === 0 || zipEnCours}
                onClick={() => void exportZipSelection()}
              >
                {zipEnCours
                  ? 'Génération…'
                  : `Exporter la sélection (${selected.size}) en ZIP`}
              </Button>
              <button
                type="button"
                className="text-xs text-savr-neutral-500 hover:underline"
                onClick={() => {
                  setSelectionMode(false);
                  setSelected(new Set());
                  setZipErreur(null);
                }}
              >
                Terminer
              </button>
            </>
          )}
          {zipErreur && (
            <span className="text-sm text-savr-error-600">{zipErreur}</span>
          )}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-savr-neutral-500">Chargement…</p>
      ) : groupes.length === 0 ? (
        <p className="text-sm text-savr-neutral-500">Aucune collecte.</p>
      ) : (
        <div className="space-y-6">
          {groupes.map((g) => (
            <section key={g.lundi} className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-savr-neutral-400">
                {g.libelle}
              </h2>
              <div className="space-y-2">
                {g.items.map(({ data, row }) => {
                  const selectable =
                    selectionMode &&
                    onglet === 'historique' &&
                    STATUTS_RAPPORT.includes(row.statut);
                  const card = (
                    <TraiteurCollecteCard
                      c={data}
                      canWrite={canWrite(row)}
                      onOpen={() =>
                        router.push(`/traiteur/collectes/${data.id}`)
                      }
                      onModifier={() =>
                        router.push(`/traiteur/collectes/${data.id}?edit=1`)
                      }
                      onAnnuler={() => {
                        setAnnulErreur(null);
                        setAnnulMotif('');
                        setAnnulTarget(row);
                      }}
                      onDupliquer={() =>
                        router.push(`/programmer/nouveau?from=${data.id}`)
                      }
                    />
                  );
                  if (!selectable) return <div key={data.id}>{card}</div>;
                  return (
                    <div key={data.id} className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        className="mt-4 h-4 w-4 shrink-0 accent-savr-primary-700"
                        aria-label={`Sélectionner la collecte du ${data.date_collecte} pour l'export ZIP`}
                        checked={selected.has(data.id)}
                        onChange={() => toggleSelection(data.id)}
                      />
                      <div className="min-w-0 flex-1">{card}</div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Modale d'annulation (liste) */}
      <Modal
        open={annulTarget !== null}
        title={estDemande ? "Demander l'annulation" : 'Annuler la collecte'}
        onClose={() => setAnnulTarget(null)}
      >
        <div className="space-y-4">
          <p className="text-sm text-savr-neutral-500">
            {estDemande
              ? 'Votre demande d’annulation sera transmise à l’équipe Savr pour validation.'
              : 'Cette collecte sera annulée immédiatement. Le prestataire sera informé le cas échéant.'}
          </p>
          <label className="block text-sm">
            <span className="text-savr-neutral-700">Motif (facultatif)</span>
            <textarea
              className="mt-1 w-full rounded-savr-md border border-savr-neutral-300 px-3 py-2 text-sm"
              rows={3}
              value={annulMotif}
              onChange={(e) => setAnnulMotif(e.target.value)}
            />
          </label>
          {annulErreur && (
            <p className="text-sm text-savr-error-600">{annulErreur}</p>
          )}
          <div className="flex justify-end gap-2 border-t border-savr-neutral-100 pt-4">
            <Button
              variant="secondary"
              onClick={() => setAnnulTarget(null)}
              disabled={annulEnCours}
            >
              Retour
            </Button>
            <Button
              variant="destructive"
              onClick={() => void confirmerAnnulation()}
              disabled={annulEnCours}
            >
              {estDemande ? 'Confirmer la demande' : "Confirmer l'annulation"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default function TraiteurCollectesPage() {
  return (
    <Suspense fallback={<p className="p-4 text-sm">Chargement…</p>}>
      <CollectesContent />
    </Suspense>
  );
}
