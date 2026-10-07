'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChefHat, MapPin } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { EnTetePuce, FicheEnTete } from '@/components/ui/fiche/fiche-en-tete';
import { FicheCorps, FicheModal } from '@/components/ui/fiche/fiche-modal';
import { SectionHeader } from '@/components/ui/section-header';
import { Skeleton } from '@/components/ui/skeleton';
import { StatCard } from '@/components/ui/stat-card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Text } from '@/components/ui/text';
import {
  ToggleTypeCollecte,
  type CollecteType,
} from '@/components/collecte/toggle-type-collecte';
import { EvolutionAgChart } from '@/components/dashboards/charts/cockpit/EvolutionAgChart';
import { EvolutionZdChart } from '@/components/dashboards/charts/cockpit/EvolutionZdChart';
import {
  fmtDec,
  fmtInt,
  fmtMasse,
} from '@/components/dashboards/charts/cockpit/fmt';
import { KPI_DOT } from '@/components/dashboards/charts/cockpit/palette';
import type { DashboardFilters } from '@/components/dashboards/DashboardFilterBar';
import { useEvolutionBlocs } from '@/components/dashboards/useEvolutionBlocs';
import {
  previousWindow,
  sparkFromSeries,
  variationPct,
} from '@/lib/dashboards/cockpit-derive';
import { periodeDerniers } from '@/lib/periodes-raccourcis';

// Fiche traiteur du gestionnaire de lieux, en pop-up sur la liste Traiteurs
// (§06.05 §5 — arbitrage Val 2026-10-07, ex-page /gestionnaire/traiteurs/[id]).
// Cadre commun des fiches (FicheModal : grand en-tête, onglets, corps défilant).
//
// Vue non commerciale et en lecture seule : nom et logo du traiteur, puis ce
// qu'il a fait SUR LES LIEUX DE L'ORGANISATION — jamais ailleurs, jamais de
// tarif ni de coordonnée. Deux onglets : les lieux où il est intervenu, et son
// activité (cartes KPI et graphique du dashboard, filtrés sur lui).

interface LieuIntervention {
  id: string;
  nom: string;
  nb_collectes: number;
}

interface FicheTraiteur {
  id: string;
  nom: string;
  logo_url: string | null;
  lieux_intervention: LieuIntervention[];
}

type Etat = 'chargement' | 'erreur' | 'introuvable' | 'pret';

const COLONNES_LIEUX: Column<LieuIntervention>[] = [
  { key: 'nom', header: 'Lieu', render: (l) => l.nom },
  {
    key: 'nb_collectes',
    header: 'Collectes 24 m',
    render: (l) => fmtInt(l.nb_collectes),
  },
];

