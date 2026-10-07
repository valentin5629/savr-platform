import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { Section, zd, ag, DOT } from './common-6b';
import { StatCard as Kpi } from '@/components/ui/stat-card';
import { StatCard as NewStat } from '@/components/ui/stat-card';
import { PackAgRing } from '@/components/dashboards/charts/cockpit/PackAgRing';
import { TopRankList } from '@/components/dashboards/charts/cockpit/TopRankList';
import { EvolutionZdChart } from '@/components/dashboards/charts/cockpit/EvolutionZdChart';
import { EvolutionAgChart } from '@/components/dashboards/charts/cockpit/EvolutionAgChart';
import { TonnagesDonut } from '@/components/dashboards/charts/cockpit/TonnagesDonut';
import { BenchmarkRadar } from '@/components/dashboards/charts/cockpit/BenchmarkRadar';
import { Co2HeroCard } from '@/components/dashboards/charts/cockpit/Co2HeroCard';
import CguPage from '@/app/cgu/page';
import ParametresPage from '@/app/(admin)/admin/parametres/page';
import MethodologiePage from '@/app/(registre)/registre/methodologie/page';

function App() {
  return (
    <div className="bg-savr-neutral-50">
      <Section
        id="kpi"
        title="Cartes KPI (StatCard ex-KpiCockpitCard) + PackAgRing"
      >
        <div className="grid grid-cols-5 gap-4">
          <Kpi
            label="Collectes"
            value="128"
            dotColor={DOT.navy}
            variationPct={12}
            sparkPoints={[3, 5, 4, 7, 6, 9]}
          />
          <Kpi
            label="Tonnage"
            value="19,6"
            unit="t"
            dotColor={DOT.navy2}
            variationPct={-4}
            sparkPoints={[9, 7, 8, 6, 5, 4]}
          />
          <Kpi
            label="Taux de recyclage"
            value="81"
            unit="%"
            dotColor={DOT.green}
            sparkColor={DOT.green}
            sparkPoints={[1, 2, 2, 3, 4, 5]}
          />
          <Kpi
            label="kg / pax"
            value="2,1"
            dotColor={DOT.navy3}
            variationPct={0}
          />
          <Kpi
            label="Repas donnés"
            value="3 720"
            dotColor={DOT.accent}
            sparkColor={DOT.accent}
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
        title="EvolutionZdChart / EvolutionAgChart (ToggleChip, ChartTooltip)"
      >
        <div className="grid grid-cols-2 gap-4">
          <EvolutionZdChart series={zd} granularite="mois" />
          <EvolutionAgChart series={ag} granularite="mois" />
        </div>
      </Section>
      <Section
        id="donut-rank"
        title="TonnagesDonut + TopRankList + BenchmarkRadar"
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
      <Section id="co2" title="Co2HeroCard zd / ag (composant unique)">
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
          <Co2HeroCard
            variant="ag"
            eviteKg={9300}
            equivalences={{ kmVoiture: 36000, repasBoeuf: 900 }}
          />
        </div>
      </Section>
      <Section
        id="page-parametres"
        title="Page admin/parametres (Heading h1, Card padding)"
      >
        <ParametresPage />
      </Section>
      <Section
        id="page-methodologie"
        title="Page registre/methodologie (Heading h1/h2, Text)"
      >
        <MethodologiePage />
      </Section>
      <Section id="page-cgu" title="Page /cgu (Heading, Text)">
        <CguPage />
      </Section>
      <Section
        id="kpi-bilan"
        title="KPI du bilan de la fiche collecte client (ancienne StatCard → StatCard fusionnée) — écart assumé I6"
      >
        <div className="grid grid-cols-4 gap-4">
          <NewStat label="Poids total collecté" value="870" unit="kg" />
          <NewStat label="CO₂ évité (net)" value="-100" unit="kgCO₂e" />
          <NewStat label="Taux de recyclage" value="78,4" unit="%" />
          <NewStat label="Pesée par pax" value="207" unit="g" />
        </div>
      </Section>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
