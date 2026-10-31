'use client';

import * as React from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

// Page « Paramètres » des espaces client : « Mon organisation » et « Mon
// profil » y sont des onglets (décision Val 2026-10-31). L'onglet ouvert est
// recopié dans l'URL (`?onglet=`) : les anciennes adresses redirigent vers le
// bon onglet, et un rechargement garde l'onglet. La page serveur lit
// `searchParams` et passe la valeur brute en `initial`.

/**
 * Onglet courant, recopié dans l'URL à chaque changement (sans rechargement).
 * Au départ : l'onglet demandé s'il existe, sinon le premier.
 */
export function useOngletUrl<T extends string>(
  initial: string | string[] | undefined,
  onglets: readonly T[],
): [T, (v: string) => void] {
  const defaut = onglets[0]!;
  const demande = Array.isArray(initial) ? initial[0] : initial;
  const [onglet, setOnglet] = React.useState<T>(
    onglets.includes(demande as T) ? (demande as T) : defaut,
  );
  const changer = React.useCallback(
    (v: string) => {
      setOnglet(v as T);
      const url = new URL(window.location.href);
      if (v === defaut) url.searchParams.delete('onglet');
      else url.searchParams.set('onglet', v);
      window.history.replaceState(window.history.state, '', url);
    },
    [defaut],
  );
  return [onglet, changer];
}

export interface OngletParametres {
  value: string;
  label: string;
  contenu: React.ReactNode;
}

export function ParametresOnglets({
  onglets,
  initial,
  entete,
}: {
  onglets: OngletParametres[];
  initial?: string | string[];
  /** Texte affiché sous le titre, au-dessus des onglets. */
  entete?: React.ReactNode;
}) {
  const [onglet, setOnglet] = useOngletUrl(
    initial,
    onglets.map((o) => o.value),
  );
  return (
    <div className="space-y-6">
      <PageHeader title="Paramètres" />
      {entete}
      {/* Onglets du DS (R-UI-4b, D4) : un seul contenu monté à la fois. */}
      <Tabs value={onglet} onValueChange={setOnglet}>
        <TabsList className="w-full flex-wrap justify-start">
          {onglets.map((o) => (
            <TabsTrigger key={o.value} value={o.value}>
              {o.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {onglets.map((o) => (
          <TabsContent key={o.value} value={o.value} className="space-y-6">
            {o.contenu}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