export function FicheTraiteurModal({
  traiteurId,
  onClose,
}: {
  // Monté par la liste seulement quand une fiche est ouverte.
  traiteurId: string;
  onClose: () => void;
}) {
  const [traiteur, setTraiteur] = useState<FicheTraiteur | null>(null);
  const [etat, setEtat] = useState<Etat>('chargement');
  const [tentative, setTentative] = useState(0);
  // Logo que le proxy n'a pas rendu (clé héritée hors format, objet absent) :
  // on retombe sur le nom seul plutôt que sur une vignette cassée.
  const [logoKo, setLogoKo] = useState(false);

  useEffect(() => {
    let annule = false;
    setTraiteur(null);
    setEtat('chargement');
    setLogoKo(false);
    fetch(`/api/v1/gestionnaire/traiteurs/${encodeURIComponent(traiteurId)}`)
      .then((r) => {
        if (r.status === 404) return null;
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ data: FicheTraiteur }>;
      })
      .then((j) => {
        if (annule) return;
        if (!j) {
          setEtat('introuvable');
          return;
        }
        setTraiteur(j.data);
        setEtat('pret');
      })
      // §10 §7 « Error » : un échec de chargement ne se lit jamais comme un vide.
      .catch(() => {
        if (!annule) setEtat('erreur');
      });
    return () => {
      annule = true;
    };
  }, [traiteurId, tentative]);

  const nbLieux = traiteur?.lieux_intervention.length ?? 0;

  return (
    <FicheModal
      open
      title={traiteur?.nom ?? 'Fiche traiteur'}
      onClose={onClose}
    >
      {etat === 'chargement' && (
        <>
          <FicheEnTete titre="Fiche traiteur" />
          {/* §10 §7 « Loading » : skeletons à la forme du contenu. */}
          <FicheCorps className="space-y-4 py-6" aria-busy="true">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-40 w-full" />
          </FicheCorps>
        </>
      )}

      {etat === 'erreur' && (
        <>
          <FicheEnTete titre="Fiche traiteur" />
          <FicheCorps className="py-6">
            <ErrorState
              message="Impossible de charger ce traiteur. Le service n'a pas répondu. Vérifiez votre connexion puis réessayez."
              onRetry={() => setTentative((n) => n + 1)}
            />
          </FicheCorps>
        </>
      )}

      {etat === 'introuvable' && (
        <>
          <FicheEnTete titre="Fiche traiteur" />
          <FicheCorps className="py-6">
            <EmptyState
              icon={<ChefHat className="h-8 w-8" />}
              title="Traiteur non trouvé"
              description="Ce traiteur n'existe pas ou n'est pas intervenu sur vos lieux."
            />
          </FicheCorps>
        </>
      )}

      {etat === 'pret' && traiteur && (
        <>
          <FicheEnTete
            surtitre={
              <>
                {traiteur.logo_url && !logoKo && (
                  <img
                    // logo_url porte une CLÉ R2, pas une URL : seul le proxy la
                    // résout, dans le périmètre v_traiteurs_gestionnaire.
                    src={`/api/v1/gestionnaire/traiteurs/${encodeURIComponent(traiteur.id)}/logo`}
                    alt=""
                    onError={() => setLogoKo(true)}
                    className="h-8 w-8 rounded-savr-full object-cover"
                  />
                )}
                <EnTetePuce>Traiteur</EnTetePuce>
              </>
            }
            titre={traiteur.nom}
            infosTestId="fiche-traiteur-infos"
            infos={[
              {
                icon: MapPin,
                texte:
                  nbLieux > 0
                    ? `${nbLieux} lieu${nbLieux > 1 ? 'x' : ''} d’intervention sur 24 mois`
                    : 'Aucune intervention sur 24 mois',
              },
            ]}
          />
          <FicheCorps>
            <Tabs defaultValue="lieux">
              <TabsList>
                <TabsTrigger value="lieux">
                  Lieux d’intervention{nbLieux > 0 ? ` (${nbLieux})` : ''}
                </TabsTrigger>
                <TabsTrigger value="activite">Activité</TabsTrigger>
              </TabsList>

              <TabsContent value="lieux" className="space-y-4">
                <Card padding="md" className="space-y-4">
                  <SectionHeader
                    icon={MapPin}
                    title="Lieux d’intervention"
                    level={3}
                  />
                  {nbLieux === 0 ? (
                    <EmptyState
                      size="inline"
                      title="Aucune collecte clôturée sur vos lieux au cours des 24 derniers mois."
                    />
                  ) : (
                    <>
                      <Text variant="hint">
                        Collectes clôturées de ce traiteur sur vos lieux, au
                        cours des 24 derniers mois.
                      </Text>
                      <DataTable
                        columnsToggle={false}
                        columns={COLONNES_LIEUX}
                        data={traiteur.lieux_intervention}
                        keyExtractor={(l) => l.id}
                      />
                    </>
                  )}
                </Card>
              </TabsContent>

              <TabsContent value="activite">
                <ActiviteTraiteur traiteurId={traiteur.id} />
              </TabsContent>
            </Tabs>
          </FicheCorps>
        </>
      )}
    </FicheModal>
  );
}

