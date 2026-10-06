'use client';

import './globals.css';
import {
  RouteError,
  type RouteErrorProps,
} from '@/components/layout/route-states';

// Erreur du layout racine (R-UI-1 H5) : remplace `app/layout.tsx`, donc rend
// son propre <html>/<body> (sans ToastProvider ni police Nunito).
export default function GlobalError(props: RouteErrorProps) {
  return (
    <html lang="fr">
      <body>
        <main className="mx-auto w-full max-w-xl p-6">
          <RouteError {...props} />
        </main>
      </body>
    </html>
  );
}
