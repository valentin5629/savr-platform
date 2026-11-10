'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { LockSimpleIcon } from '@/components/ui/icones';
import { SectionHeader } from '@/components/ui/section-header';
import { Text } from '@/components/ui/text';

// Code de vérification exigé des utilisateurs de l'organisation
// (lib/code-verification.ts ; VIPARIS, décision Val 2026-11-10, à la place du
// SAML). L'Admin seul le change ; l'Ops le lit. La route PATCH de
// l'organisation refuse aussi tout autre rôle et trace le changement.

interface Props {
  organisationId: string;
  exige: boolean;
  /** admin_savr seul. */
  peutModifier: boolean;
  onChange: () => void;
}

export function CarteCodeVerification({
  organisationId,
  exige,
  peutModifier,
  onChange,
}: Props) {
  const [ouvert, setOuvert] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function confirmer() {
    setEnCours(true);
    setErreur(null);
    try {
      const r = await fetch(
        `/api/v1/admin/organisations/${encodeURIComponent(organisationId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code_verification_obligatoire: !exige }),
        },
      );
      if (!r.ok) {
        const data = (await r.json().catch(() => null)) as {
          error?: string;
        } | null;
        setErreur(data?.error ?? 'Enregistrement impossible.');
        return;
      }
      setOuvert(false);
      onChange();
    } catch {
      setErreur('Connexion impossible, réessayez.');
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Card padding="lg" className="space-y-4">
      <SectionHeader
        icon={LockSimpleIcon}
        title="Code de vérification"
        action={
          peutModifier ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setErreur(null);
                setOuvert(true);
              }}
            >
              {exige ? 'Ne plus l’exiger' : 'Exiger'}
            </Button>
          ) : undefined
        }
      />
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={exige ? 'success' : 'neutral'}>
          {exige ? 'Exigé' : 'Non exigé'}
        </Badge>
        <Text as="span">
          {exige
            ? 'Chaque utilisateur saisit, à chaque nouvelle connexion, un code à 6 chiffres donné par une application d’authentification.'
            : 'Les utilisateurs se connectent avec leur seul mot de passe.'}
        </Text>
      </div>

      <ConfirmDialog
        open={ouvert}
        title={
          exige
            ? 'Ne plus exiger le code de vérification'
            : 'Exiger le code de vérification'
        }
        confirmLabel={exige ? 'Ne plus l’exiger' : 'Exiger'}
        cancelLabel="Annuler"
        variant={exige ? 'destructive' : 'primary'}
        loading={enCours}
        loadingText="Enregistrement…"
        error={erreur}
        onConfirm={() => void confirmer()}
        onCancel={() => setOuvert(false)}
      >
        {exige
          ? 'Le code ne sera plus demandé à leurs prochaines connexions. Les codes déjà activés restent enregistrés sur leurs comptes.'
          : 'À leur prochaine connexion, et dans l’heure pour ceux déjà connectés, tous les utilisateurs de ce client devront activer un code en scannant un QR code avec leur téléphone, puis le saisir à chaque nouvelle connexion.'}
      </ConfirmDialog>
    </Card>
  );
}
