import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { Section } from './common-6b';
import { Pencil, Trash2, Plus, Save, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { TextLink } from '@/components/ui/text-link';
import { FormActions } from '@/components/ui/form-actions';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Text } from '@/components/ui/text';
import { AnnulationCollecteDialog } from '@/components/collecte/annulation-collecte-dialog';
import CguPage from '@/app/cgu/page';
import MethodologiePage from '@/app/(registre)/registre/methodologie/page';

const Row = ({ children }: { children: React.ReactNode }) => (
  <div className="flex flex-wrap items-center gap-3">{children}</div>
);

function App() {
  const hash = window.location.hash;
  if (hash === '#dialog') {
    return (
      <ConfirmDialog
        open
        title="Annuler le pack"
        confirmLabel="Confirmer l’annulation"
        cancelLabel="Retour"
        variant="destructive"
        motif={{ label: 'Motif', minLength: 10 }}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      >
        <Text>
          Le pack <strong>Pack 20</strong> (12 crédits restants) sera annulé
          définitivement. Les crédits non consommés seront perdus.
        </Text>
      </ConfirmDialog>
    );
  }
  if (hash === '#dialog-collecte') {
    return (
      <AnnulationCollecteDialog
        open
        demande={false}
        antiGaspi
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />
    );
  }
  return (
    <div className="bg-savr-neutral-50">
      <Section id="boutons" title="Button — variants, loading (B1/B3/B6)">
        <div className="space-y-3">
          <Row>
            <Button>Enregistrer</Button>
            <Button variant="secondary">Annuler</Button>
            <Button variant="accent">
              <Plus /> Nouvelle collecte
            </Button>
            <Button variant="destructive">Supprimer</Button>
            <Button variant="ghost">
              <Download /> Télécharger
            </Button>
            <Button variant="link">Lien</Button>
          </Row>
          <Row>
            <Button variant="outline-destructive">Désactiver</Button>
            <Button variant="ghost-destructive" size="sm" className="text-xs">
              Supprimer
            </Button>
            <Button variant="outline-warning">
              Demander les coordonnées en urgence
            </Button>
          </Row>
          <Row>
            <Button loading loadingText="Enregistrement…">
              Enregistrer
            </Button>
            <Button variant="secondary" loading loadingText="Envoi…">
              <Save /> Envoyer
            </Button>
            <Button variant="destructive" loading loadingText="Annulation…">
              Confirmer l’annulation
            </Button>
            <Button disabled>Désactivé</Button>
          </Row>
        </div>
      </Section>
      <Section id="icon-buttons" title="IconButton — ghost / destructive / loading (B4)">
        <Row>
          <IconButton aria-label="Modifier">
            <Pencil />
          </IconButton>
          <IconButton size="sm" aria-label="Modifier">
            <Pencil />
          </IconButton>
          <IconButton size="sm" variant="destructive" aria-label="Supprimer">
            <Trash2 />
          </IconButton>
          <IconButton size="sm" aria-label="Enregistrer la ligne" loading>
            <Save />
          </IconButton>
        </Row>
      </Section>
      <Section id="liens" title="TextLink — recette unique (B2)">
        <div className="space-y-2 text-sm">
          <p>
            Déjà un compte ?{' '}
            <TextLink href="/login" strong touch className="text-sm">
              Se connecter
            </TextLink>
          </p>
          <p>
            <TextLink href="/registre" className="text-sm">
              ← Registre
            </TextLink>
          </p>
          <p>
            <TextLink onClick={() => undefined} className="text-sm">
              <Download className="h-4 w-4" />
              Télécharger le PDF Savr (copie de travail)
            </TextLink>
          </p>
          <p>
            <TextLink href="/admin/factures/1" className="font-medium">
              F-2026-0042
            </TextLink>
          </p>
        </div>
      </Section>
      <Section id="form-actions" title="FormActions — secondaire puis primaire, à droite (B5)">
        <div className="space-y-4 rounded-savr-md bg-savr-white p-4">
          <FormActions
            cancel={{ label: 'Annuler' }}
            submit={{ label: 'Enregistrer' }}
          />
          <FormActions
            bordered
            loading
            loadingText="Création…"
            cancel={{ label: 'Retour' }}
            submit={{ label: 'Créer le pack', variant: 'destructive' }}
          />
        </div>
      </Section>
      <Section id="page-cgu" title="Page CGU (lien de retour)">
        <CguPage />
      </Section>
      <Section id="page-methodologie" title="Page méthodologie registre (lien ← Registre)">
        <MethodologiePage />
      </Section>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
