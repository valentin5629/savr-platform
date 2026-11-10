'use client';

import { LoadingState } from '@/components/ui/loading-state';
import { useCallback, useEffect, useState } from 'react';
import {
  DashboardFilterBar,
  TonnageDisplay,
  EmptyDashboardState,
  type CollecteType,
  type DashboardFilters,
} from '@/components/dashboards/index.js';
import { ajouterFiltresGlobaux } from '@/components/dashboards/filtres-query';
import { useOptionsBarre } from '@/components/dashboards/useOptionsBarre';
import { ToggleTypeCollecte } from '@/components/collecte/toggle-type-collecte';
// Librairie data-viz « Cockpit » (R24) — importée en direct (hors barrel).
import { StatCard } from '@/components/ui/stat-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { jourParis } from '@savr/shared/src/temps/index.js';
import { KPI_DOT } from '@/components/dashboards/charts/cockpit/palette';
import { PageHero } from '@/components/ui/page-hero';
import { SquaresFourIcon } from '@/components/ui/icones';
import { fmtDec, fmtMasse, uniteCo2 } from '@/lib/format';
import { Text } from '@/components/ui/text';
import { LIEN_METHODE_CO2, MENTION_CO2_EVITE } from '@/lib/co2-mention';
import { TextLink } from '@/components/ui/text-link';
import { ROUTES } from '@/lib/routes';

// §11 §7 — Dashboard client_organisateur : impact RSE, lecture seule.
// Pas de données financières, pas de benchmark (le rôle n'a aucun intérêt à se comparer).
interface KpiRow {
  mois: string;
  type_collecte: CollecteType;
  nb_collectes: number;
  nb_evenements: number;
  tonnage_kg: number | null;
  taux_recyclage_pondere: number | null;
  nb_repas_donnes: number | null;
  co2_induit_kg: number | null;
  co2_evite_kg: number | null;
  co2_net_kg: number | null;
  energie_primaire_evitee_kwh: number | null;
}

const sum = (rows: KpiRow[], f: (r: KpiRow) => number | null | undefined) =>
  rows.reduce((s, r) => s + (f(r) ?? 0), 0);

// Bascule kg → t à `SEUIL_TONNES_KG` (10 000 kg, CDC §11 ; Q5 tranché 2026-10-06).
function Co2Display({ kg }: { kg: number }) {
  const m = fmtMasse(kg);
  return (
    <>
      {m.value}
      {'\u00a0'}
      {uniteCo2(m.unit)}
    </>
  );
}

/**
 * Dashboard client_organisateur (§11 §7) — « Mon impact RSE », lecture seule,
 * ultra-simple, orienté reporting ESG : bandeau YTD + cadrans par onglet + détail
 * bilan carbone ABC repliable. Décliné en Cockpit (R24c) = cartes `StatCard`
 * (le chrome data-viz partagé), en conservant à l'identique les données et la
 * structure §11 §7 (pas de benchmark ni de Top listes : ce rôle n'en a pas).
 */
