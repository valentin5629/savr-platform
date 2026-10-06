import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { Section } from './common-6b';
import { ToggleTypeCollecte } from '@/components/collecte/toggle-type-collecte';
import { FilterBar } from '@/components/ui/filter-bar';
import { FilterChips } from '@/components/ui/filter-chips';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FiltreRecherche } from '@/components/ui/filtre-en-ligne';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { Combobox } from '@/components/ui/combobox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { raccourcisPeriode } from '@/lib/periodes-raccourcis';

// R-UI-4b « après » : mêmes sections que `entry-r-ui-4b-avant.tsx`, rendues
// avec les primitives DS (ToggleTypeCollecte, FilterChips dans FilterBar, Tabs,
// FilterBar surface page, FiltreRecherche ✕, raccourcis + Combobox titre, Table).
const noop = () => undefined;

function App() {
  return (
    <div className="bg-savr-neutral-50">
      <Section
        id="segment-type"
        title="Segment ZD/AG — ToggleTypeCollecte unique (D1)"
      >
        <div className="flex flex-wrap items-center gap-6">
          <ToggleTypeCollecte value="zero_dechet" onChange={noop} />
          <ToggleTypeCollecte avecTous value="zero_dechet" onChange={noop} />
        </div>
      </Section>
      <Section
        id="alertes-chips"
        title="Alertes — FilterChips dans FilterBar (D3)"
      >
        <FilterBar count="3 alertes" actif={false} onReset={noop}>
          <FilterChips
            ariaLabel="Filtrer par statut"
            chips={[
              { key: 'ouverte', label: 'Ouvertes' },
              { key: 'resolue', label: 'Résolues' },
              { key: 'all', label: 'Toutes' },
            ]}
            activeKey="ouverte"
            onSelect={noop}
          />
        </FilterBar>
      </Section>
      <Section id="onglets" title="Onglets mon-organisation — Tabs DS (D4)">
        <Tabs value="infos">
          <TabsList>
            <TabsTrigger value="infos">Informations</TabsTrigger>
            <TabsTrigger value="equipe">Équipe</TabsTrigger>
            <TabsTrigger value="facturation">Facturation</TabsTrigger>
            <TabsTrigger value="preferences">Préférences</TabsTrigger>
          </TabsList>
        </Tabs>
      </Section>
      <Section
        id="barre-dashboard"
        title="Barre de dashboard — FilterBar surface page, reset si ≠ défaut (D5/D8)"
      >
        <FilterBar surface="page" count={null} actif onReset={noop}>
          <DateRangePicker
            titre="Période"
            value={{ from: '2025-10-01', to: '2026-10-02' }}
            onChange={noop}
          />
        </FilterBar>
      </Section>
      <Section id="recherche" title="Recherche — debounce + effacer (D7)">
        <FilterBar
          count="2 transporteurs correspondent à votre sélection"
          actif
          onReset={noop}
        >
          <FiltreRecherche value="strike" onValueChange={noop} />
        </FilterBar>
      </Section>
      <Section
        id="export-presets"
        title="Export synthèse — raccourcis standard + Combobox titre (D8/D9)"
      >
        <div className="space-y-4 rounded-savr-xl border border-savr-neutral-200 bg-savr-white p-4">
          <FilterChips
            ariaLabel="Raccourcis de période"
            chips={[
              ...raccourcisPeriode().map((r) => ({
                key: r.id,
                label: r.libelle,
              })),
              { key: 'perso', label: 'Personnalisée' },
            ]}
            activeKey="perso"
            onSelect={noop}
          />
          <Combobox
            multiple
            titre="Lieux"
            icon={null}
            placeholder="Tous"
            options={[
              { value: '1', label: 'Pavillon Gabriel' },
              { value: '2', label: 'Palais Brongniart' },
            ]}
            value={['1']}
            onChange={noop}
          />
        </div>
      </Section>
      <Section id="table" title="Primitive Table (E1)">
        <div className="rounded-savr-xl border border-savr-neutral-200 bg-savr-white p-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Flux</TableHead>
                <TableHead>Poids (kg)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Biodéchets</TableCell>
                <TableCell>124</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Verre</TableCell>
                <TableCell>38</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </Section>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
