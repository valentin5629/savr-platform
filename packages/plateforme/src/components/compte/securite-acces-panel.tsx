'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

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
        <p className="mb-3 text-sm text-savr-neutral-600">
          Historique des accès administrateur à votre compte. Un accès apparaît
          ici si un membre de l&apos;équipe Savr s&apos;est connecté à votre
          compte pour résoudre un incident.
        </p>
        {chargement ? (
          <p className="text-sm text-savr-neutral-500">Chargement…</p>
        ) : acces.length === 0 ? (
          <p className="text-sm text-savr-neutral-500" data-testid="acces-vide">
            Aucun accès administrateur enregistré.
          </p>
        ) : (
          <ul className="space-y-1" data-testid="acces-liste">
            {acces.map((a, i) => (
              <li
                key={i}
                className="flex items-center gap-2 text-sm text-savr-neutral-700"
              >
                <span className="font-medium">
                  {new Date(a.accede_le).toLocaleString('fr-FR')}
                </span>
                <span className="text-savr-neutral-500">
                  Accès administrateur
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
