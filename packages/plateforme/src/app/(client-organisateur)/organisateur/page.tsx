'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  CollecteTypeTabs,
  DashboardFilterBar,
  KpiCard,
  TonnageDisplay,
  EmptyDashboardState,
  type CollecteType,
  type DashboardFilters,
} from '@/components/dashboards/index.js';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

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

function Co2Display({ kg }: { kg: number }) {
  if (kg >= 1000)
    return (
      <>
        {(kg / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} t
        CO₂e
      </>
    );
  return (
    <>{kg.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} kg CO₂e</>
  );
}

export default function ClientOrganisateurDashboardPage() {
  const [tab, setTab] = useState<CollecteType>('zero_dechet');
  const [filters, setFilters] = useState<DashboardFilters | null>(null);
  const [rows, setRows] = useState<KpiRow[]>([]);
  const [ytd, setYtd] = useState<KpiRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAbc, setShowAbc] = useState(false);

  const handleFilters = useCallback((f: DashboardFilters) => setFilters(f), []);

  // Cadrans de l'onglet — suivent la période du filtre (défaut 12 derniers mois, §11 §8)
  useEffect(() => {
    if (!filters) return;
    setLoading(true);
    const qs = new URLSearchParams({
      from: filters.from,
      to: filters.to,
      type: tab,
    });
    fetch(`/api/v1/dashboards/kpi-client-organisateur?${qs}`)
      .then((r) => r.json())
      .then((j) => setRows((j.data ?? []) as KpiRow[]))
      .finally(() => setLoading(false));
  }, [filters, tab]);

  // Bandeau de tête — synthèse RSE annuelle YTD (tous types confondus)
  useEffect(() => {
    const year = new Date().getFullYear();
    const to = new Date().toISOString().slice(0, 10);
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
  const co2Induit = sum(rows, (r) => r.co2_induit_kg);
  const co2Net = sum(rows, (r) => r.co2_net_kg);
  const energie = sum(rows, (r) => r.energie_primaire_evitee_kwh);
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
      <h1 className="text-2xl font-bold text-savr-primary-800">
        Mon impact RSE
      </h1>

      {/* Bandeau de tête — synthèse RSE annuelle (YTD), commun aux 2 onglets */}
      <Card data-testid="organisateur-bandeau-ytd">
        <CardHeader>
          <CardTitle>
            Synthèse {new Date().getFullYear()} — à communiquer dans votre
            rapport RSE / bilan carbone
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard label="Événements collectés" value={ytdEvenements} />
            <KpiCard
              label="CO₂e évité (total)"
              value={<Co2Display kg={ytdCo2Evite} />}
            />
            <KpiCard
              label="Déchets détournés (ZD)"
              value={<TonnageDisplay kg={ytdKgZd} />}
            />
            <KpiCard label="Repas détournés (AG)" value={ytdRepasAg} />
          </div>
          <Button variant="ghost" asChild>
            <a href="/organisateur/documents">Voir mes rapports d’impact PDF</a>
          </Button>
        </CardContent>
      </Card>

      <DashboardFilterBar
        storageKey="organisateur-dashboard"
        onChange={handleFilters}
      />
      <CollecteTypeTabs value={tab} onChange={setTab} />

      {loading ? (
        <p className="text-sm text-savr-neutral-500">Chargement…</p>
      ) : nbCollectes === 0 ? (
        <EmptyDashboardState />
      ) : tab === 'zero_dechet' ? (
        <>
          <div
            className="grid grid-cols-2 gap-4 lg:grid-cols-4"
            data-testid="organisateur-kpi-zd"
          >
            <KpiCard
              label="Événements ZD"
              value={nbEvenements}
              href="/organisateur/collectes?type=zero_dechet"
            />
            <KpiCard
              label="Déchets détournés"
              value={<TonnageDisplay kg={tonnage} />}
            />
            <KpiCard
              label="Taux de recyclage"
              value={taux != null ? `${taux.toFixed(1)} %` : '—'}
            />
            {/* CO₂ évité en headline (§11 §7, refonte 2026-06-04 Sujet 3) */}
            <KpiCard label="CO₂ évité" value={<Co2Display kg={co2Evite} />} />
          </div>

          {/* Règle ABC — induit + net + énergie primaire en détail repliable */}
          <Card>
            <CardHeader>
              <button
                type="button"
                onClick={() => setShowAbc((v) => !v)}
                aria-expanded={showAbc}
                className="flex w-full items-center justify-between text-left"
              >
                <CardTitle>Détail du bilan carbone (règle ABC)</CardTitle>
                <span aria-hidden>{showAbc ? '▲' : '▼'}</span>
              </button>
            </CardHeader>
            {showAbc && (
              <CardContent
                className="grid grid-cols-1 gap-4 md:grid-cols-3"
                data-testid="organisateur-co2-abc"
              >
                <KpiCard
                  label="CO₂ induit (A)"
                  value={<Co2Display kg={co2Induit} />}
                />
                <KpiCard label="CO₂ net" value={<Co2Display kg={co2Net} />} />
                <KpiCard
                  label="Énergie primaire évitée"
                  value={`${energie.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} kWh`}
                />
              </CardContent>
            )}
          </Card>
        </>
      ) : (
        <div
          className="grid grid-cols-2 gap-4 lg:grid-cols-4"
          data-testid="organisateur-kpi-ag"
        >
          <KpiCard
            label="Événements AG"
            value={nbEvenements}
            href="/organisateur/collectes?type=anti_gaspi"
          />
          <KpiCard label="Repas détournés" value={repas} />
          <KpiCard label="CO₂e évité" value={<Co2Display kg={co2Evite} />} />
        </div>
      )}
    </div>
  );
}
