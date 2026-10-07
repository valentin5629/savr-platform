'use client';

import * as React from 'react';
import { Check, X } from 'lucide-react';
import { FormError } from '@/components/ui/form-error';
import { Text } from '@/components/ui/text';
import { IconButton } from '@/components/ui/icon-button';
import { FileButton } from '@/components/ui/file-button';

// Upload logo (association / organisation) vers R2 via /api/v1/admin/uploads/logo.
// Non bloquant : le logo est optionnel (Val 2026-07-02). Un échec (R2 absent en
// local, format/taille invalide) affiche un message mais ne casse pas le form.
interface LogoUploadProps {
  value: string; // clé de stockage R2 ("" si aucun)
  onChange: (logoUrl: string) => void;
  inputId?: string;
}

export function LogoUpload({
  value,
  onChange,
  inputId = 'logo',
}: LogoUploadProps) {
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/v1/admin/uploads/logo', {
        method: 'POST',
        body: fd,
      });
      const data = (await res.json().catch(() => null)) as {
        logo_url?: string;
        error?: string;
      } | null;
      if (!res.ok || !data?.logo_url) {
        setError(data?.error ?? 'Upload impossible');
        return;
      }
      onChange(data.logo_url);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        {value && (
          <img
            src={`/api/v1/admin/uploads/logo?key=${encodeURIComponent(value)}`}
            alt="Aperçu logo"
            className="h-12 w-12 rounded-savr-md border border-savr-neutral-200 object-contain"
          />
        )}
        <FileButton
          id={inputId}
          accept="image/png,image/jpeg"
          loading={uploading}
          onFile={(f) => void handleFile(f)}
        >
          Choisir un fichier
        </FileButton>
        {value ? (
          <span className="inline-flex items-center gap-1 text-sm text-savr-success-strong">
            <Check className="h-4 w-4" /> Logo enregistré
            <IconButton
              variant="destructive"
              size="sm"
              aria-label="Retirer le logo"
              onClick={() => onChange('')}
              className="-my-2 ml-1 [&>svg]:h-4 [&>svg]:w-4"
            >
              <X className="h-4 w-4" />
            </IconButton>
          </span>
        ) : (
          <Text as="span" variant="hint">
            JPG ou PNG, 2 Mo max
          </Text>
        )}
      </div>
      <FormError>{error}</FormError>
    </div>
  );
}
