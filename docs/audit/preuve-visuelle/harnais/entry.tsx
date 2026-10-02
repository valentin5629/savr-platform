import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { KpiCockpitCard } from '@/components/dashboards/charts/cockpit/KpiCockpitCard';
import { PackAgRing } from '@/components/dashboards/charts/cockpit/PackAgRing';
import { TopRankList } from '@/components/dashboards/charts/cockpit/TopRankList';
import { EvolutionZdChart } from '@/components/dashboards/charts/cockpit/EvolutionZdChart';
import { EvolutionAgChart } from '@/components/dashboards/charts/cockpit/EvolutionAgChart';
import { TonnagesDonut } from '@/components/dashboards/charts/cockpit/TonnagesDonut';
import { BenchmarkRadar } from '@/components/dashboards/charts/cockpit/BenchmarkRadar';
import { Co2HeroCard } from '@/components/dashboards/charts/cockpit/Co2HeroCard';
import { Co2HeroCardAg } from '@/components/dashboards/charts/cockpit/Co2HeroCardAg';
import CguPage from '@/app/cgu/page';
import ParametresPage from '@/app/(admin)/admin/parametres/page';
import { SavrLogoMark } from '@/components/layout/savr-logo';
import { AdresseAutocompleteInput } from '@/components/programmation/adresse-autocomplete-input';

const zd = [
  '2025-01-01',
  '2025-02-01',
  '2025-03-01',
  '2025-04-01',
  '2025-05-01',
  '2025-06-01',
].map((periode, i) => ({
  periode,
  biodechet: 4700 + i * 300,
  emballage: 1680 - i * 90,
  carton: 1300 + i * 40,
  verre: 850 + (i % 2) * 200,
  dechet_residuel: 640 - i * 30,
  tonnage_total: 9170 + i * 400,
  taux_recyclage: 78 + i,
  nb_collectes: 10 + i,
  pax: 4000 + i * 100,
}));
const ag = [
  '2025-01-01',
  '2025-02-01',
  '2025-03-01',
  '2025-04-01',
  '2025-05-01',
  '2025-06-01',
].map((periode, i) => ({
  periode,
  repas_donnes: 3720 + i * 120,
  pax: 4300 - i * 50,
  ratio: 0.86 + i * 0.01,
}));
const KPI_DOT = {
  navy: '#223870',
  navy2: '#3F5599',
  green: '#16A34A',
  navy3: '#6379B6',
  accent: '#FF9B00',
};

function Section({
  id,
  title,
  children,
  dark,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
  dark?: boolean;
}) {
  return (
    <section
      id={id}
      className={`p-6 ${dark ? '' : 'bg-savr-neutral-50'}`}
      style={{ width: 1180 }}
    >
      <div className="mb-3 text-xs font-bold uppercase tracking-wide text-savr-neutral-500">
        {title}
      </div>
      {children}
    </section>
  );
}

