import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { Section } from './common-6b';
import { FilterBar } from '@/components/ui/filter-bar';
import { FiltreCoches, FiltreRecherche } from '@/components/ui/filtre-en-ligne';
import { ListFooter } from '@/components/ui/list-footer';
import { DataGrid, type ColumnDef } from '@/components/ui/data-grid';
import { EmptyState } from '@/components/ui/empty-state';
import { Truck } from 'lucide-react';

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
        title="FilterBar — compteur + Réinitialiser obligatoires (D5)"
      >
        <FilterBar count="128 transporteurs" actif onReset={() => undefined}>
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
        title="DataGrid (menu Colonnes opt-in) + ListFooter (E2/E6)"
      >
        <DataGrid
          columns={columns}
          data={rows}
          getRowId={(r) => r.id}
          columnsToggle
        />
        <ListFooter total={128} page={2} onPageChange={() => undefined} />
      </Section>
      <Section
        id="liste-registre"
        title="ListFooter avec lignes par page (registre)"
      >
        <ListFooter
          total={60}
          page={1}
          onPageChange={() => undefined}
          taillePage={25}
          taillesPage={[25, 50, 100]}
          onTaillePageChange={() => undefined}
        />
      </Section>
      <Section
        id="erreur"
        title="DataGrid — état Error (E4) et vide par défaut"
      >
        <div className="space-y-6">
          <DataGrid
            columns={columns}
            data={[]}
            getRowId={(r) => r.id}
            erreur="Le chargement de la liste a échoué."
            onRecharger={() => undefined}
          />
          <DataGrid columns={columns} data={[]} getRowId={(r) => r.id} />
          <DataGrid
            columns={columns}
            data={[]}
            getRowId={(r) => r.id}
            empty={
              <EmptyState
                icon={<Truck className="h-8 w-8" />}
                title="Aucun transporteur"
                description="Créez le premier transporteur."
              />
            }
          />
        </div>
      </Section>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
