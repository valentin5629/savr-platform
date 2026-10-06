import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { Section } from './common-6b';
import SignupPage from '@/app/signup/page';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/ui/form-field';
import { FormGrid } from '@/components/ui/form-grid';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { SectionHeader } from '@/components/ui/section-header';
import { InfoItem } from '@/components/ui/info-item';
import { Building2 } from 'lucide-react';
import { FormError } from '@/components/ui/form-error';

// R-UI-5 « après » : mêmes sections, primitives du DS.
function App() {
  return (
    <div className="bg-savr-neutral-50">
      <Section id="champs" title="Champs de formulaire (F1, F2, F3, F7)">
        <div className="rounded-savr-xl border border-savr-neutral-200 bg-savr-white p-4">
          <FormGrid cols={2}>
            <FormField label="Motif (≥ 10 caractères)" htmlFor="a1" required>
              <Input id="a1" defaultValue="Retard prestataire" />
            </FormField>
            <FormField label="Nombre de camions" htmlFor="a2">
              <Input id="a2" defaultValue="2" />
            </FormField>
          </FormGrid>
          <div className="mt-3 flex items-center gap-2">
            <Checkbox id="a3" defaultChecked />
            <Label htmlFor="a3" variant="choice">
              Actives uniquement
            </Label>
          </div>
        </div>
      </Section>
      <Section
        id="fiche"
        title="En-tête de section et paires libellé/valeur (F4, F5)"
      >
        <div className="rounded-savr-xl border border-savr-neutral-200 bg-savr-white p-4">
          <SectionHeader icon={Building2} title="Informations légales" />
          <dl className="grid grid-cols-2 gap-3">
            <InfoItem label="SIRET">123 456 789 00012</InfoItem>
            <InfoItem label="Ville">Paris</InfoItem>
          </dl>
        </div>
      </Section>
      <Section
        id="radio-erreurs"
        title="Signup : choix du profil (F2) — page réelle"
      >
        <SignupPage />
      </Section>
      <Section id="erreur-champ" title="Erreur de champ (F6) — FormError">
        <div className="rounded-savr-xl border border-savr-neutral-200 bg-savr-white p-4">
          <FormError>Le logo doit faire moins de 2 Mo.</FormError>
        </div>
      </Section>
      <section
        id="mobile"
        style={{ width: 375 }}
        className="bg-savr-neutral-50 p-4"
      >
        <div className="mb-3 text-xs font-bold uppercase tracking-wide text-savr-neutral-500">
          Édition de collecte sous 640 px (F3) — FormGrid
        </div>
        <div className="rounded-savr-xl border border-savr-neutral-200 bg-savr-white p-4">
          <FormGrid cols={2}>
            <FormField label="Nombre de convives (pax)" htmlFor="edit-evt-pax">
              <Input id="edit-evt-pax" type="number" defaultValue="120" />
            </FormField>
            <FormField label="Client final" htmlFor="edit-evt-client">
              <Input id="edit-evt-client" defaultValue="Fondation X" />
            </FormField>
          </FormGrid>
        </div>
      </section>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