function App() {
  return (
    <div className="bg-savr-neutral-50">
      <Section id="kpi" title="KpiCockpitCard (DOT ×5) + PackAgRing">
        <div className="grid grid-cols-5 gap-4">
          <KpiCockpitCard
            label="Collectes"
            value="128"
            dotColor={KPI_DOT.navy}
            variationPct={12}
            sparkPoints={[3, 5, 4, 7, 6, 9]}
          />
          <KpiCockpitCard
            label="Tonnage"
            value="19,6"
            unit="t"
            dotColor={KPI_DOT.navy2}
            variationPct={-4}
            sparkPoints={[9, 7, 8, 6, 5, 4]}
          />
          <KpiCockpitCard
            label="Taux de recyclage"
            value="81"
            unit="%"
            dotColor={KPI_DOT.green}
            sparkColor={KPI_DOT.green}
            sparkPoints={[1, 2, 2, 3, 4, 5]}
          />
          <KpiCockpitCard
            label="kg / pax"
            value="2,1"
            dotColor={KPI_DOT.navy3}
            variationPct={0}
          />
          <KpiCockpitCard
            label="Repas donnés"
            value="3 720"
            dotColor={KPI_DOT.accent}
            sparkColor={KPI_DOT.accent}
            sparkPoints={[2, 4, 3, 6, 5, 8]}
          />
        </div>
        <div className="mt-4 grid grid-cols-3 gap-4">
          <div className="rounded-savr-lg border border-savr-neutral-200 bg-savr-white p-4">
            <PackAgRing creditsInitiaux={20} creditsRestants={14} />
          </div>
          <div className="rounded-savr-lg border border-savr-neutral-200 bg-savr-white p-4">
            <PackAgRing creditsInitiaux={20} creditsRestants={1} />
          </div>
          <div className="rounded-savr-lg border border-savr-neutral-200 bg-savr-white p-4">
            <PackAgRing creditsInitiaux={20} creditsRestants={0} />
          </div>
        </div>
      </Section>
      <Section
        id="evolution"
        title="EvolutionZdChart / EvolutionAgChart (flux.ts, palette.ts)"
      >
        <div className="grid grid-cols-2 gap-4">
          <EvolutionZdChart series={zd} granularite="mois" />
          <EvolutionAgChart series={ag} granularite="mois" />
        </div>
      </Section>
      <Section
        id="donut-rank"
        title="TonnagesDonut + TopRankList (navy / orange) + BenchmarkRadar"
      >
        <div className="grid grid-cols-3 gap-4">
          <TonnagesDonut series={zd} />
          <TopRankList
            title="Top lieux"
            subtitle="Tonnage"
            avatarTint="navy"
            showBar
            items={[
              {
                label: 'Palais Brongniart',
                value: '4,2 t',
                secondary: '12 collectes',
                barPct: 100,
              },
              {
                label: 'Pavillon Gabriel',
                value: '3,1 t',
                secondary: '9 collectes',
                barPct: 74,
              },
              { label: 'Salons Hoche', value: '2,4 t', barPct: 57 },
              { label: 'Carreau du Temple', value: '1,2 t', barPct: 29 },
              { label: 'Autres', value: '0,8 t', barPct: 19 },
            ]}
          />
          <TopRankList
            title="Top associations"
            avatarTint="orange"
            avatarShape="round"
            items={[
              { label: 'Restos du Cœur', value: '1 240 repas' },
              { label: 'Secours populaire', value: '980 repas' },
              { label: 'Linkee', value: '640 repas' },
            ]}
          />
        </div>
        <div className="mt-4">
          <BenchmarkRadar
            items={[
              { label: 'Biodéchets', value: 0.72, benchmark: 0.8 },
              { label: 'Emballages', value: 0.31, benchmark: 0.28 },
              { label: 'Carton', value: 0.24, benchmark: 0.17 },
              { label: 'Verre', value: 0.15, benchmark: 0.14 },
              { label: 'Résiduel', value: null, benchmark: null },
            ]}
          />
        </div>
      </Section>
      <Section id="co2" title="Co2HeroCard (net ≥ 0 / net < 0) + Co2HeroCardAg">
        <div className="grid grid-cols-3 gap-4">
          <Co2HeroCard
            eviteKg={12400}
            induitKg={3100}
            netKg={9300}
            energiePrimaireKwh={5400}
            equivalences={{ kmVoiture: 48000, repasBoeuf: 1200, foyers: 3 }}
          />
          <Co2HeroCard
            eviteKg={1200}
            induitKg={3100}
            netKg={-1900}
            energiePrimaireKwh={400}
            equivalences={{ kmVoiture: 4800, repasBoeuf: 120, foyers: 1 }}
          />
          <Co2HeroCardAg
            eviteKg={9300}
            equivalences={{ kmVoiture: 36000, repasBoeuf: 900 }}
          />
        </div>
      </Section>
      <Section
        id="encarts"
        title="Encarts d'alerte — recettes réelles de admin/parametres/algo-ag, factures/[id], ajouter-collecte (classes avant = palette Tailwind 4 oklch, après = tokens hex DS)"
      >
        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-3">
            <div className="text-xs font-bold text-savr-neutral-500">
              AVANT (main)
            </div>
            <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              Erreur : le paramètre n'a pas pu être enregistré.
            </div>
            <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
              Paramètres enregistrés.
            </div>
            <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
              <strong>Erreur Pennylane :</strong> délai dépassé
            </div>
            <div className="rounded-savr-md border border-savr-warning bg-amber-50 px-4 py-3">
              <p className="flex items-start gap-2 text-sm text-amber-800">
                Aucun pack actif : la collecte sera facturée au tarif unitaire.
              </p>
            </div>
            <div className="flex items-center gap-2 text-sm text-neutral-500">
              Chargement…{' '}
              <span className="text-neutral-700">texte neutral-700</span>{' '}
              <span className="text-red-600">Supprimer</span>
            </div>
          </div>
          <div className="space-y-3">
            <div className="text-xs font-bold text-savr-neutral-500">
              APRÈS (R-UI-6a)
            </div>
            <div className="flex items-center gap-2 rounded-savr-md border border-savr-error-soft bg-savr-error-subtle px-3 py-2 text-sm text-savr-error-strong">
              Erreur : le paramètre n'a pas pu être enregistré.
            </div>
            <div className="flex items-center gap-2 rounded-savr-md border border-savr-success-soft bg-savr-success-subtle px-3 py-2 text-sm text-savr-success-strong">
              Paramètres enregistrés.
            </div>
            <div className="rounded-savr-md bg-savr-warning-subtle border border-amber-200 px-4 py-3 text-sm text-savr-warning-deep">
              <strong>Erreur Pennylane :</strong> délai dépassé
            </div>
            <div className="rounded-savr-md border border-savr-warning bg-savr-warning-subtle px-4 py-3">
              <p className="flex items-start gap-2 text-sm text-savr-warning-deep">
                Aucun pack actif : la collecte sera facturée au tarif unitaire.
              </p>
            </div>
            <div className="flex items-center gap-2 text-sm text-savr-neutral-500">
              Chargement…{' '}
              <span className="text-savr-neutral-700">texte neutral-700</span>{' '}
              <span className="text-savr-error">Supprimer</span>
            </div>
          </div>
        </div>
      </Section>
      <Section
        id="divers"
        title="SavrLogoMark (base par défaut) + AdresseAutocompleteInput (shadow-lg)"
      >
        <div className="flex items-start gap-8">
          <div className="rounded-savr-md bg-savr-primary-700 p-4">
            <SavrLogoMark className="h-10 w-10" />
          </div>
          <div className="w-96">
            <AdresseAutocompleteInput value="12 rue de" onChange={() => {}} />
          </div>
        </div>
      </Section>
      <Section
        id="page-parametres"
        title="Page admin/parametres (hover:shadow-sm, rounded-lg)"
      >
        <ParametresPage />
      </Section>
      <Section id="page-cgu" title="Page /cgu (shadow-sm)">
        <CguPage />
      </Section>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
