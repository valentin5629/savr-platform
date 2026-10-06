import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { Section } from './common-6b';
import { Badge } from '@/components/ui/badge';
import { TypeCollecteBadge } from '@/components/ui/type-collecte-badge';
import { FactureStatutBadge } from '@/components/ui/facture-statut-badge';
import { ActifBadge } from '@/components/ui/actif-badge';
import { libelleRole } from '@/lib/libelles/role';
import { libelleFlux } from '@/lib/libelles/flux';
import { libelleTypePack } from '@/lib/libelles/pack';
import { libelleStatutFacture } from '@/lib/libelles/facture';

// R-UI-2 « après » : mêmes sections, rendues depuis les sources uniques.
function App() {
  return (
    <div className="bg-savr-neutral-50">
      <Section id="libelles" title="Libellés unifiés (C3, C6, C8, C12)">
        <div className="flex flex-wrap items-center gap-3 rounded-savr-xl border border-savr-neutral-200 bg-savr-white p-4">
          <Badge variant="warning">
            {libelleStatutFacture('en_attente_pennylane')}
          </Badge>
          <ActifBadge actif={false} />
          <ActifBadge actif={false} />
          <Badge variant="neutral">{libelleRole('gestionnaire_lieux')}</Badge>
          <Badge variant="neutral">{libelleFlux('carton')}</Badge>
          <Badge variant="neutral">{libelleTypePack('pack_10')}</Badge>
          <FactureStatutBadge statut="payee" />
        </div>
      </Section>
      <Section id="type-collecte" title="Badge type de collecte (C2)">
        <div className="flex flex-wrap items-center gap-3 rounded-savr-xl border border-savr-neutral-200 bg-savr-white p-4">
          <TypeCollecteBadge type="zero_dechet" />
          <TypeCollecteBadge type="anti_gaspi" />
          <TypeCollecteBadge type="zero_dechet" forme="plein" />
          <TypeCollecteBadge type="anti_gaspi" forme="plein" />
        </div>
      </Section>
      <Section id="tailles" title="Tailles et compteur (C14, C15)">
        <div className="flex flex-wrap items-center gap-3 rounded-savr-xl border border-savr-neutral-200 bg-savr-white p-4">
          <Badge variant="neutral" size="sm">
            MTS-1
          </Badge>
          <Badge variant="error" size="sm" className="uppercase">
            Urgent
          </Badge>
          <Badge variant="count">3</Badge>
        </div>
      </Section>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
