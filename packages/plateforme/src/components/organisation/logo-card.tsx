'use client';

import * as React from 'react';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FormError } from '@/components/ui/form-error';
import { Text } from '@/components/ui/text';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { FileButton } from '@/components/ui/file-button';

// LogoCard — bloc « Logo » de la fiche organisation (R-UI-6b, I9 : ex-copies
// locales traiteur / gestionnaire de lieux, §06.04 et §06.05 §6 Bloc
// Organisation). Upload R2 via `uploadUrl` (multipart, JPG/PNG 2 Mo), puis
// l'appelant enregistre la clé sur le profil (`onUploaded`) — c'est lui qui
// connaît sa route PATCH et son rechargement. Aperçu via `previewSrc(clé)` ;
// une clé dont le fichier manque côté R2 retombe sur « Aucun logo ».
interface LogoCardProps {
  /** Clé R2 du logo courant (`profil.logo_url`), `null` si aucun. */
  logoKey: string | null | undefined;
  /** Route POST multipart qui renvoie `{ logo_url }`. */
  uploadUrl: string;
  /** URL d'aperçu d'une clé (proxy image de l'espace). */
  previewSrc: (logoKey: string) => string;
  /** Enregistre la clé sur le profil ; rejette avec un message lisible en cas d'échec. */
  onUploaded: (logoKey: string) => Promise<void>;
  /** `false` = lecture seule (ex. commercial traiteur). Défaut `true`. */
  canEdit?: boolean;
}

export function LogoCard({
  logoKey,
  uploadUrl,
  previewSrc,
  onUploaded,
  canEdit = true,
}: LogoCardProps): React.ReactElement {
  const [uploading, setUploading] = useState(false);
  const [erreur, setErreur] = useState('');
  // Succès = toast 4 s (R-UI-1 H1).
  const { toast } = useToast();
  // Clé dont l'aperçu n'a pas pu être chargé (fichier absent côté R2).
  const [apercuKo, setApercuKo] = useState<string | null>(null);

  async function upload(file: File) {
    setUploading(true);
    setErreur('');
    try {
      const form = new FormData();
      form.append('file', file);
      const up = await fetch(uploadUrl, { method: 'POST', body: form });
      const j = (await up.json().catch(() => ({}))) as {
        logo_url?: string;
        error?: string;
      };
      if (!up.ok || !j.logo_url)
        throw new Error(j.error ?? 'Échec de l’envoi du logo.');
      // L'appelant enregistre la clé sur le profil ; son rejet porte le message affiché.
      await onUploaded(j.logo_url);
      toast({ title: 'Logo mis à jour.', variant: 'success' });
    } catch (err) {
      setErreur((err as Error).message);
    } finally {
      setUploading(false);
      // Permet de re-sélectionner le même fichier après un échec.
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Logo</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {logoKey && apercuKo !== logoKey ? (
          <img
            // La clé change à chaque upload : force le rechargement du proxy.
            src={previewSrc(logoKey)}
            alt="Logo de l'organisation"
            onError={() => setApercuKo(logoKey)}
            className="h-16 w-auto rounded-savr-md border border-savr-neutral-200 object-contain"
          />
        ) : (
          <EmptyState size="inline" title="Aucun logo." />
        )}
        {canEdit && (
          <div className="space-y-1">
            <FileButton
              id="org-logo"
              accept="image/png,image/jpeg"
              loading={uploading}
              onFile={(f) => void upload(f)}
            >
              {logoKey ? 'Remplacer le logo' : 'Ajouter un logo'}
            </FileButton>
            <Text variant="hint">JPG ou PNG, 2 Mo max.</Text>
            <FormError>{erreur}</FormError>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
