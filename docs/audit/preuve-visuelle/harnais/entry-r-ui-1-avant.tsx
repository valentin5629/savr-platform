import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { Section } from './common-6b';
import { AlertBar } from '@/components/ui/alert-bar';
import { EmptyDashboardState } from '@/components/dashboards/EmptyDashboardState';

// R-UI-1 « avant » (main dba29bfa) : recettes maison recopiées telles
// qu'elles étaient dans les pages (succès inline, bandeau orange Pennylane,
// erreur texte rouge, « Chargement… » sans couleur, « Aucun… » inline,
// EmptyDashboardState texte seul, erreur liste AlertBar + bouton recopiés).
function App() {
  return (
    <div className="bg-savr-neutral-50">
      <Section id="succes" title="Succès après action — inline (H1)">
        <div className="space-y-3 rounded-savr-xl border border-savr-neutral-200 bg-savr-white p-4">
          <AlertBar variant="success">Invitation envoyée.</AlertBar>
          <p className="text-sm text-savr-success">
            Configuration enregistrée.
          </p>
        </div>
      </Section>
      <Section id="bandeaux" title="Bandeaux d'alerte maison (H2)">
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-savr-md border border-orange-300 bg-orange-50 px-4 py-3 text-sm text-orange-800">
            <span>En attente Pennylane depuis plus de 2 h.</span>
            <button className="font-semibold text-orange-700">Renvoyer</button>
          </div>
          <p className="text-sm text-savr-error">
            La mise à jour du mix a échoué.
          </p>
        </div>
      </Section>
      <Section id="chargement" title="Chargement (H3)">
        <div className="space-y-3 rounded-savr-xl border border-savr-neutral-200 bg-savr-white p-4">
          <p className="p-4 text-sm">Chargement…</p>
          <div className="space-y-2">
            <div className="h-20 animate-pulse rounded-lg bg-savr-neutral-100" />
            <div className="h-20 animate-pulse rounded-lg bg-savr-neutral-100" />
          </div>
        </div>
      </Section>
      <Section id="vide" title="Vide (H4)">
        <div className="space-y-3 rounded-savr-xl border border-savr-neutral-200 bg-savr-white p-4">
          <p className="text-sm text-savr-neutral-500">Aucun membre.</p>
          <EmptyDashboardState />
        </div>
      </Section>
      <Section id="erreur" title="Erreur de chargement (H5)">
        <div className="space-y-4 rounded-savr-xl border border-savr-neutral-200 bg-savr-white p-4">
          <AlertBar variant="err">
            Le chargement des collectes a échoué.
          </AlertBar>
          <button className="rounded-savr-md border border-savr-neutral-300 px-4 py-2 text-sm font-semibold">
            Réessayer
          </button>
        </div>
      </Section>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
