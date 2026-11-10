'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { AuthCard } from '@/components/auth/auth-card';
import { AlertBar } from '@/components/ui/alert-bar';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { LoadingState } from '@/components/ui/loading-state';
import { Text } from '@/components/ui/text';
import { TextLink } from '@/components/ui/text-link';
import { ROUTES } from '@/lib/routes';

// Formulaire de l'écran du code de vérification (page.tsx) :
//  • `activation` : QR code (et clé) à ajouter dans l'application
//    d'authentification, puis premier code pour confirmer ;
//  • `saisie` : code du moment.
// Tous les contrôles sont faits par les routes `api/auth/code-verification/*`.

export type ModeCodeVerification = 'activation' | 'saisie';

interface Activation {
  factor_id: string;
  qr_code: string;
  secret: string;
}

const ERREUR_RESEAU = 'Vérification impossible. Vérifiez votre connexion.';

// Clé lisible à recopier : groupes de 4 caractères.
function grouper(secret: string): string {
  return secret.replace(/(.{4})/g, '$1 ').trim();
}

export function FormulaireCodeVerification({
  mode,
  suite,
  equipeSavr,
}: {
  mode: ModeCodeVerification;
  suite: string;
  /** Équipe Savr : un autre administrateur réinitialise le code ; sinon l'équipe Savr. */
  equipeSavr: boolean;
}) {
  const router = useRouter();
  const [activation, setActivation] = useState<Activation | null>(null);
  const [erreurActivation, setErreurActivation] = useState('');
  const [essaiActivation, setEssaiActivation] = useState(0);
  const [code, setCode] = useState('');
  const [erreur, setErreur] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (mode !== 'activation') return;
    let annule = false;
    setErreurActivation('');
    void (async () => {
      try {
        const res = await fetch('/api/auth/code-verification/activation', {
          method: 'POST',
        });
        const data = (await res.json().catch(() => ({}))) as Partial<
          Activation & { error: string }
        >;
        if (annule) return;
        if (res.ok && data.factor_id && data.qr_code && data.secret) {
          setActivation(data as Activation);
        } else if (res.status === 409) {
          // Code activé entre-temps (autre onglet) : l'écran de saisie s'affiche.
          router.refresh();
        } else {
          setErreurActivation(
            data.error ??
              'Activation impossible pour le moment. Réessayez dans un instant.',
          );
        }
      } catch {
        if (!annule) setErreurActivation(ERREUR_RESEAU);
      }
    })();
    return () => {
      annule = true;
    };
  }, [mode, essaiActivation, router]);

  async function valider(e: React.FormEvent) {
    e.preventDefault();
    setErreur('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/code-verification/verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, factor_id: activation?.factor_id }),
      });
      if (res.ok) {
        // Le bouton reste en chargement jusqu'à l'arrivée sur la page demandée.
        router.push(suite);
        router.refresh();
        return;
      }
      if (res.status === 401) {
        router.push(ROUTES.login);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErreur(data.error ?? ERREUR_RESEAU);
      setLoading(false);
    } catch {
      setErreur(ERREUR_RESEAU);
      setLoading(false);
    }
  }

  async function seDeconnecter() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    router.push(ROUTES.login);
    router.refresh();
  }

  const champCode = (
    <FormField
      label="Code à 6 chiffres"
      htmlFor="code-verification"
      hint={
        mode === 'saisie'
          ? equipeSavr
            ? 'Téléphone perdu ou changé ? Demandez à un autre administrateur Savr de réinitialiser votre code.'
            : 'Téléphone perdu ou changé ? Demandez à l’équipe Savr de réinitialiser votre code.'
          : undefined
      }
    >
      <Input
        id="code-verification"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        required
        maxLength={7}
        autoFocus={mode === 'saisie'}
        value={code}
        onChange={(e) => setCode(e.target.value)}
      />
    </FormField>
  );

  const deconnexion = (
    <TextLink
      strong
      touch
      className="text-sm"
      onClick={() => void seDeconnecter()}
    >
      Se déconnecter
    </TextLink>
  );

  if (mode === 'saisie') {
    return (
      <AuthCard
        titre="Code de vérification"
        description="Saisissez le code à 6 chiffres affiché par votre application d’authentification."
        onSubmit={(e) => void valider(e)}
        pied={
          <Button
            type="submit"
            className="w-full"
            loading={loading}
            loadingText="Vérification…"
          >
            Valider
          </Button>
        }
        sousCarte={deconnexion}
      >
        {champCode}
        <FormError>{erreur}</FormError>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      titre="Activez votre code de vérification"
      description={
        equipeSavr
          ? 'Les comptes de l’équipe Savr sont protégés par un code à 6 chiffres, demandé à chaque nouvelle connexion.'
          : 'Votre compte est protégé par un code à 6 chiffres, demandé à chaque nouvelle connexion.'
      }
      onSubmit={activation ? (e) => void valider(e) : undefined}
      pied={
        activation ? (
          <Button
            type="submit"
            className="w-full"
            loading={loading}
            loadingText="Vérification…"
          >
            Activer le code
          </Button>
        ) : undefined
      }
      sousCarte={deconnexion}
    >
      {erreurActivation ? (
        <div className="space-y-3">
          <AlertBar variant="err">{erreurActivation}</AlertBar>
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => setEssaiActivation((n) => n + 1)}
          >
            Réessayer
          </Button>
        </div>
      ) : !activation ? (
        <LoadingState label="Préparation du QR code…" />
      ) : (
        <>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-savr-neutral-700">
            <li>
              Installez sur votre téléphone une application d’authentification
              (Google Authenticator, Microsoft Authenticator…).
            </li>
            <li>Dans l’application, scannez le QR code ci-dessous.</li>
            <li>Saisissez le code à 6 chiffres affiché par l’application.</li>
          </ol>
          <div className="flex justify-center">
            <img
              src={activation.qr_code}
              alt="QR code à scanner avec votre application d’authentification"
              width={192}
              height={192}
              className="rounded-savr-md border border-savr-neutral-200 bg-savr-white p-2"
            />
          </div>
          <div className="space-y-1 text-center">
            <Text variant="hint">
              Impossible de scanner ? Saisissez cette clé dans l’application :
            </Text>
            <p className="break-all font-mono text-sm font-semibold text-savr-neutral-900">
              {grouper(activation.secret)}
            </p>
          </div>
          {champCode}
          <FormError>{erreur}</FormError>
        </>
      )}
    </AuthCard>
  );
}
