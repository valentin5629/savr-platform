'use client';

import * as React from 'react';
import { AlertBar } from './alert-bar';
import { Combobox } from './combobox';
import { FormActions } from './form-actions';
import { FormField } from './form-field';
import { Modal } from './modal';
import { Text } from './text';
import { Textarea } from './textarea';

// ConfirmDialog — confirmation d'une action (R-UI-3, G1). Remplace les
// `window.confirm()` natifs (non stylés, non accessibles, bloquants) et les
// modales de confirmation recopiées. Structure §5.9 (Modal : focus-trap, Esc,
// overlay) ; actions = `FormActions` (« Retour » puis l'action, à droite).
// `motif` ajoute un champ texte (facultatif ou obligatoire avec longueur
// minimale) dont la valeur est passée à `onConfirm`. Avec `choix`, le motif se
// choisit dans une liste ; l'option `autre` ouvre un champ texte pour le
// préciser. Valeur passée : l'option choisie, ou la précision saisie (à
// défaut, le libellé de `autre`).
export interface ConfirmMotif {
  label: string;
  /** Longueur minimale ; 0 ou absent = facultatif. */
  minLength?: number;
  placeholder?: string;
  rows?: number;
  /** Motif choisi dans une liste (facultatif : aucun choix = chaîne vide). */
  choix?: {
    options: readonly string[];
    /** Option qui ouvre le champ texte de précision. */
    autre: string;
  };
}

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** Message (chaîne = paragraphe `Text`) ou corps libre. */
  children?: React.ReactNode;
  confirmLabel: React.ReactNode;
  cancelLabel?: React.ReactNode;
  /** `destructive` (défaut) : action rouge ; `primary` : confirmation neutre. */
  variant?: 'destructive' | 'primary';
  loading?: boolean;
  loadingText?: React.ReactNode;
  /** Erreur serveur affichée au-dessus du corps. */
  error?: string | null;
  motif?: ConfirmMotif;
  onConfirm: (motif: string) => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Retour',
  variant = 'destructive',
  loading = false,
  loadingText,
  error,
  motif,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): React.ReactElement {
  const [valeurMotif, setValeurMotif] = React.useState('');
  const [choixMotif, setChoixMotif] = React.useState('');
  const id = React.useId();
  React.useEffect(() => {
    if (!open) {
      setValeurMotif('');
      setChoixMotif('');
    }
  }, [open]);
  const choix = motif?.choix;
  const autre = !!choix && choixMotif === choix.autre;
  const minLength = choix ? 0 : (motif?.minLength ?? 0);
  const motifOk = !motif || valeurMotif.trim().length >= minLength;
  const motifEnvoye = !choix
    ? valeurMotif.trim()
    : autre
      ? valeurMotif.trim() || choix.autre
      : choixMotif;
  const champTexte = (
    <Textarea
      id={`${id}-motif${choix ? '-precision' : ''}`}
      rows={motif?.rows ?? 3}
      value={valeurMotif}
      onChange={(e) => setValeurMotif(e.target.value)}
      minLength={minLength || undefined}
      required={minLength > 0}
      placeholder={motif?.placeholder}
    />
  );

  return (
    <Modal open={open} title={title} onClose={onCancel}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!motifOk) return;
          onConfirm(motifEnvoye);
        }}
      >
        {error && <AlertBar variant="err">{error}</AlertBar>}
        {typeof children === 'string' ? (
          <Text variant="body">{children}</Text>
        ) : (
          children
        )}
        {motif && choix && (
          <>
            <FormField
              label={`${motif.label} (facultatif)`}
              htmlFor={`${id}-motif`}
            >
              <Combobox
                id={`${id}-motif`}
                icon={null}
                searchable={false}
                placeholder="Choisir un motif"
                options={choix.options.map((o) => ({ value: o, label: o }))}
                value={choixMotif}
                onChange={(v) => {
                  setChoixMotif(v);
                  if (v !== choix.autre) setValeurMotif('');
                }}
                data-testid="motif-choix"
              />
            </FormField>
            {autre && (
              <FormField
                label="Précisez le motif"
                htmlFor={`${id}-motif-precision`}
              >
                {champTexte}
              </FormField>
            )}
          </>
        )}
        {motif && !choix && (
          <FormField
            label={
              minLength > 0
                ? `${motif.label} (≥ ${minLength} caractères)`
                : `${motif.label} (facultatif)`
            }
            htmlFor={`${id}-motif`}
            required={minLength > 0}
          >
            {champTexte}
          </FormField>
        )}
        <FormActions
          bordered
          loading={loading}
          loadingText={loadingText}
          cancel={{ label: cancelLabel, onClick: onCancel }}
          submit={{
            label: confirmLabel,
            variant: variant === 'destructive' ? 'destructive' : 'primary',
            disabled: !motifOk,
          }}
        />
      </form>
    </Modal>
  );
}

// useConfirm — confirmation impérative, à la place de `window.confirm` :
//   const { confirmer, dialogue } = useConfirm();
//   if (!(await confirmer({ title: 'Supprimer ?', confirmLabel: 'Supprimer' }))) return;
//   … et `{dialogue}` rendu une fois dans le JSX du composant.
// Résout `true` à la confirmation, `false` à l'annulation / fermeture.
// Contrainte : `Modal` n'est pas rendu dans un portal et `ConfirmDialog` porte
// un `<form>` — rendre `{dialogue}` (ou `<ConfirmDialog>`) HORS de tout `<form>`
// parent, sinon la confirmation soumettrait aussi le formulaire englobant.
type ConfirmOptions = Omit<
  ConfirmDialogProps,
  'open' | 'onConfirm' | 'onCancel' | 'loading' | 'loadingText' | 'error'
>;

export function useConfirm(): {
  confirmer: (options: ConfirmOptions) => Promise<boolean>;
  dialogue: React.ReactElement | null;
} {
  const [etat, setEtat] = React.useState<{
    options: ConfirmOptions;
    resolve: (ok: boolean) => void;
  } | null>(null);

  // Un nouvel appel pendant qu'une modale est ouverte (double clic) résout la
  // précédente à `false` ; au démontage, la promesse en attente est résolue à
  // `false` — jamais de promesse pendante (revue sécurité R-UI-3).
  const confirmer = React.useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) =>
        setEtat((prev) => {
          prev?.resolve(false);
          return { options, resolve };
        }),
      ),
    [],
  );
  const etatRef = React.useRef(etat);
  etatRef.current = etat;
  React.useEffect(() => () => etatRef.current?.resolve(false), []);

  const fermer = (ok: boolean) => {
    etat?.resolve(ok);
    setEtat(null);
  };

  const dialogue = etat ? (
    <ConfirmDialog
      {...etat.options}
      open
      onConfirm={() => fermer(true)}
      onCancel={() => fermer(false)}
    />
  ) : null;

  return { confirmer, dialogue };
}