export default function ClientOrganisateurDashboardPage() {
  const [tab, setTab] = useState<CollecteType>('zero_dechet');
  const [filters, setFilters] = useState<DashboardFilters | null>(null);
  const [rows, setRows] = useState<KpiRow[]>([]);
  const [ytd, setYtd] = useState<KpiRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState(false);

  // Options de la barre : Lieux, Traiteurs, Type et Taille d'événement (décision
  // Val du 2026-10-30, au-delà du « filtre période » du §11 §7).
  const parcOptions = useOptionsBarre('/api/v1/dashboards/filtres');

  const handleFilters = useCallback((f: DashboardFilters) => setFilters(f), []);

  // Cadrans de l'onglet — suivent les filtres de la barre (période par défaut :
  // 12 derniers mois, §11 §8). Le bandeau YTD, lui, reste l'année entière.
  useEffect(() => {
    if (!filters) return;
    setLoading(true);
    setErreur(false);
    const qs = new URLSearchParams({
      from: filters.from,
      to: filters.to,
      type: tab,
    });
    ajouterFiltresGlobaux(qs, filters);
    fetch(`/api/v1/dashboards/kpi-client-organisateur?${qs}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j) => setRows((j.data ?? []) as KpiRow[]))
      // Chargement raté : pas de compteur, plutôt qu'un chiffre faux.
      .catch(() => setErreur(true))
      .finally(() => setLoading(false));
  }, [filters, tab]);

  // Bandeau de tête — synthèse RSE annuelle YTD (tous types confondus)
  useEffect(() => {
    const year = new Date().getFullYear();
    const to = jourParis();
    const qs = new URLSearchParams({ from: `${year}-01-01`, to });
    fetch(`/api/v1/dashboards/kpi-client-organisateur?${qs}`)
      .then((r) => r.json())
      .then((j) => setYtd((j.data ?? []) as KpiRow[]));
  }, []);

  // Bandeau YTD
  const ytdEvenements = sum(ytd, (r) => r.nb_evenements);
  const ytdCo2Evite = sum(ytd, (r) => r.co2_evite_kg);
  const ytdKgZd = sum(
    ytd.filter((r) => r.type_collecte === 'zero_dechet'),
    (r) => r.tonnage_kg,
  );
  const ytdRepasAg = sum(
    ytd.filter((r) => r.type_collecte === 'anti_gaspi'),
    (r) => r.nb_repas_donnes,
  );

  // Onglet courant
  const nbCollectes = sum(rows, (r) => r.nb_collectes);
  const nbEvenements = sum(rows, (r) => r.nb_evenements);
  const tonnage = sum(rows, (r) => r.tonnage_kg);
  const repas = sum(rows, (r) => r.nb_repas_donnes);
  const co2Evite = sum(rows, (r) => r.co2_evite_kg);
  const tauxNum = sum(
    rows,
    (r) => (r.taux_recyclage_pondere ?? 0) * (r.tonnage_kg ?? 0),
  );
  const tauxDen = sum(rows, (r) =>
    r.taux_recyclage_pondere != null ? (r.tonnage_kg ?? 0) : 0,
  );
  const taux = tauxDen > 0 ? tauxNum / tauxDen : null;

  return (
    <div className="space-y-6" data-testid="organisateur-dashboard">
      <PageHero
        icon={<SquaresFourIcon className="h-6 w-6" />}
        title="Mon impact RSE"
      />

      {/* Bandeau de tête — synthèse RSE annuelle (YTD), commun aux 2 onglets */}
      <Card data-testid="organisateur-bandeau-ytd">
        <CardHeader>
          <CardTitle>
            Synthèse {new Date().getFullYear()} de votre impact RSE
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label="Événements collectés"
              value={ytdEvenements}
              dotColor={KPI_DOT.navy}
            />
            <StatCard
              label="CO₂e évité estimé"
              value={<Co2Display kg={ytdCo2Evite} />}
              dotColor={KPI_DOT.green}
            />
            <StatCard
              label="Déchets collectés (ZD)"
              value={<TonnageDisplay kg={ytdKgZd} />}
              dotColor={KPI_DOT.navy2}
            />
            <StatCard
              label="Repas donnés (AG)"
              value={ytdRepasAg}
              dotColor={KPI_DOT.accent}
            />
          </div>
          <Text variant="hint" tone="faint">
            {MENTION_CO2_EVITE}{' '}
            <TextLink
              external
              href={ROUTES.methodeCo2}
              target="_blank"
              rel="noopener noreferrer"
            >
              {LIEN_METHODE_CO2}
            </TextLink>
          </Text>
          <Button variant="ghost" asChild>
            <a href={ROUTES.organisateur.documents}>
              Voir mes rapports d’impact PDF
            </a>
          </Button>
        </CardContent>
      </Card>

      <DashboardFilterBar
        storageKey="organisateur-dashboard"
        onChange={handleFilters}
        parcOptions={parcOptions}
        toggle={<ToggleTypeCollecte value={tab} onChange={setTab} />}
        count={
          !loading && !erreur ? (
            <span data-testid="dashboard-collectes-count">
              {nbCollectes} collecte{nbCollectes > 1 ? 's' : ''} correspond
              {nbCollectes > 1 ? 'ent' : ''} à votre sélection
            </span>
          ) : undefined
        }
      />

      {loading ? (
        <LoadingState />
      ) : nbCollectes === 0 ? (
        <EmptyDashboardState />
      ) : tab === 'zero_dechet' ? (
        <div
          className="grid grid-cols-2 gap-4 lg:grid-cols-4"
          data-testid="organisateur-kpi-zd"
        >
          {/* Les cadrans mesurent l'impact réalisé : le lien ouvre les
                collectes passées (décision Val 2026-10-19). */}
          <StatCard
            label="Événements ZD"
            value={nbEvenements}
            dotColor={KPI_DOT.navy}
            href={`${ROUTES.organisateur.collectes}?onglet=passees&type=zero_dechet`}
          />
          <StatCard
            label="Déchets collectés"
            value={<TonnageDisplay kg={tonnage} />}
            dotColor={KPI_DOT.navy2}
          />
          <StatCard
            label="Taux de recyclage"
            value={taux != null ? fmtTaux(taux) : '—'}
            unit={taux != null ? '%' : undefined}
            dotColor={KPI_DOT.green}
          />
          {/* CO₂ évité en headline (§11 §7, refonte 2026-06-04 Sujet 3) */}
          <StatCard
            label="CO₂e évité estimé"
            value={<Co2Display kg={co2Evite} />}
            dotColor={KPI_DOT.green}
          />
        </div>
      ) : (
        <div
          className="grid grid-cols-2 gap-4 lg:grid-cols-4"
          data-testid="organisateur-kpi-ag"
        >
          <StatCard
            label="Événements AG"
            value={nbEvenements}
            dotColor={KPI_DOT.navy}
            href={`${ROUTES.organisateur.collectes}?onglet=passees&type=anti_gaspi`}
          />
          <StatCard
            label="Repas donnés"
            value={repas}
            dotColor={KPI_DOT.accent}
          />
          <StatCard
            label="CO₂e évité estimé"
            value={<Co2Display kg={co2Evite} />}
            dotColor={KPI_DOT.green}
          />
        </div>
      )}
    </div>
  );
}

/** Taux en fr : « 78,4 » (unité % rendue à part par la carte). */
function fmtTaux(t: number): string {
  return fmtDec(t, 1);
}
