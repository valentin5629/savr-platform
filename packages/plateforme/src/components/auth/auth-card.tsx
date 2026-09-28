'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { SavrLogoMark } from '@/components/layout/savr-logo';

// Gabarit commun des écrans d'authentification (connexion, inscription,
// réinitialisation) : logo Savr au-dessus, carte avec titre centré, contenu et
// bouton(s), puis un lien secondaire SOUS la carte (« Créer un compte »…).
// Avec `onSubmit`, contenu et bouton(s) sont dans le même <form>.

// Lien secondaire : zone tactile 44 px (DS §10) sans décaler la mise en page
// (-my-3 compense py-3).
export const authLienClass =
  '-my-3 inline-flex items-center py-3 text-sm font-semibold text-savr-primary-700 underline-offset-4 hover:underline';

export function AuthPage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center bg-gradient-to-b from-savr-neutral-50 to-savr-primary-50 px-4 py-12">
      {/* Le logo est peint en blanc (conçu pour la sidebar navy) : il est posé
          sur une pastille primary-700, comme dans la barre latérale. */}
      <div className="mb-8 flex h-16 w-16 items-center justify-center rounded-full bg-savr-primary-700 text-savr-accent-500">
        <SavrLogoMark variant="mark" title="Savr" className="h-8 w-8" />
      </div>
      {children}
    </div>
  );
}

interface AuthCardProps {
  titre: string;
  description?: React.ReactNode;
  /** Bouton(s) en bas de carte. */
  pied?: React.ReactNode;
  /** Lien secondaire centré sous la carte. */
  sousCarte?: React.ReactNode;
  onSubmit?: (e: React.FormEvent<HTMLFormElement>) => void;
  className?: string;
  children?: React.ReactNode;
}

export function AuthCard({
  titre,
  description,
  pied,
  sousCarte,
  onSubmit,
  className,
  children,
}: AuthCardProps) {
  const corps = (
    <>
      {children && <div className="space-y-4">{children}</div>}
      {pied && <div className="flex gap-3 pt-2">{pied}</div>}
    </>
  );

  return (
    <div className={cn('w-full max-w-md', className)}>
      <Card className="space-y-6 rounded-savr-lg px-6 py-8 shadow-savr-sm sm:px-10">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-savr-neutral-900">
            {titre}
          </h1>
          {description && (
            <p className="text-sm text-savr-neutral-500">{description}</p>
          )}
        </div>
        {onSubmit ? (
          <form onSubmit={onSubmit} className="space-y-6">
            {corps}
          </form>
        ) : (
          corps
        )}
      </Card>
      {sousCarte && <div className="mt-6 text-center">{sousCarte}</div>}
    </div>
  );
}
