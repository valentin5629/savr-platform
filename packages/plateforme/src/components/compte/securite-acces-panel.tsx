'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingState } from '@/components/ui/loading-state';

type Acces = { accede_le: string; type_acces: string };

// BL-P3-13 — Panneau « Sécurité du compte » (CDC §15 §2.3). Expose à l'utilisateur
// l'historique des accès administrateur (impersonation) à SON compte — date
// uniquement, jamais l'identité de l'admin. Transverse aux rôles impersonables
// (traiteur, agence, gestionnaire de lieux, client organisateur).
export function SecuriteAccesPanel(): React.JSX.Element {
  const [acces, setAcces] = useState<Acces[]>([]);
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/me/acces');
        if (res.ok) {
          const { data } = await res.json();
          setAcces(Array.isArray(data) ? data : []);
        }
      } finally {
        setChargement(false);
      }
    })();
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sécurité du compte</CardTitle>
      </CardHeader>
      <CardContent>
        <Text tone="soft" className="mb-3">
          Historique des accès administrateur à votre compte. Un accès apparaît
          ici si un membre de l&apos;équipe Savr s&apos;est connecté à votre
          compte pour résoudre un incident.
        </Text>
        {chargement ? (
          <LoadingState />
        ) : acces.length === 0 ? (
          // EmptyState ne relaie pas data-testid : porté par l'enveloppe.
          <div data-testid="acces-vide">
            <EmptyState
              size="inline"
              title="Aucun accès administrateur enregistré."
            />
          </div>
        ) : (
          <ul className="space-y-1" data-testid="acces-liste">
            {acces.map((a, i) => (
              <Text
                as="li"
                variant="body"
                className="flex items-center gap-2"
                key={i}
              >
                <span className="font-medium">
                  {new Date(a.accede_le).toLocaleString('fr-FR', {
                    timeZone: 'Europe/Paris',
                  })}
                </span>
                <span className="text-savr-neutral-500">
                  Accès administrateur
                </span>
              </Text>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
