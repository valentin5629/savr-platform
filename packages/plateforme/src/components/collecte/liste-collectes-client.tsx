'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  colonnesCollectesTraiteur,
  type TraiteurCollecteLigne,
} from '@/components/collecte/collectes-traiteur-table';
import { DataGrid } from '@/components/ui/data-grid';
import { EmptyState } from '@/components/ui/empty-state';
import { libelleDateHeure } from '@/lib/format-date-collecte';
import { CollecteFiltreActif } from '@/components/collecte/collecte-filtre-actif';
import { FicheCollecteClientModal } from '@/components/collecte/fiche-collecte-client-modal';
import {
  CollecteFiltresBar,
  ecrireFiltresCollecte,
  FILTRES_COLLECTE_VIDES,
  lireFiltresCollecte,
  type CollecteFiltres,
  type CollecteFiltresOptions,
} from '@/components/collecte/collecte-filtres-bar';
import {
  readCollecteFiltreLabel,
  periodeCourte,
} from '@/lib/dashboards/collecte-filtre-label';
import type { EspaceClient } from '@/lib/collectes/fiche-client-types';

// Refonte liste collectes traiteur (décision Val 2026-07-05, diverge du §04
// actuel — voir _Divergences/M3.1_20260705_liste_collectes.md) : onglets
// Programmées / Historique (statut) × sélecteur ZD / AG (type), cartes
// simplifiées, actions Modifier / Annuler / Dupliquer. Passée en Data Table
// (décision Val 2026-09-28 : tableau plat, colonnes triables).
//
// Composant UNIQUE des listes traiteur et agence : §06.11 impose à l'agence la
// liste du §06.04 « à l'identique » (« toute évolution du §06.04 s'applique
// automatiquement à l'agence »). La page agence en avait une copie, restée
// figée avant la refonte 2026-07-05 (revue écran E2E 2026-09-30) ; seules les
// routes API (`/api/v1/<espace>/collectes…`) et le droit d'écriture diffèrent.
export type EspaceListeCollectes = Extract<EspaceClient, 'traiteur' | 'agence'>;

// Bases LITTÉRALES (jamais l'espace interpolé dans le chemin) : les segments
// ajoutés ensuite sont des ids passés par encodeURIComponent (cf.
// scripts/check-fetch-path-encoding.ts, points de composition).
const API_COLLECTES: Record<EspaceListeCollectes, string> = {
  traiteur: '/api/v1/traiteur/collectes',
  agence: '/api/v1/agence/collectes',
};

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

/** Dimensions de drill-down dashboard sans contrôle dans la barre de filtres. */
interface Drill {
  /** Lieu reçu d'un drill-down Top lieux : il a aussi son contrôle dans la
   *  barre, mais le CDC (§06.04 Top lieux) veut le chip « Filtre actif ». */
  lieu: string;
  commercial: string;
  association: string;
  perimetre: string;
}

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
  rapport_reserve_donneur_ordre: boolean;
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

