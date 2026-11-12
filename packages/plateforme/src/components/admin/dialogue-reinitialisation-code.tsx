'use client';

import { useState } from 'react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';

// Réinitialisation du code de vérification d'un utilisateur (téléphone perdu ou
// changé) : DELETE /api/v1/admin/users/[id]/code-verification (admin_savr seul,
// lib/code-verification.ts). Utilisée par la page « Utilisateurs Savr » et par
// la fiche d'un client qui exige le code.

export interface UtilisateurAReinitialiser {
  id: string;
  prenom: string;
  nom: string;
}

export function DialogueReinitialisationCode({
  utilisateur,
  onFermer,
}: {
  /** null : fenêtre fermée. */
  utilisateur: UtilisateurAReinitialiser | null;
  onFermer: () => void;
}) {
  const { toast } = useToast();
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function reinitialiser() {
    if (!utilisateur) return;
    setEnCours(true);
    setErreur(null);
    try {
      const res = await fetch(
        `/api/v1/admin/users/${encodeURIComponent(utilisateur.id)}/code-verification`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setErreur(data.error ?? 'Réinitialisation impossible.');
        return;
      }
      const { facteurs_retires } = (await res.json().catch(() => ({}))) as {
        facteurs_retires?: number;
      };
      toast(
        facteurs_retires === 0
          ? {
              title: `${utilisateur.prenom} ${utilisateur.nom} n’avait pas encore de code : son activation sera demandée à sa prochaine connexion.`,
              variant: 'info',
            }
          : {
              title: `Code de vérification de ${utilisateur.prenom} ${utilisateur.nom} réinitialisé.`,
              variant: 'success',
            },
      );
      fermer();
    } catch {
      setErreur('Réinitialisation impossible. Vérifiez votre connexion.');
    } finally {
      setEnCours(false);
    }
  }

  function fermer() {
    setErreur(null);
    onFermer();
  }

  return (
    <ConfirmDialog
      open={utilisateur !== null}
      title="Réinitialiser le code de vérification"
      confirmLabel="Réinitialiser"
      cancelLabel="Annuler"
      variant="destructive"
      loading={enCours}
      loadingText="Réinitialisation…"
      error={erreur}
      onConfirm={() => void reinitialiser()}
      onCancel={fermer}
    >
      À sa prochaine connexion, {utilisateur?.prenom} {utilisateur?.nom} devra
      activer un nouveau code en scannant un QR code avec son téléphone. Ses
      connexions déjà ouvertes restent actives.
    </ConfirmDialog>
  );
}
