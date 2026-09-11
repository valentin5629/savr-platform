import { notFound } from 'next/navigation';

// `/dev/*` est public (middleware, PUBLIC_PREFIXES) pour les smoke-tests de
// composants en `next dev`. Toute page ajoutée ici serait donc publique en prod :
// ce layout serveur répond 404 sur tout build de production (`next build` fixe
// NODE_ENV=production — prod ET dev.app.gosavr.io). La garde vit dans un layout
// serveur car les pages de smoke-test sont des Client Components.
// Cliquet : tests/securite/dev-routes-prod.test.ts.
export default function DevLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactNode {
  if (process.env.NODE_ENV === 'production') notFound();
  return children;
}
