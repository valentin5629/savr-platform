'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Truck } from 'lucide-react';
import { createBrowserSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { PageHero } from '@/components/ui/page-hero';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { FormField } from '@/components/ui/form-field';
import { Textarea } from '@/components/ui/textarea';
import type { CollecteType } from '@/components/dashboards/index.js';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  TraiteurCollecteCard,
  type TraiteurCollecteCardData,
} from '@/components/collecte/collecte-card-traiteur';
import { CollecteFiltreActif } from '@/components/collecte/collecte-filtre-actif';
import {
  CollecteFiltresBar,
  ecrireFiltresCollecte,
  lireFiltresCollecte,
  type CollecteFiltres,
  type CollecteFiltresOptions,
} from '@/components/collecte/collecte-filtres-bar';
import { readCollecteFiltreLabel } from '@/lib/dashboards/collecte-filtre-label';
import {
  decalerJour,
  formatJour,
  lundiDeLaSemaine,
} from '@savr/shared/src/temps/index.js';

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
  // Résultats de la collecte réalisée (renvoyés par la route, agrégés côté serveur).
  poids_total_kg: number | null;
  taux_recyclage: number | null;
  co2_evite_kg: number | null;
  nb_repas_donnes: number | null;
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
  return lundiDeLaSemaine(dateStr);
}
function libelleSemaine(lundi: string): string {
  const fin = decalerJour(lundi, 6);
  if (!fin) return lundi;
  const fmt = (j: string) => formatJour(j, { day: '2-digit', month: 'short' });
  return `Semaine du ${fmt(lundi)} — ${fmt(fin)}`;
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
  // Drill-down depuis les Top listes du dashboard. Lieu, statut (`cloturee`) et
  // période (from/to) arrivent par les MÊMES clés d'URL que les filtres de la
  // barre, qui les reflète donc directement (miroir : nombre de lignes = chiffre
  // du Top liste). Commercial / association / périmètre ne sont pas des filtres
  // d'UI : ils restent portés par l'URL et signalés par le chip « Filtre actif ».
  const commercialFiltre = params.get('commercial');
  const associationFiltre = params.get('association');
  const perimetreFiltre = params.get('perimetre');
  const [filtreLabel, setFiltreLabel] = useState<string | null>(null);
  const [rows, setRows] = useState<CollecteRow[]>([]);
  const [loading, setLoading] = useState(true);
  // Filtres §06.04 §3 (BL-P2-14), synchronisés dans l'URL : l'état local est la
  // vérité immédiate, chaque changement réécrit la query-string (replace, pas
  // d'entrée d'historique) pour qu'un filtre survive au rechargement et au
  // partage de lien.
  const [filtres, setFiltresEtat] = useState<CollecteFiltres>(() =>
    lireFiltresCollecte(new URLSearchParams(params.toString())),
  );
  const [options, setOptions] = useState<CollecteFiltresOptions>({
    lieux: [],
    clients: [],
    programmateurs: [],
  });

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

  // Options des filtres (lieux / clients / programmateurs) — dérivées du périmètre
  // visible de l'appelant, chargées une fois.
  useEffect(() => {
    fetch('/api/v1/traiteur/collectes/filtres')
      .then((r) => r.json())
      .then((j) => {
        if (j.data) setOptions(j.data as CollecteFiltresOptions);
      })
      .catch(() => {
        /* options indisponibles : la barre reste utilisable (listes vides). */
      });
  }, []);

  const charger = useCallback(() => {
    setLoading(true);
    // Les statuts sélectionnés sont TOUJOURS bornés à l'onglet courant : l'onglet
    // est une partition par état, un filtre ne doit jamais le déborder.
    const statutsOnglet =
      onglet === 'programmees' ? STATUTS_PROGRAMMEES : STATUTS_HISTORIQUE;
    const statuts =
      filtres.statuts.length > 0
        ? filtres.statuts.filter((s) => statutsOnglet.includes(s))
        : statutsOnglet;
    const qs = new URLSearchParams({
      type: typeFiltre,
      statut: statuts.join(','),
    });
    if (filtres.lieuId) qs.set('lieu_id', filtres.lieuId);
    if (filtres.client) qs.set('client', filtres.client);
    if (filtres.infoIncomplete)
      qs.set('info_incomplete', filtres.infoIncomplete);
    if (filtres.programmeePar.length > 0)
      qs.set('programmee_par', filtres.programmeePar.join(','));
    if (filtres.from) qs.set('from', filtres.from);
    if (filtres.to) qs.set('to', filtres.to);
    // Drill-down depuis les Top listes du dashboard (pas des filtres d'UI).
    if (commercialFiltre) qs.set('commercial_id', commercialFiltre);
    if (associationFiltre) qs.set('association_id', associationFiltre);
    if (perimetreFiltre) qs.set('perimetre', perimetreFiltre);
    fetch(`/api/v1/traiteur/collectes?${qs}`)
      .then((r) => r.json())
      .then((j) => setRows((j.data ?? []) as CollecteRow[]))
      .finally(() => setLoading(false));
  }, [
    typeFiltre,
    onglet,
    filtres,
    commercialFiltre,
    associationFiltre,
    perimetreFiltre,
  ]);

  useEffect(() => {
    charger();
  }, [charger]);

  // Libellé du chip « filtre actif » : d'abord le nom mémorisé au clic
  // (sessionStorage), sinon fallback dérivé/générique (URL partagée, refresh).
  useEffect(() => {
    if (commercialFiltre)
      setFiltreLabel(readCollecteFiltreLabel('commercial', commercialFiltre));
    else if (associationFiltre)
      setFiltreLabel(readCollecteFiltreLabel('association', associationFiltre));
    else setFiltreLabel(null);
  }, [commercialFiltre, associationFiltre]);

  // Réécrit l'URL à partir des paramètres courants : `muter` retire/pose les
  // clés hors filtres, puis les filtres sont (ré)écrits depuis `f`.
  function majUrl(f: CollecteFiltres, muter?: (usp: URLSearchParams) => void) {
    const usp = new URLSearchParams(params.toString());
    muter?.(usp);
    router.replace(`/traiteur/collectes?${ecrireFiltresCollecte(usp, f)}`);
  }
  function setFiltres(f: CollecteFiltres) {
    setFiltresEtat(f);
    majUrl(f);
  }

  function changeType(t: CollecteType) {
    setTypeFiltre(t);
    // Changer de type ZD/AG sort du miroir : on lâche le périmètre miroir
    // (statut/période/perimetre) ET le filtre association (AG-only → liste vide
    // en ZD). Les filtres type-agnostiques (lieu, client, info incomplète,
    // programmée par) et le commercial sont conservés.
    const f = { ...filtres, statuts: [], from: '', to: '' };
    setFiltresEtat(f);
    majUrl(f, (usp) => {
      usp.set('type', t);
      usp.delete('association');
      usp.delete('perimetre');
    });
  }
  function changeOnglet(o: Onglet) {
    setOnglet(o);
    // L'onglet partitionne les statuts : une sélection faite dans l'autre onglet
    // n'a plus de sens ici (intersection vide). Changer d'onglet lève donc aussi
    // la restriction `cloturee` du drill-down ; lieu + période restent.
    const f = { ...filtres, statuts: [] };
    setFiltresEtat(f);
    majUrl(f, (usp) => usp.set('onglet', o));
  }
  function clearFiltre() {
    majUrl(filtres, (usp) =>
      ['commercial', 'association', 'perimetre'].forEach((k) => usp.delete(k)),
    );
  }

  // Chip « Filtre actif » : seulement pour les dimensions de drill-down que la
  // barre n'affiche pas (commercial, association). Libellé : nom mémorisé au
  // clic, sinon générique. Le filtrage ne dépend jamais de ce libellé.
  const chipLabel = commercialFiltre
    ? `Commercial : ${filtreLabel ?? 'commercial sélectionné'}`
    : associationFiltre
      ? `Association : ${filtreLabel ?? 'association sélectionnée'}`
      : null;

  function exportCsv() {
    window.open(`/api/v1/exports/collectes?type=${typeFiltre}`);
  }

  // Téléchargement du rapport de la collecte réalisée (ZD = rapport recyclage,
  // AG = attestation de don) — miroir du bouton de la fiche : URL R2 pré-signée,
  // no-op silencieux si indisponible (embargo H+24, PDF non encore généré) ou en
  // cas d'échec réseau.
  async function telechargerRapport(collecteId: string) {
    try {
      const res = await fetch(
        `/api/v1/traiteur/collectes/${encodeURIComponent(collecteId)}/rapport-rse/download`,
      );
      if (!res.ok) return;
      const { url } = (await res.json()) as { url?: string };
      if (url) window.open(url, '_blank');
    } catch {
      // Réseau indisponible : no-op silencieux (l'action reste réessayable).
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
        `/api/v1/traiteur/collectes/${encodeURIComponent(annulTarget.id)}/annulation`,
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
        poids_total_kg: c.poids_total_kg,
        taux_recyclage: c.taux_recyclage,
        co2_evite_kg: c.co2_evite_kg,
        nb_repas_donnes: c.nb_repas_donnes,
      };
      return { data, row: c };
    });
    const map = new Map<string, typeof cards>();
    for (const item of cards) {
      const k = lundiDe(item.data.date_collecte);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(item);
    }
    // Tri par défaut §06.04 §3 : date DÉCROISSANTE (les plus récentes en
    // premier), sans exception d'onglet — au niveau des semaines COMME à
    // l'intérieur d'une semaine. Le tri conditionnel par onglet qui existait ici
    // contredisait le CDC ; arbitrage Val 2026-09-21 (option B : c'est le code
    // qui s'aligne), cf. _Divergences/_traités/2026-09/
    // M3.1_20260921_tri_liste_collectes.md.
    return [...map.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([lundi, items]) => ({
        lundi,
        libelle: libelleSemaine(lundi),
        items: items.sort((a, b) =>
          b.data.date_collecte.localeCompare(a.data.date_collecte),
        ),
      }));
  }, [rows]);

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

      {/* Filtre actif (drill-down commercial / association depuis le dashboard) */}
      {chipLabel && (
        <CollecteFiltreActif label={chipLabel} onClear={clearFiltre} />
      )}

      {/* Barre de filtres DS : onglets Programmées / Historique + type ZD / AG
          en en-tête, puis Statut / Période / Lieu / Client / Info incomplète /
          Programmée par (§06.04 §3), compteur et réinitialisation en pied. */}
      <CollecteFiltresBar
        tabs={
          <Tabs value={onglet} onValueChange={(v) => changeOnglet(v as Onglet)}>
            <TabsList aria-label="Statut des collectes">
              <TabsTrigger value="programmees">Programmées</TabsTrigger>
              <TabsTrigger value="historique">Historique</TabsTrigger>
            </TabsList>
          </Tabs>
        }
        toggle={
          <ToggleGroup
            type="single"
            aria-label="Type de collecte"
            value={typeFiltre}
            onValueChange={(v) => {
              // Un clic sur l'item actif le désélectionne (v = '') : le type
              // est obligatoire, on l'ignore.
              if (v) changeType(v as CollecteType);
            }}
          >
            <ToggleGroupItem value="zero_dechet">Zéro Déchet</ToggleGroupItem>
            <ToggleGroupItem value="anti_gaspi">Anti-Gaspi</ToggleGroupItem>
          </ToggleGroup>
        }
        statutsOnglet={
          onglet === 'programmees' ? STATUTS_PROGRAMMEES : STATUTS_HISTORIQUE
        }
        options={options}
        value={filtres}
        onChange={setFiltres}
        resultats={rows.length}
      />

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
                    onTelecharger={() => void telechargerRapport(data.id)}
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
          <FormField
            label="Motif (facultatif)"
            htmlFor="annulation-motif"
            error={annulErreur ?? undefined}
          >
            <Textarea
              id="annulation-motif"
              rows={3}
              value={annulMotif}
              onChange={(e) => setAnnulMotif(e.target.value)}
            />
          </FormField>
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
