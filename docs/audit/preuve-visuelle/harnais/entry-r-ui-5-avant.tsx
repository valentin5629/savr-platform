import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { Section } from './common-6b';
import { Input } from '@/components/ui/input';
import { Building2 } from 'lucide-react';
import { BlocHeader, InfoItem } from '@/components/collecte/fiche-blocs';

// R-UI-5 « avant » (main 839ee1c7) : recettes maison recopiées des écrans —
// label brut `font-medium mb-1`, grille non responsive, case native,
// « (obligatoire) » dans le libellé, en-tête de section et paires libellé/valeur
// maison.
function App() {
  return (
    <div className="bg-savr-neutral-50">
      <Section id="champs" title="Champs de formulaire (F1, F2, F3, F7)">
        <div className="rounded-savr-xl border border-savr-neutral-200 bg-savr-white p-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="a1" className="mb-1 block text-sm font-medium">
                Motif (obligatoire, ≥ 10 caractères)
              </label>
              <Input id="a1" defaultValue="Retard prestataire" />
            </div>
            <div>
              <label htmlFor="a2" className="mb-1 block text-sm font-medium">
                Nombre de camions
              </label>
              <Input id="a2" defaultValue="2" />
            </div>
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" defaultChecked /> Actives uniquement
          </label>
        </div>
      </Section>
      <Section
        id="fiche"
        title="En-tête de section et paires libellé/valeur (F4, F5)"
      >
        <div className="rounded-savr-xl border border-savr-neutral-200 bg-savr-white p-4">
          <BlocHeader icon={Building2} title="Informations légales" />
          <dl className="grid grid-cols-2 gap-3">
            <InfoItem label="SIRET">123 456 789 00012</InfoItem>
            <InfoItem label="Ville">Paris</InfoItem>
          </dl>
        </div>
      </Section>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