// Onglet Activité : les 4 cartes KPI et le graphique d'évolution du dashboard
// (§11 Blocs 1 et 2), filtrés sur ce traiteur, sur les 12 derniers mois, pour
// le type choisi — Zéro Déchet ou Anti-Gaspi (arbitrage Val 2026-10-07). Mêmes
// routes et mêmes composants que le dashboard : les chiffres de la fiche sont
// ceux du dashboard filtré sur le traiteur (collectes clôturées sur les lieux de
// l'organisation). Monté à l'ouverture de l'onglet seulement (Tabs ne rend que
// l'onglet actif).
function ActiviteTraiteur({ traiteurId }: { traiteurId: string }) {
  const [type, setType] = useState<CollecteType>('zero_dechet');
  // « Réessayer » remonte le bloc : ses chargements repartent de zéro.
  const [tentative, setTentative] = useState(0);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <ToggleTypeCollecte value={type} onChange={setType} />
        <Text variant="hint">
          Collectes clôturées sur vos lieux, 12 derniers mois.
        </Text>
      </div>
      <BlocActivite
        key={`${type}-${tentative}`}
        traiteurId={traiteurId}
        type={type}
        onRetry={() => setTentative((n) => n + 1)}
      />
    </div>
  );
}

// Les 4 cartes du dashboard gestionnaire (`/api/v1/gestionnaire/dashboard`).
interface Kpis {
  nb_collectes: number | null;
  tonnage_kg?: number | null;
  taux_recyclage_pondere?: number | null;
  kg_par_pax?: number | null;
  nb_repas_donnes?: number | null;
  pax_total?: number | null;
  repas_par_pax?: number | null;
}

// KPIs de la période et de la période précédente équivalente (variation des
// cartes), comme le dashboard. La période précédente n'est pas bloquante : son
// échec ne masque que les variations.
function useKpis(filtres: DashboardFilters | null, type: CollecteType) {
  const [kpi, setKpi] = useState<Kpis | null>(null);
  const [kpiPrev, setKpiPrev] = useState<Kpis | null>(null);
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState(false);

  useEffect(() => {
    if (!filtres) return;
    let annule = false;
    setLoading(true);
    setErreur(false);
    const lire = (from: string, to: string): Promise<Kpis | null> => {
      const qs = new URLSearchParams({ from, to, type });
      (filtres.traiteur_ids ?? []).forEach((id) =>
        qs.append('traiteur_ids[]', id),
      );
      return fetch(`/api/v1/gestionnaire/dashboard?${qs}`)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json() as Promise<{ data?: { kpis?: Kpis | null } }>;
        })
        .then((j) => j.data?.kpis ?? null);
    };
    const precedente = previousWindow(filtres.from, filtres.to);
    Promise.all([
      lire(filtres.from, filtres.to),
      precedente
        ? lire(precedente.from, precedente.to).catch(() => null)
        : Promise.resolve(null),
    ])
      .then(([courant, avant]) => {
        if (annule) return;
        setKpi(courant);
        setKpiPrev(avant);
      })
      .catch(() => {
        if (!annule) setErreur(true);
      })
      .finally(() => {
        if (!annule) setLoading(false);
      });
    return () => {
      annule = true;
    };
  }, [filtres, type]);

  return { kpi, kpiPrev, loading, erreur };
}

