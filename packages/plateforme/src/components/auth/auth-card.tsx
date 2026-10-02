'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { SavrLogoMark } from '@/components/layout/savr-logo';
import { Heading } from '@/components/ui/heading';
import { Text } from '@/components/ui/text';

// Gabarit commun des écrans d'authentification (connexion, inscription,
// réinitialisation) : logo Savr au-dessus, carte avec titre centré, contenu et
// bouton(s), puis un lien secondaire SOUS la carte (« Créer un compte »…).
// Avec `onSubmit`, contenu et bouton(s) sont dans le même <form>.
//
// Exception au DS §5.2 (Card radius md, sans ombre) et fond en dégradé :
// arbitrage Val 2026-09-28, tracé dans _Divergences/M0.5_20260928_ecrans-auth-
// carte-ombre-degrade.md — limité à ces écrans.

// Lien secondaire : zone tactile 44 px (DS §10) sans décaler la mise en page
// (-my-3 compense py-3).
export const authLienClass =
  '-my-3 inline-flex items-center py-3 text-sm font-semibold text-savr-primary-700 underline-offset-4 hover:underline';

export function AuthPage({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center bg-gradient-to-b from-savr-neutral-50 via-savr-primary-50 to-savr-accent-50 px-4 py-12">
      {/* Logo complet « + savr » en couleurs : navy primary-700, coin de la
          croix accent-500. */}
      <SavrLogoMark
        title="Savr"
        base="var(--color-savr-primary-700)"
        className="mb-8 h-12 w-auto text-savr-accent-500"
      />
      {children}
    </main>
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
      <Card className="space-y-6 rounded-savr-lg px-6 py-8 shadow-savr-md sm:px-10">
        <div className="space-y-2 text-center">
          <Heading level={1} className="tracking-tight">
            {titre}
          </Heading>
          {description && <Text>{description}</Text>}
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
