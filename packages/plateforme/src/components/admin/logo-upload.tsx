'use client';

import * as React from 'react';
import { Upload, Check, X } from 'lucide-react';

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

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
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
        <label
          htmlFor={inputId}
          className="inline-flex cursor-pointer items-center gap-2 rounded-savr-md border border-savr-neutral-300 bg-savr-white px-3 py-2 text-sm font-medium text-savr-neutral-700 hover:border-savr-primary-400"
        >
          <Upload className="h-4 w-4" />
          {uploading ? 'Envoi…' : 'Choisir un fichier'}
        </label>
        <input
          id={inputId}
          type="file"
          accept="image/png,image/jpeg"
          className="sr-only"
          onChange={(e) => void handleFile(e)}
          disabled={uploading}
        />
        {value ? (
          <span className="inline-flex items-center gap-1 text-sm text-savr-success-strong">
            <Check className="h-4 w-4" /> Logo enregistré
            <button
              type="button"
              aria-label="Retirer le logo"
              onClick={() => onChange('')}
              className="ml-1 text-savr-neutral-400 hover:text-savr-error"
            >
              <X className="h-4 w-4" />
            </button>
          </span>
        ) : (
          <span className="text-xs text-savr-neutral-500">
            JPG ou PNG, 2 Mo max
          </span>
        )}
      </div>
      {error && <p className="text-xs text-savr-error-strong">{error}</p>}
    </div>
  );
}
