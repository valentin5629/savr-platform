'use client';

import * as React from 'react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { FileButton } from '@/components/ui/file-button';
import { FormError } from '@/components/ui/form-error';
import { Text } from '@/components/ui/text';
import { useToast } from '@/components/ui/toast';

// Logo du client imprimé sur les rapports (décision Val 2026-10-30) : ligne de
// l'onglet Documents (Admin) et du Bilan (fiche client), au-dessus du
// téléchargement du rapport. Le logo est rangé sur l'événement : il vaut pour
// toutes ses collectes et pour tous ceux qui téléchargent. Les rapports de don
// déjà fabriqués sont refaits par le serveur avec le nouveau logo.
//
// `endpoint` = route `…/collectes/[id]/logo-client` de l'espace : GET (aperçu,
// 404 sans logo), POST multipart `file`, DELETE.
export function LogoClientRapport({
  endpoint,
  id,
}: {
  endpoint: string;
  /** Identifiant unique du champ fichier dans la page. */
  id: string;
}): React.ReactElement {
  const { toast } = useToast();
  // Change à chaque dépôt ou retrait : recharge l'aperçu (cache du proxy).
  const [version, setVersion] = useState(0);
  // `null` tant que l'aperçu n'a pas répondu.
  const [present, setPresent] = useState<boolean | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [retrait, setRetrait] = useState(false);
  const [erreur, setErreur] = useState('');

  async function appliquer(init: RequestInit, titre: string) {
    setErreur('');
    const r = await fetch(endpoint, init).catch(() => null);
    const j = (await r?.json().catch(() => ({}))) as {
      error?: string;
      rapports_refaits?: number;
    };
    if (!r?.ok) {
      setErreur(j?.error ?? 'Le logo n’a pas pu être enregistré.');
      return;
    }
    setPresent(null);
    setVersion((v) => v + 1);
    toast({
      title: titre,
      description:
        (j.rapports_refaits ?? 0) > 0
          ? 'Les rapports de don déjà disponibles sont en cours de mise à jour.'
          : undefined,
      variant: 'success',
    });
  }

  async function deposer(file: File) {
    setEnvoi(true);
    const form = new FormData();
    form.append('file', file);
    await appliquer(
      { method: 'POST', body: form },
      'Logo du client enregistré.',
    );
    setEnvoi(false);
  }

  async function retirer() {
    setRetrait(true);
    await appliquer({ method: 'DELETE' }, 'Logo du client retiré.');
    setRetrait(false);
  }

  return (
    <div
      className="flex flex-wrap items-center gap-3 py-3"
      data-testid="logo-client-rapport"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Logo du client</p>
        <Text variant="hint">
          Imprimé sur les rapports de toutes les collectes de l’événement. JPG
          ou PNG, 1 Mo maximum.
        </Text>
        <FormError>{erreur}</FormError>
      </div>
      {present !== false && (
        <img
          key={version}
          src={`${endpoint}?v=${version}`}
          alt="Logo du client"
          onLoad={() => setPresent(true)}
          onError={() => setPresent(false)}
          className={
            present
              ? 'h-11 w-auto max-w-40 rounded-savr-md border border-savr-neutral-200 object-contain'
              : 'hidden'
          }
        />
      )}
      <FileButton
        id={id}
        accept="image/png,image/jpeg"
        loading={envoi}
        loadingText="Envoi…"
        disabled={retrait}
        onFile={(f) => void deposer(f)}
      >
        {present ? 'Remplacer le logo' : 'Ajouter le logo'}
      </FileButton>
      {present && (
        <Button
          variant="ghost-destructive"
          loading={retrait}
          loadingText="Retrait…"
          disabled={envoi}
          onClick={() => void retirer()}
        >
          Retirer
        </Button>
      )}
    </div>
  );
}
