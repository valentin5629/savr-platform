import * as React from 'react';
import { createRoot } from 'react-dom/client';
import Link from 'next/link';
import { Section } from './common-6b';
import { Pencil, Trash2, Plus, Save, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { ACTION_DESTRUCTIVE_CONTOUR } from '@/components/collecte/fiche-blocs';
import { authLienClass } from '@/components/auth/auth-card';
import CguPage from '@/app/cgu/page';
import MethodologiePage from '@/app/(registre)/registre/methodologie/page';

const Row = ({ children }: { children: React.ReactNode }) => (
  <div className="flex flex-wrap items-center gap-3">{children}</div>
);

function App() {
  return (
    <div className="bg-savr-neutral-50">
      <Section id="boutons" title="Button — variants, loading (avant)">
        <div className="space-y-3">
          <Row>
            <Button>Enregistrer</Button>
            <Button variant="secondary">Annuler</Button>
            <Button variant="accent">
              <Plus className="h-4 w-4 mr-1" /> Nouvelle collecte
            </Button>
            <Button variant="destructive">Supprimer</Button>
            <Button variant="ghost">
              <Download className="h-4 w-4 mr-1" /> Télécharger
            </Button>
            <Button variant="link">Lien</Button>
          </Row>
          <Row>
            <Button variant="secondary" className={ACTION_DESTRUCTIVE_CONTOUR}>
              Désactiver
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-savr-error text-xs"
            >
              Supprimer
            </Button>
            <Button
              variant="secondary"
              className="border-savr-warning-strong text-savr-warning-strong hover:bg-savr-white"
            >
              Demander les coordonnées en urgence
            </Button>
          </Row>
          <Row>
            <Button disabled>Enregistrement…</Button>
            <Button variant="secondary" disabled>
              <Save className="h-4 w-4 mr-1" /> Envoi…
            </Button>
            <Button variant="destructive" disabled>
              Annulation…
            </Button>
            <Button disabled>Désactivé</Button>
          </Row>
        </div>
      </Section>
      <Section
        id="icon-buttons"
        title="Icône seule (avant) — Button size=icon / <button> brut"
      >
        <Row>
          <IconButton aria-label="Modifier">
            <Pencil />
          </IconButton>
          <Button variant="ghost" size="icon" aria-label="Modifier">
            <Pencil className="h-4 w-4" />
          </Button>
          <button
            type="button"
            aria-label="Supprimer"
            className="p-2 text-savr-neutral-400 hover:text-savr-error-strong"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <Button variant="secondary" disabled>
            …
          </Button>
        </Row>
      </Section>
      <Section id="liens" title="Liens texte (avant) — 4 recettes">
        <div className="space-y-2 text-sm">
          <p>
            Déjà un compte ?{' '}
            <Link href="/login" className={authLienClass}>
              Se connecter
            </Link>
          </p>
          <p>
            <a
              href="/registre"
              className="text-sm text-savr-primary-700 underline"
            >
              ← Registre
            </a>
          </p>
          <p>
            <button
              type="button"
              className="inline-flex items-center gap-2 text-sm text-savr-primary-700 hover:underline"
            >
              <Download className="h-4 w-4" />
              Télécharger le PDF Savr (copie de travail)
            </button>
          </p>
          <p>
            <Link
              href="/admin/factures/1"
              className="font-medium text-savr-primary-700 hover:underline"
            >
              F-2026-0042
            </Link>
          </p>
        </div>
      </Section>
      <Section id="form-actions" title="Pieds d’actions (avant) — recopiés">
        <div className="space-y-4 rounded-savr-md bg-savr-white p-4">
          <div className="flex justify-end gap-2">
            <Button variant="secondary">Annuler</Button>
            <Button>Enregistrer</Button>
          </div>
          <div className="flex justify-end gap-2 border-t border-savr-neutral-100 pt-4">
            <Button variant="secondary" disabled>
              Retour
            </Button>
            <Button variant="destructive" disabled>
              Création…
            </Button>
          </div>
        </div>
      </Section>
      <Section id="page-cgu" title="Page CGU (lien de retour)">
        <CguPage />
      </Section>
      <Section
        id="page-methodologie"
        title="Page méthodologie registre (lien ← Registre)"
      >
        <MethodologiePage />
      </Section>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