function BlocActivite({
  traiteurId,
  type,
  onRetry,
}: {
  traiteurId: string;
  type: CollecteType;
  onRetry: () => void;
}) {
  const filtres = useMemo<DashboardFilters | null>(() => {
    const periode = periodeDerniers(12, 'mois');
    return periode ? { ...periode, traiteur_ids: [traiteurId] } : null;
  }, [traiteurId]);
  const evolution = useEvolutionBlocs(filtres, type);
  const { kpi, kpiPrev, loading, erreur } = useKpis(filtres, type);
  const zd = type === 'zero_dechet';

  if (erreur || evolution.erreur)
    return (
      <ErrorState
        message="Impossible de charger l'activité de ce traiteur. Le service n'a pas répondu. Vérifiez votre connexion puis réessayez."
        onRetry={onRetry}
      />
    );
  if (loading || evolution.loading)
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
        <Skeleton className="h-72 w-full" />
      </div>
    );
  if (!kpi?.nb_collectes)
    return (
      <Card padding="md">
        <EmptyState
          size="inline"
          title={`Aucune collecte ${zd ? 'Zéro Déchet' : 'Anti-Gaspi'} clôturée sur vos lieux au cours des 12 derniers mois.`}
        />
      </Card>
    );

  const { zdSeries, agSeries, granularite } = evolution;
  // Cartes : mêmes libellés, formats et couleurs que le Bloc 1 du dashboard
  // gestionnaire (`(gestionnaire)/gestionnaire/page.tsx`).
  return (
    <div className="space-y-4">
      {zd ? (
        <div
          className="grid grid-cols-2 gap-4 lg:grid-cols-4"
          data-testid="fiche-traiteur-kpis"
        >
          <StatCard
            label="Nombre de collectes"
            value={fmtInt(kpi.nb_collectes)}
            dotColor={KPI_DOT.navy}
            variationPct={variationPct(
              kpi.nb_collectes,
              kpiPrev?.nb_collectes ?? 0,
            )}
            sparkPoints={sparkFromSeries(zdSeries, (p) => p.nb_collectes)}
          />
          <StatCard
            label="Tonnage collecté"
            value={fmtMasse(kpi.tonnage_kg ?? 0).value}
            unit={fmtMasse(kpi.tonnage_kg ?? 0).unit}
            dotColor={KPI_DOT.navy2}
            variationPct={variationPct(
              kpi.tonnage_kg ?? 0,
              kpiPrev?.tonnage_kg ?? 0,
            )}
            sparkPoints={sparkFromSeries(zdSeries, (p) => p.tonnage_total)}
          />
          <StatCard
            label="Taux de recyclage"
            value={
              kpi.taux_recyclage_pondere != null
                ? fmtDec(kpi.taux_recyclage_pondere, 1)
                : '—'
            }
            unit={kpi.taux_recyclage_pondere != null ? '%' : undefined}
            dotColor={KPI_DOT.green}
            variationPct={variationPct(
              kpi.taux_recyclage_pondere ?? 0,
              kpiPrev?.taux_recyclage_pondere ?? 0,
            )}
            sparkPoints={sparkFromSeries(zdSeries, (p) => p.taux_recyclage)}
            sparkColor={KPI_DOT.green}
          />
          {/* kg/pax : sparkline seule, pas de variation (sens « plus bas =
              mieux », §06.05 l.136). */}
          <StatCard
            label="kg/pax moyen"
            value={kpi.kg_par_pax != null ? fmtDec(kpi.kg_par_pax, 2) : '—'}
            unit={kpi.kg_par_pax != null ? 'kg/pax' : undefined}
            dotColor={KPI_DOT.navy3}
            sparkPoints={sparkFromSeries(zdSeries, (p) =>
              p.pax ? p.tonnage_total / p.pax : 0,
            )}
          />
        </div>
      ) : (
        <div
          className="grid grid-cols-2 gap-4 lg:grid-cols-4"
          data-testid="fiche-traiteur-kpis"
        >
          <StatCard
            label="Nombre de collectes"
            value={fmtInt(kpi.nb_collectes)}
            dotColor={KPI_DOT.navy}
            variationPct={variationPct(
              kpi.nb_collectes,
              kpiPrev?.nb_collectes ?? 0,
            )}
            sparkPoints={sparkFromSeries(agSeries, (p) => p.nb_collectes)}
          />
          <StatCard
            label="Repas donnés"
            value={fmtInt(kpi.nb_repas_donnes ?? 0)}
            dotColor={KPI_DOT.accent}
            variationPct={variationPct(
              kpi.nb_repas_donnes ?? 0,
              kpiPrev?.nb_repas_donnes ?? 0,
            )}
            sparkPoints={sparkFromSeries(agSeries, (p) => p.repas_donnes)}
            sparkColor={KPI_DOT.accent}
          />
          <StatCard
            label="Pax cumulés"
            value={fmtInt(kpi.pax_total ?? 0)}
            dotColor={KPI_DOT.navy2}
            variationPct={variationPct(
              kpi.pax_total ?? 0,
              kpiPrev?.pax_total ?? 0,
            )}
            sparkPoints={sparkFromSeries(agSeries, (p) => p.pax)}
          />
          <StatCard
            label="Repas/pax moyen"
            value={
              kpi.repas_par_pax != null ? fmtDec(kpi.repas_par_pax, 2) : '—'
            }
            dotColor={KPI_DOT.navy3}
            sparkPoints={sparkFromSeries(agSeries, (p) => p.ratio)}
          />
        </div>
      )}
      {zd ? (
        <EvolutionZdChart series={zdSeries} granularite={granularite} />
      ) : (
        <EvolutionAgChart series={agSeries} granularite={granularite} />
      )}
    </div>
  );
}
