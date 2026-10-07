import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { Section } from './common-6b';
import { Badge } from '@/components/ui/badge';
import { TypeCollecteBadge } from '@/components/collecte/type-collecte-badge';

// R-UI-2 « avant » (main 5dd434b1) : libellés et badges tels qu'ils étaient
// rendus (copies locales recopiées des pages).
function App() {
  return (
    <div className="bg-savr-neutral-50">
      <Section id="libelles" title="Libellés unifiés (C3, C6, C8, C12)">
        <div className="flex flex-wrap items-center gap-3 rounded-savr-xl border border-savr-neutral-200 bg-savr-white p-4">
          <Badge variant="warning">En attente</Badge>
          <Badge variant="neutral">Suspendu</Badge>
          <Badge variant="neutral">Désactivé</Badge>
          <Badge variant="neutral">Gestionnaire lieux</Badge>
          <Badge variant="neutral">Cartons</Badge>
          <Badge variant="neutral">pack_10</Badge>
        </div>
      </Section>
      <Section id="type-collecte" title="Badge type de collecte (C2)">
        <div className="flex flex-wrap items-center gap-3 rounded-savr-xl border border-savr-neutral-200 bg-savr-white p-4">
          <TypeCollecteBadge type="zero_dechet" />
          <TypeCollecteBadge type="anti_gaspi" />
          <Badge variant="primary" dot={false}>
            ZD
          </Badge>
          <Badge variant="action" dot={false}>
            AG
          </Badge>
        </div>
      </Section>
      <Section id="tailles" title="Tailles et compteur (C14, C15)">
        <div className="flex flex-wrap items-center gap-3 rounded-savr-xl border border-savr-neutral-200 bg-savr-white p-4">
          <Badge variant="neutral" className="text-[11px]">
            MTS-1
          </Badge>
          <Badge
            variant="error"
            className="text-[10px] font-extrabold uppercase"
          >
            Urgent
          </Badge>
          <span className="inline-flex min-w-[1.25rem] justify-center rounded-savr-full bg-savr-error px-1.5 text-[11px] font-bold leading-5 text-savr-white">
            3
          </span>
        </div>
      </Section>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
