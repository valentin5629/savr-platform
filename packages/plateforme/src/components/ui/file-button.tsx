'use client';

import * as React from 'react';
import { Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { buttonVariants } from './button';

// Choix de fichier (R-UI-7, B11) : `<input type="file">` masqué + `<label>`
// habillé comme un `Button`. Une seule recette pour les uploads de logo
// (organisation, association) et de photos (fiche collecte Admin). Le champ est
// réinitialisé après chaque choix : re-choisir le même fichier redéclenche
// `onFile`.
export interface FileButtonProps {
  id: string;
  accept: string;
  onFile: (file: File) => void;
  disabled?: boolean;
  /** Envoi en cours : libellé `loadingText`, champ désactivé. */
  loading?: boolean;
  loadingText?: React.ReactNode;
  variant?: 'secondary' | 'link';
  className?: string;
  children: React.ReactNode;
}

export function FileButton({
  id,
  accept,
  onFile,
  disabled,
  loading = false,
  loadingText = 'Envoi…',
  variant = 'secondary',
  className,
  children,
}: FileButtonProps): React.ReactElement {
  const inactif = Boolean(disabled || loading);
  // Conteneur propre : les variantes `peer-*` du libellé ne doivent voir que SON
  // champ (`~` de CSS atteint tout frère précédent, y compris le champ d'un
  // FileButton voisin désactivé).
  return (
    <span className="inline-flex">
      <input
        id={id}
        type="file"
        accept={accept}
        className="peer sr-only"
        disabled={inactif}
        onChange={(e) => {
          const fichier = e.target.files?.[0];
          if (fichier) onFile(fichier);
          e.target.value = '';
        }}
      />
      <label
        htmlFor={id}
        aria-disabled={inactif || undefined}
        className={cn(
          buttonVariants({ variant }),
          'cursor-pointer',
          'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-savr-primary-500',
          'peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
          className,
        )}
      >
        <Upload aria-hidden="true" />
        {loading ? loadingText : children}
      </label>
    </span>
  );
}
