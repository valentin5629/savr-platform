import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { Section } from './common-6b';
import { FilterBar } from '@/components/ui/filter-bar';
import { FiltreCoches, FiltreRecherche } from '@/components/ui/filtre-en-ligne';
import { Pagination } from '@/components/ui/pagination';
import { DataGrid, type ColumnDef } from '@/components/ui/data-grid';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { Text } from '@/components/ui/text';
import { AlertBar } from '@/components/ui/alert-bar';

type Row = { id: string; nom: string; ville: string };
const rows: Row[] = [
  { id: '1', nom: 'Strike', ville: 'Paris' },
  { id: '2', nom: 'Marathon', ville: 'Pantin' },
  { id: '3', nom: 'A Toutes!', ville: 'Montreuil' },
];
const columns: ColumnDef<Row, unknown>[] = [
  { id: 'nom', header: 'Nom', accessorFn: (r) => r.nom },
  { id: 'ville', header: 'Ville', accessorFn: (r) => r.ville },
];

function App() {
  return (
    <div className="bg-savr-neutral-50">
      <Section
        id="filter-bar"
        title="FilterBar (avant) — sans compteur ni reset"
      >
        <FilterBar>
          <FiltreRecherche value="stri" onChange={() => undefined} />
          <FiltreCoches
            label="Statut"
            options={[
              { id: 'true', nom: 'Actifs' },
              { id: 'false', nom: 'Inactifs' },
            ]}
            selected={['true']}
            onChange={() => undefined}
          />
        </FilterBar>
      </Section>
      <Section
        id="liste"
        title="DataGrid (menu Colonnes par défaut) + pied H1 recopié (avant)"
      >
        <DataGrid columns={columns} data={rows} getRowId={(r) => r.id} />
        <div className="flex items-center justify-between gap-2 pt-3 text-sm">
          <span className="text-savr-neutral-500">128 transporteurs</span>
          <Pagination page={2} pageCount={3} onPageChange={() => undefined} />
        </div>
      </Section>
      <Section
        id="liste-registre"
        title="Pagination maison du registre (avant)"
      >
        <Text as="div" className="flex items-center justify-between">
          <span>60 ligne(s)</span>
          <div className="flex items-center gap-2">
            <Combobox
              aria-label="Lignes par page"
              icon={null}
              className="w-32"
              options={[25, 50, 100].map((s) => ({
                value: String(s),
                label: `${s} / page`,
              }))}
              value="25"
              onChange={() => undefined}
            />
            <Button variant="ghost" disabled>
              Précédent
            </Button>
            <span>1 / 3</span>
            <Button variant="ghost">Suivant</Button>
          </div>
        </Text>
      </Section>
      <Section
        id="erreur"
        title="État Error recopié (registre / gestionnaire) (avant)"
      >
        <div className="space-y-4">
          <AlertBar variant="err">Le chargement du registre a échoué.</AlertBar>
          <Button variant="secondary">Réessayer</Button>
        </div>
      </Section>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
