import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { Section } from './common-6b';
import { CollecteTypeTabs } from '@/components/dashboards/CollecteTypeTabs';
import { MultiSelectFilter } from '@/components/dashboards/MultiSelectFilter';
import { BarreFiltres, FiltreRecherche } from '@/components/ui/filtre-en-ligne';
import { DateRangePicker } from '@/components/ui/date-range-picker';

// R-UI-4b « avant » (main b409fc72) : segmenté ZD/AG clone sans clavier,
// pilules aria-pressed admin collectes, chips maison alertes, onglets tabCls
// maison, bandeau dashboard sans compteur, recherche sans ✕, presets maison,
// MultiSelectFilter libellé au-dessus, <table> brut. Les classes maison sont
// recopiées des pages telles qu'elles étaient sur main.
const tabCls = (actif: boolean) =>
  `px-4 py-2 text-sm font-medium border-b-2 ${
    actif
      ? 'border-savr-primary-600 text-savr-primary-700'
      : 'border-transparent text-savr-neutral-500 hover:text-savr-neutral-700'
  }`;

function App() {
  return (
    <div className="bg-savr-neutral-50">
      <Section id="segment-type" title="Segment ZD/AG — 4 implémentations (D1)">
        <div className="flex flex-wrap items-center gap-6">
          <CollecteTypeTabs value="zero_dechet" onChange={() => undefined} />
          <div
            role="group"
            aria-label="Filtrer par type"
            className="flex gap-2"
          >
            {['Toutes', 'Zéro Déchet', 'Anti-Gaspi'].map((l, i) => (
              <button
                key={l}
                type="button"
                aria-pressed={i === 1}
                className={`rounded-savr-full border px-3.5 py-1.5 text-xs font-bold ${
                  i === 1
                    ? 'border-savr-primary-700 bg-savr-primary-700 text-savr-white'
                    : 'border-savr-neutral-300 bg-savr-white text-savr-neutral-600'
                }`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      </Section>
      <Section id="alertes-chips" title="Alertes — pastilles maison (D3)">
        <div className="flex gap-2">
          {[
            ['Ouvertes', true],
            ['Résolues', false],
            ['Toutes', false],
          ].map(([l, a]) => (
            <button
              key={String(l)}
              className={`rounded-full px-3 py-1 text-sm ${
                a
                  ? 'bg-savr-primary-600 text-white'
                  : 'bg-savr-neutral-100 text-savr-neutral-700'
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      </Section>
      <Section
        id="onglets"
        title="Onglets mon-organisation — tabCls maison (D4)"
      >
        <div className="flex gap-2 border-b border-savr-neutral-200">
          <button className={tabCls(true)}>Informations</button>
          <button className={tabCls(false)}>Équipe</button>
          <button className={tabCls(false)}>Facturation</button>
          <button className={tabCls(false)}>Préférences</button>
        </div>
      </Section>
      <Section
        id="barre-dashboard"
        title="Barre de dashboard — BarreFiltres seule, « Réinitialiser » (D5/D8)"
      >
        <BarreFiltres surface="page" onReset={() => undefined}>
          <DateRangePicker
            titre="Période"
            value={{ from: '2025-10-01', to: '2026-10-02' }}
            onChange={() => undefined}
          />
        </BarreFiltres>
      </Section>
      <Section id="recherche" title="Recherche — sans debounce ni ✕ (D7)">
        <BarreFiltres>
          <FiltreRecherche value="strike" onChange={() => undefined} />
        </BarreFiltres>
      </Section>
      <Section
        id="export-presets"
        title="Export synthèse — presets maison + MultiSelectFilter (D8/D9)"
      >
        <div className="space-y-4 rounded-savr-xl border border-savr-neutral-200 bg-savr-white p-4">
          <div className="flex flex-wrap gap-2">
            {[
              '7 jours',
              '30 jours',
              'Trimestre',
              '12 mois',
              'Année',
              'Personnalisée',
            ].map((l, i) => (
              <button
                key={l}
                type="button"
                className={`rounded-savr-md border px-3 py-1.5 text-sm ${
                  i === 5
                    ? 'border-savr-primary-700 bg-savr-primary-700 text-savr-white'
                    : 'border-savr-neutral-300 bg-savr-white text-savr-neutral-700'
                }`}
              >
                {l}
              </button>
            ))}
          </div>
          <MultiSelectFilter
            label="Lieux"
            options={[
              { id: '1', nom: 'Pavillon Gabriel' },
              { id: '2', nom: 'Palais Brongniart' },
            ]}
            selected={['1']}
            onChange={() => undefined}
          />
        </div>
      </Section>
      <Section id="table" title="Tableau brut (E1)">
        <div className="rounded-savr-xl border border-savr-neutral-200 bg-savr-white p-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-savr-neutral-200">
                <th className="py-2 text-left font-medium text-savr-neutral-500">
                  Flux
                </th>
                <th className="py-2 text-left font-medium text-savr-neutral-500">
                  Poids (kg)
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-savr-neutral-200">
                <td className="py-2">Biodéchets</td>
                <td className="py-2">124</td>
              </tr>
              <tr>
                <td className="py-2">Verre</td>
                <td className="py-2">38</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