// Onglet de l'URL ; à défaut, déduit des statuts demandés : un lien sans
// `onglet` dont tous les statuts relèvent de l'Historique (ancien format du
// drill-down Top lieux agence, `?lieu=…&statut=cloturee`) ouvre l'Historique.
function ongletInitial(params: URLSearchParams): Onglet {
  const o = params.get('onglet');
  if (o === 'historique' || o === 'programmees') return o;
  const statuts = (params.get('statut') ?? '').split(',').filter(Boolean);
  return statuts.length > 0 &&
    statuts.every((s) => STATUTS_HISTORIQUE.includes(s))
    ? 'historique'
    : 'programmees';
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

export function ListeCollectesClient({
  espace,
}: {
  espace: EspaceListeCollectes;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const api = API_COLLECTES[espace];

  const initialType: CollecteType =
    params.get('type') === 'anti_gaspi' ? 'anti_gaspi' : 'zero_dechet';
  const [typeFiltre, setTypeFiltre] = useState<CollecteType>(initialType);
  const [onglet, setOnglet] = useState<Onglet>(() =>
    ongletInitial(new URLSearchParams(params.toString())),
  );
  // Drill-down depuis les Top listes du dashboard. Lieu, statut (`cloturee`) et
  // période (from/to) arrivent par les MÊMES clés d'URL que les filtres de la
  // barre, qui les reflète donc directement (miroir : nombre de lignes = chiffre
  // du Top liste). Commercial / association / périmètre ne sont pas des filtres
  // d'UI : ils restent portés par l'URL et signalés par le chip « Filtre actif ».
  // Fiche collecte en pop-up (même format que l'Admin, décision Val 2026-09-29) :
  // ouverte depuis l'URL (?collecte=<id>[&edit=1]) → les liens profonds (emails,
  // dashboards, ancienne route [id] qui redirige ici) rouvrent la fiche.
  const [fiche, setFiche] = useState<{ id: string; edit: boolean } | null>(
    () => {
      const id = params.get('collecte');
      return id ? { id, edit: params.get('edit') === '1' } : null;
    },
  );
  const [drill, setDrill] = useState<Drill>(() => ({
    lieu: params.get('lieu') ?? '',
    commercial: params.get('commercial') ?? '',
    association: params.get('association') ?? '',
    perimetre: params.get('perimetre') ?? '',
  }));
  const commercialFiltre = drill.commercial || null;
  const associationFiltre = drill.association || null;
  const perimetreFiltre = drill.perimetre || null;
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
    fetch(`${api}/filtres`)
      .then((r) => r.json())
      .then((j) => {
        if (j.data) setOptions(j.data as CollecteFiltresOptions);
      })
      .catch(() => {
        /* options indisponibles : la barre reste utilisable (listes vides). */
      });
  }, [api]);

  // Paramètres de la liste — partagés avec l'export CSV (§12 « l'export respecte
  // les filtres actifs »). Les statuts sélectionnés sont TOUJOURS bornés à
  // l'onglet courant : l'onglet est une partition par état, un filtre ne doit
  // jamais le déborder.
  const qsListe = useMemo(() => {
    const statutsOnglet =
      onglet === 'programmees' ? STATUTS_PROGRAMMEES : STATUTS_HISTORIQUE;
    const choisis = filtres.statuts.filter((s) => statutsOnglet.includes(s));
    // Jamais de `statut` vide (sélection hors onglet, lien fabriqué) : les
    // routes et l'export ne filtreraient alors plus aucun statut.
    const statuts = choisis.length > 0 ? choisis : statutsOnglet;
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
    return qs.toString();
  }, [
    typeFiltre,
    onglet,
    filtres,
    commercialFiltre,
    associationFiltre,
    perimetreFiltre,
  ]);

  const charger = useCallback(() => {
    setLoading(true);
    fetch(`${api}?${qsListe}`)
      .then((r) => r.json())
      .then((j) => setRows((j.data ?? []) as CollecteRow[]))
      .finally(() => setLoading(false));
  }, [api, qsListe]);

  useEffect(() => {
    charger();
  }, [charger]);

  // Libellé du chip « filtre actif » : d'abord le nom mémorisé au clic
  // (sessionStorage), sinon fallback dérivé/générique (URL partagée, refresh).
  useEffect(() => {
    if (drill.lieu) setFiltreLabel(readCollecteFiltreLabel('lieu', drill.lieu));
    else if (commercialFiltre)
      setFiltreLabel(readCollecteFiltreLabel('commercial', commercialFiltre));
    else if (associationFiltre)
      setFiltreLabel(readCollecteFiltreLabel('association', associationFiltre));
    else setFiltreLabel(null);
  }, [drill.lieu, commercialFiltre, associationFiltre]);

  // L'URL est reconstruite ENTIÈREMENT depuis l'état (jamais depuis
  // `useSearchParams`, en retard d'un rendu après un `router.replace` : deux
  // changements rapprochés — onglet puis type — perdraient le premier).
  function majUrl(etat: {
    onglet?: Onglet;
    type?: CollecteType;
    filtres?: CollecteFiltres;
    drill?: Drill;
    fiche?: { id: string; edit: boolean } | null;
  }) {
    const d = etat.drill ?? drill;
    const f = etat.fiche !== undefined ? etat.fiche : fiche;
    const usp = new URLSearchParams({
      onglet: etat.onglet ?? onglet,
      type: etat.type ?? typeFiltre,
    });
    if (d.commercial) usp.set('commercial', d.commercial);
    if (d.association) usp.set('association', d.association);
    if (d.perimetre) usp.set('perimetre', d.perimetre);
    // `edit` n'est jamais réécrit : un rechargement rouvre la fiche en lecture.
    if (f) usp.set('collecte', f.id);
    router.replace(
      `/${espace}/collectes?${ecrireFiltresCollecte(usp, etat.filtres ?? filtres)}`,
    );
  }
  function ouvrirFiche(id: string, edit = false) {
    const f = { id, edit };
    setFiche(f);
    majUrl({ fiche: f });
  }
  // Les colonnes sont mémoïsées : elles appellent la version COURANTE (sinon
  // `majUrl` réécrirait l'URL avec les filtres du premier rendu).
  const ouvrirFicheRef = useRef(ouvrirFiche);
  ouvrirFicheRef.current = ouvrirFiche;
  // Une action dans la fiche (édition, annulation…) peut changer la liste :
  // on la recharge à chaque fermeture.
  function fermerFiche() {
    setFiche(null);
    majUrl({ fiche: null });
    charger();
  }
  function setFiltres(f: CollecteFiltres) {
    setFiltresEtat(f);
    majUrl({ filtres: f });
  }

  function changeType(t: CollecteType) {
    setTypeFiltre(t);
    // Changer de type ZD/AG sort du miroir : on lâche le périmètre miroir
    // (statut/période/perimetre) ET le filtre association (AG-only → liste vide
    // en ZD). Les filtres type-agnostiques (lieu, client, info incomplète,
    // programmée par) et le commercial sont conservés.
    const f = { ...filtres, statuts: [], from: '', to: '' };
    const d = { ...drill, association: '', perimetre: '' };
    setFiltresEtat(f);
    setDrill(d);
    majUrl({ type: t, filtres: f, drill: d });
  }
  function changeOnglet(o: Onglet) {
    setOnglet(o);
    // L'onglet partitionne les statuts : une sélection faite dans l'autre onglet
    // n'a plus de sens ici (intersection vide). Changer d'onglet lève donc aussi
    // la restriction `cloturee` du drill-down ; lieu + période restent.
    const f = { ...filtres, statuts: [] };
    setFiltresEtat(f);
    majUrl({ onglet: o, filtres: f });
  }
  // ✕ du chip : sort du drill-down ET de son périmètre miroir (lieu, statut,
  // période), comme avant la barre DS.
  function clearFiltre() {
    const d = { lieu: '', commercial: '', association: '', perimetre: '' };
    setDrill(d);
    setFiltresEtat(FILTRES_COLLECTE_VIDES);
    majUrl({ drill: d, filtres: FILTRES_COLLECTE_VIDES });
  }

  // Chip « Filtre actif » (drill-down depuis une Top liste du dashboard) :
  // libellé mémorisé au clic, sinon dérivé, sinon générique. Le filtrage ne
  // dépend jamais de ce libellé. Le lieu n'y figure que tant que la barre
  // filtre encore sur le lieu reçu.
  const lieuDrillActif = drill.lieu !== '' && filtres.lieuId === drill.lieu;
  const lieuNom =
    filtreLabel ??
    options.lieux.find((l) => l.id === drill.lieu)?.nom ??
    one(one(rows[0]?.evenements ?? null)?.lieux ?? null)?.nom ??
    'lieu sélectionné';
  const chipLabel = lieuDrillActif
    ? `Lieu : ${lieuNom}`
    : commercialFiltre
      ? `Commercial : ${filtreLabel ?? 'commercial sélectionné'}`
      : associationFiltre
        ? `Association : ${filtreLabel ?? 'association sélectionnée'}`
        : null;
  // Périmètre miroir affiché en clair dans le chip.
  const chipScope = (() => {
    const parts: string[] = [];
    if (filtres.statuts.length === 1 && filtres.statuts[0] === 'cloturee')
      parts.push('clôturées');
    const per = periodeCourte(filtres.from || null, filtres.to || null);
    if (per) parts.push(per);
    return parts.length ? parts.join(' · ') : undefined;
  })();

  // Mêmes paramètres que la liste affichée. Le builder d'export applique type,
  // statuts de l'onglet, période, lieu, client, info incomplète, programmée
  // par ; il IGNORE encore les dimensions de drill-down traiteur
  // (commercial_id, association_id, perimetre) : après un clic depuis une Top
  // liste du dashboard, l'export peut contenir plus de lignes que la liste.
  function exportCsv() {
    window.open(`/api/v1/exports/collectes?${qsListe}`);
  }

  // Téléchargement du rapport de la collecte réalisée (ZD = rapport recyclage,
  // AG = attestation de don) — miroir du bouton de la fiche : URL R2 pré-signée,
  // no-op silencieux si indisponible (embargo H+24, PDF non encore généré) ou en
  // cas d'échec réseau.
  async function telechargerRapport(collecteId: string) {
    try {
      const res = await fetch(
        `${api}/${encodeURIComponent(collecteId)}/rapport-rse/download`,
      );
      if (!res.ok) return;
      const { url } = (await res.json()) as { url?: string };
      if (url) window.open(url, '_blank');
    } catch {
      // Réseau indisponible : no-op silencieux (l'action reste réessayable).
    }
  }

  // Reflet UI des gardes serveur (PATCH / annulation), qui restent seules juges.
  // L'agence est un rôle unique qui voit toute l'activité de son organisation,
  // « comme un traiteur_manager » (§06.11 différence #2).
  function canWrite(row: CollecteRow): boolean {
    if (role === 'traiteur_manager' || role === 'agence') return true;
    const evt = one(row.evenements);
    return role === 'traiteur_commercial' && evt?.created_by === userId;
  }

  async function confirmerAnnulation() {
    if (!annulTarget) return;
    setAnnulEnCours(true);
    setAnnulErreur(null);
    try {
      const res = await fetch(
        `${api}/${encodeURIComponent(annulTarget.id)}/annulation`,
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

  // Lignes de la Data Table (aplaties : lieu / pax / droit d'écriture).
  const lignes = useMemo<TraiteurCollecteLigne[]>(
    () =>
      rows.map((c) => {
        const evt = one(c.evenements);
        const lieu = one(evt?.lieux ?? null);
        return {
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
          rapport_reserve_donneur_ordre: c.rapport_reserve_donneur_ordre,
          canWrite: canWrite(c),
          poids_total_kg: c.poids_total_kg,
          taux_recyclage: c.taux_recyclage,
          co2_evite_kg: c.co2_evite_kg,
          nb_repas_donnes: c.nb_repas_donnes,
        };
      }),
    // canWrite dépend de role / userId (claims JWT chargés après coup).
    [rows, role, userId],
  );

  const colonnes = useMemo(
    () =>
      colonnesCollectesTraiteur({
        onModifier: (c) => ouvrirFicheRef.current(c.id, true),
        onAnnuler: (c) => {
          setAnnulErreur(null);
          setAnnulMotif('');
          setAnnulTarget(rows.find((r) => r.id === c.id) ?? null);
        },
        onDupliquer: (c) => router.push(`/programmer/nouveau?from=${c.id}`),
        onTelecharger: (c) => void telechargerRapport(c.id),
      }),
    // telechargerRapport ne dépend que de `api` (aucune dépendance d'état).
    [router, rows, api],
  );

  const estDemande = annulTarget?.statut === 'validee';

  return (
    <div className="space-y-5">
      <PageHero
        title="Collectes"
        icon={<Truck className="h-6 w-6" />}
        subtitle="Vos collectes Zéro Déchet et Anti-Gaspi · cliquez une ligne pour ouvrir la fiche"
        actions={
          // Sur l'aplat navy du bandeau : secondaire (fond blanc) + CTA accent,
          // comme les autres PageHero ; un ghost navy y était invisible. Pas de
          // wrapper : le slot d'actions du PageHero passe à la ligne sur mobile.
          <>
            <Button variant="secondary" onClick={exportCsv}>
              Exporter CSV
            </Button>
            <Button variant="accent" asChild>
              <a href={`/programmer/nouveau?type=${typeFiltre}`}>
                Programmer un événement
              </a>
            </Button>
          </>
        }
      />

      {/* Filtre actif (drill-down depuis une Top liste du dashboard) */}
      {chipLabel && (
        <CollecteFiltreActif
          label={chipLabel}
          scope={chipScope}
          onClear={clearFiltre}
        />
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

      {/* Tri par défaut §06.04 §3 : date DÉCROISSANTE, sans exception d'onglet
          (arbitrage Val 2026-09-21, cf. _Divergences/_traités/2026-09/
          M3.1_20260921_tri_liste_collectes.md). Colonnes triables ensuite. */}
      <DataGrid
        key={onglet}
        data-testid="collectes-table"
        columns={colonnes}
        data={lignes}
        getRowId={(c) => c.id}
        loading={loading}
        initialSorting={[{ id: 'date', desc: true }]}
        initialColumnVisibility={
          onglet === 'programmees' ? { resultats: false } : {}
        }
        onRowClick={(c) => ouvrirFiche(c.id)}
        rowLabel={(c) =>
          `Ouvrir la collecte du ${libelleDateHeure(c.date_collecte, c.heure_collecte)}${c.lieu_nom ? ` — ${c.lieu_nom}` : ''}`
        }
        empty={
          <EmptyState
            icon={<Truck className="h-8 w-8" />}
            title="Aucune collecte"
            description="Aucune collecte ne correspond à ces filtres."
          />
        }
      />

      <FicheCollecteClientModal
        espace={espace}
        collecteId={fiche?.id ?? null}
        initialEditing={fiche?.edit ?? false}
        onClose={fermerFiche}
      />

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
              : 'Cette collecte sera annulée immédiatement. Nous prévenons notre équipe logistique.'}
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
