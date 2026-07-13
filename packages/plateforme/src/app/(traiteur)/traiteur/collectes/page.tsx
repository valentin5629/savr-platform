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
import { CollecteFiltreActif } from '@/components/collecte/collecte-filtre-actif';
import {
  readCollecteFiltreLabel,
  periodeCourte,
} from '@/lib/dashboards/collecte-filtre-label';

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
  // Drill-down depuis les Top listes du dashboard (lieu / commercial). Miroir
  // exact : le drill-down porte aussi la période (from/to) + un statut override
  // (`cloturee`) pour que le nombre de lignes = le chiffre du Top liste.
  const lieuFiltre = params.get('lieu');
  const commercialFiltre = params.get('commercial');
  const statutOverride = params.get('statut');
  const fromFiltre = params.get('from');
  const toFiltre = params.get('to');
  const perimetreFiltre = params.get('perimetre');
  const [filtreLabel, setFiltreLabel] = useState<string | null>(null);
  const [rows, setRows] = useState<CollecteRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [role, setRole] = useState('');
  const [userId, setUserId] = useState('');

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
    // Statut override du drill-down (ex. `cloturee`) sinon défaut de l'onglet.
    const statuts = statutOverride
      ? statutOverride.split(',')
      : onglet === 'programmees'
        ? STATUTS_PROGRAMMEES
        : STATUTS_HISTORIQUE;
    const qs = new URLSearchParams({
      type: typeFiltre,
      statut: statuts.join(','),
    });
    if (lieuFiltre) qs.set('lieu_id', lieuFiltre);
    if (commercialFiltre) qs.set('commercial_id', commercialFiltre);
    if (fromFiltre) qs.set('from', fromFiltre);
    if (toFiltre) qs.set('to', toFiltre);
    if (perimetreFiltre) qs.set('perimetre', perimetreFiltre);
    fetch(`/api/v1/traiteur/collectes?${qs}`)
      .then((r) => r.json())
      .then((j) => setRows((j.data ?? []) as CollecteRow[]))
      .finally(() => setLoading(false));
  }, [
    typeFiltre,
    onglet,
    lieuFiltre,
    commercialFiltre,
    statutOverride,
    fromFiltre,
    toFiltre,
    perimetreFiltre,
  ]);

  useEffect(() => {
    charger();
  }, [charger]);

  // Libellé du chip « filtre actif » : d'abord le nom mémorisé au clic
  // (sessionStorage), sinon fallback dérivé/générique (URL partagée, refresh).
  useEffect(() => {
    if (lieuFiltre) setFiltreLabel(readCollecteFiltreLabel('lieu', lieuFiltre));
    else if (commercialFiltre)
      setFiltreLabel(readCollecteFiltreLabel('commercial', commercialFiltre));
    else setFiltreLabel(null);
  }, [lieuFiltre, commercialFiltre]);

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
    // Changer d'onglet lève la restriction `cloturee` du drill-down (permet de
    // « déplier » au-delà des seules clôturées) ; le lieu/commercial + période
    // restent, jusqu'au ✕ du chip.
    const usp = new URLSearchParams(Array.from(params.entries()));
    usp.set('onglet', o);
    usp.delete('statut');
    router.replace(`/traiteur/collectes?${usp}`);
  }
  function clearFiltre() {
    const usp = new URLSearchParams(Array.from(params.entries()));
    ['lieu', 'commercial', 'statut', 'from', 'to', 'perimetre'].forEach((k) =>
      usp.delete(k),
    );
    router.replace(`/traiteur/collectes?${usp}`);
  }

  // Libellé du chip : nom mémorisé, sinon nom du lieu dérivé des lignes, sinon
  // générique. Le filtrage lui-même ne dépend jamais de ce libellé.
  const lieuNomDesRows = (() => {
    const evt = one(rows[0]?.evenements ?? null);
    const lieu = one(evt?.lieux ?? null);
    return lieu?.nom ?? null;
  })();
  const chipLabel = lieuFiltre
    ? `Lieu : ${filtreLabel ?? lieuNomDesRows ?? 'lieu sélectionné'}`
    : commercialFiltre
      ? `Commercial : ${filtreLabel ?? 'commercial sélectionné'}`
      : null;
  // Périmètre appliqué (miroir dashboard) affiché en clair dans le chip.
  const chipScope = (() => {
    const parts: string[] = [];
    if (statutOverride === 'cloturee') parts.push('clôturées');
    const per = periodeCourte(fromFiltre, toFiltre);
    if (per) parts.push(per);
    return parts.length ? parts.join(' · ') : undefined;
  })();

  function exportCsv() {
    window.open(`/api/v1/exports/collectes?type=${typeFiltre}`);
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

      {/* Filtre actif (drill-down depuis une Top liste du dashboard) */}
      {chipLabel && (
        <CollecteFiltreActif
          label={chipLabel}
          scope={chipScope}
          onClear={clearFiltre}
        />
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
                {g.items.map(({ data, row }) => (
                  <TraiteurCollecteCard
                    key={data.id}
                    c={data}
                    canWrite={canWrite(row)}
                    onOpen={() => router.push(`/traiteur/collectes/${data.id}`)}
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
                ))}
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
