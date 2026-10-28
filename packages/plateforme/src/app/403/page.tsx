import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ProhibitIcon } from '@/components/ui/icones';

// Cible des refus d'accès (middleware, lib/page-auth). Page publique, hors
// AppShell : elle se centre seule sur le fond de l'application.
export default function Page403() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-savr-neutral-50 px-4 py-16">
      <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-savr-lg border border-savr-neutral-200 bg-savr-white px-8 py-12 text-center shadow-savr-sm">
        <ProhibitIcon size={48} className="text-savr-primary-300" />
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-savr-neutral-900">
            Accès refusé
          </h1>
          <p className="text-sm text-savr-neutral-600">
            Vous n’avez pas les droits nécessaires pour accéder à cette page.
          </p>
        </div>
        <Button asChild variant="primary" size="md">
          <Link href="/">Retour à l’accueil</Link>
        </Button>
      </div>
    </main>
  );
}
