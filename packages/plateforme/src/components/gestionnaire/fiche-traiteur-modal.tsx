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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Text } from '@/components/ui/text';
import {
  ToggleTypeCollecte,
  type CollecteType,
} from '@/components/collecte/toggle-type-collecte';
import { CartesKpiGestionnaire } from '@/components/dashboards/CartesKpiGestionnaire';
import { EvolutionAgChart } from '@/components/dashboards/charts/cockpit/EvolutionAgChart';
import { EvolutionZdChart } from '@/components/dashboards/charts/cockpit/EvolutionZdChart';
import { fmtInt } from '@/components/dashboards/charts/cockpit/fmt';
import type { DashboardFilters } from '@/components/dashboards/DashboardFilterBar';
import { useEvolutionBlocs } from '@/components/dashboards/useEvolutionBlocs';
import { useKpisGestionnaire } from '@/components/dashboards/useKpisGestionnaire';
import { estUuid } from '@/lib/filtre-csv';
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
    setLogoKo(false);
    // Identifiant mal formé (adresse saisie à la main) : aucune requête. Le
    // navigateur normaliserait « . » vers la route de la LISTE, dont la réponse
    // n'a pas la forme d'une fiche.
    if (!estUuid(traiteurId)) {
      setEtat('introuvable');
      return;
    }
    setEtat('chargement');
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
  const { kpi, kpiPrev, loading, erreur } = useKpisGestionnaire(filtres, type);
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
  return (
    <div className="space-y-4">
      <CartesKpiGestionnaire
        type={type}
        kpi={kpi}
        kpiPrev={kpiPrev}
        zdSeries={zdSeries}
        agSeries={agSeries}
        testId="fiche-traiteur-kpis"
      />
      {zd ? (
        <EvolutionZdChart series={zdSeries} granularite={granularite} />
      ) : (
        <EvolutionAgChart series={agSeries} granularite={granularite} />
      )}
    </div>
  );
}
