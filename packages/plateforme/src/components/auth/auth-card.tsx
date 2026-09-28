'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
} from '@/components/ui/card';

// Gabarit commun des écrans d'authentification (connexion, inscription,
// réinitialisation) : en-tête titre + description + action à droite, contenu,
// pied séparé qui porte le(s) bouton(s). Avec `onSubmit`, contenu et pied sont
// dans le même <form> : le bouton du pied soumet le formulaire.

// Lien d'en-tête ou de ligne de label : zone tactile 44 px (DS §10) sans
// décaler la mise en page (-my-3 compense py-3).
export const authLienClass =
  '-my-3 inline-flex items-center py-3 text-sm font-semibold text-savr-primary-700 underline-offset-4 hover:underline';

export function AuthPage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-savr-neutral-50 px-4 py-10">
      {children}
    </div>
  );
}

interface AuthCardProps {
  titre: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  pied?: React.ReactNode;
  onSubmit?: (e: React.FormEvent<HTMLFormElement>) => void;
  className?: string;
  children?: React.ReactNode;
}

export function AuthCard({
  titre,
  description,
  action,
  pied,
  onSubmit,
  className,
  children,
}: AuthCardProps) {
  const corps = (
    <>
      {children && <CardContent className="space-y-4">{children}</CardContent>}
      {pied && (
        <CardFooter className="gap-3 rounded-b-savr-md bg-savr-neutral-50 pt-6">
          {pied}
        </CardFooter>
      )}
    </>
  );

  return (
    <Card className={cn('w-full max-w-sm', className)}>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1.5">
          {/* h1 de la page au style CardTitle (DS §5.2 : titre de card, poids
              600) — CardTitle rend un h3. */}
          <h1 className="text-lg font-semibold tracking-tight text-savr-neutral-900">
            {titre}
          </h1>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </CardHeader>
      {onSubmit ? <form onSubmit={onSubmit}>{corps}</form> : corps}
    </Card>
  );
}
