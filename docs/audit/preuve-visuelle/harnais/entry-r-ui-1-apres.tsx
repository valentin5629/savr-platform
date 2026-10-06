import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { Section } from './common-6b';
import { AlertBar } from '@/components/ui/alert-bar';
import { ToastProvider, useToast } from '@/components/ui/toast';
import { LoadingState } from '@/components/ui/loading-state';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { EmptyDashboardState } from '@/components/dashboards/EmptyDashboardState';
import { RouteError, RouteLoading } from '@/components/layout/route-states';
import { OpsReadOnlyBanner } from '@/components/ui/ops-read-only-banner';

// R-UI-1 « après » : mêmes sections, primitives du DS. Le toast est déclenché
// au montage (viewport fixe : capture plein écran `toast`).
function ToastAuto() {
  const { toast } = useToast();
  React.useEffect(() => {
    toast({
      title: 'Invitation envoyée.',
      variant: 'success',
      duration: 60000,
    });
  }, [toast]);
  return null;
}

function App() {
  return (
    <ToastProvider>
      {location.hash === '#toast' && <ToastAuto />}
      <div className="bg-savr-neutral-50">
        <Section id="succes" title="Succès après action — Toast 4 s (H1)">
          <div className="rounded-savr-xl border border-savr-neutral-200 bg-savr-white p-4 text-sm text-savr-neutral-500">
            Le formulaire ne porte plus de message : le succès s'affiche en
            toast (capture « toast »).
          </div>
        </Section>
        <Section id="bandeaux" title="Bandeaux d'alerte — AlertBar (H2)">
          <div className="space-y-3">
            <AlertBar variant="warn" className="[&>span]:flex-1">
              <span className="flex items-center justify-between">
                <span>En attente Pennylane depuis plus de 2 h.</span>
                <button className="font-semibold">Renvoyer</button>
              </span>
            </AlertBar>
            <AlertBar variant="err" role="alert">
              La mise à jour du mix a échoué.
            </AlertBar>
          </div>
        </Section>
        <Section id="chargement" title="Chargement — LoadingState (H3)">
          <div className="space-y-3 rounded-savr-xl border border-savr-neutral-200 bg-savr-white p-4">
            <LoadingState />
            <LoadingState variant="bloc" lignes={2} />
          </div>
        </Section>
        <Section id="vide" title="Vide — EmptyState (H4)">
          <div className="space-y-3 rounded-savr-xl border border-savr-neutral-200 bg-savr-white p-4">
            <EmptyState size="inline" title="Aucun membre." />
            <EmptyDashboardState />
          </div>
        </Section>
        <Section id="route" title="Route : loading.tsx et error.tsx (H3/H5)">
          <div className="grid grid-cols-2 gap-6">
            <div className="rounded-savr-xl border border-savr-neutral-200 bg-savr-white p-4">
              <RouteLoading />
            </div>
            <div className="rounded-savr-xl border border-savr-neutral-200 bg-savr-white p-4">
              <RouteError
                error={new Error('détail serveur masqué')}
                reset={() => undefined}
              />
            </div>
          </div>
        </Section>
        <Section
          id="ops-erreur-normale"
          title="Paramètres CO₂ en ops_savr (H6) + erreur font-normal"
        >
          <div className="space-y-3 rounded-savr-xl border border-savr-neutral-200 bg-savr-white p-4">
            <OpsReadOnlyBanner />
            <AlertBar variant="err" className="font-normal">
              La mise à jour du mix d'emballages a échoué.
            </AlertBar>
          </div>
        </Section>
        <Section id="erreur" title="Erreur de chargement — ErrorState (H5)">
          <div className="rounded-savr-xl border border-savr-neutral-200 bg-savr-white p-4">
            <ErrorState
              message="Le chargement des collectes a échoué."
              onRetry={() => undefined}
            />
          </div>
        </Section>
      </div>
    </ToastProvider>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
