'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InfoItem } from '@/components/ui/info-item';
import {
  MESSAGE_FORMAT_CODE_AFFAIRE_VIPARIS,
  normaliserCodeAffaireViparis,
} from '@/lib/viparis/codes';

/**
 * Code affaire VIPARIS de l'événement (Val 2026-11-02), lu et corrigé sur place
 * depuis les fiches : traiteur, agence, VIPARIS (gestionnaire du lieu) et équipe
 * Savr. Facultatif ; enregistré par PATCH /api/v1/evenements/[id]/code-affaire-viparis.
 */
export function CodeAffaireViparis({
  evenementId,
  code,
  modifiable = true,
}: {
  evenementId: string;
  code: string | null;
  modifiable?: boolean;
}) {
  const [valeur, setValeur] = React.useState(code);
  const [saisie, setSaisie] = React.useState<string | null>(null);
  const [erreur, setErreur] = React.useState<string | null>(null);
  const [envoi, setEnvoi] = React.useState(false);

  React.useEffect(() => setValeur(code), [code]);

  async function enregistrer() {
    const normalise = normaliserCodeAffaireViparis(saisie ?? '');
    if (normalise === undefined) {
      setErreur(MESSAGE_FORMAT_CODE_AFFAIRE_VIPARIS);
      return;
    }
    setEnvoi(true);
    setErreur(null);
    try {
      const res = await fetch(
        `/api/v1/evenements/${encodeURIComponent(evenementId)}/code-affaire-viparis`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code_affaire_viparis: normalise }),
        },
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setErreur(j?.error ?? "Le code n'a pas pu être enregistré.");
        return;
      }
      setValeur(normalise);
      setSaisie(null);
    } catch {
      setErreur("Le code n'a pas pu être enregistré.");
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <InfoItem label="Code affaire VIPARIS" data-testid="code-affaire-viparis">
      {saisie === null ? (
        <span className="flex flex-wrap items-center gap-2">
          {valeur ?? <span className="text-savr-neutral-400">—</span>}
          {modifiable && (
            <Button
              variant="link"
              size="sm"
              className="h-auto px-0"
              onClick={() => {
                setSaisie(valeur ?? '');
                setErreur(null);
              }}
            >
              {valeur ? 'Modifier' : 'Ajouter'}
            </Button>
          )}
        </span>
      ) : (
        <span className="flex flex-col gap-2">
          <span className="flex flex-wrap items-center gap-2">
            <Input
              aria-label="Code affaire VIPARIS"
              className="w-36 uppercase"
              maxLength={7}
              placeholder="26SIAL1"
              value={saisie}
              onChange={(e) => setSaisie(e.target.value)}
              error={Boolean(erreur)}
            />
            <Button size="sm" onClick={enregistrer} disabled={envoi}>
              Enregistrer
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSaisie(null)}
              disabled={envoi}
            >
              Annuler
            </Button>
          </span>
          {erreur && (
            <span className="text-xs font-normal text-savr-error-strong">
              {erreur}
            </span>
          )}
        </span>
      )}
    </InfoItem>
  );
}
