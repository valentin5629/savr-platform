'use client';

// /reset-password/confirm — saisie du nouveau mot de passe, une fois la session
// de récupération posée par `api/auth/reset-password/confirm` (échange du code
// PKCE du lien email). Sans cette session, `POST /api/auth/update-password`
// répond 401 : l'écran le dit et renvoie demander un nouveau lien, plutôt que de
// laisser l'utilisateur buter sur une erreur opaque.

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/ui/form-field';
import { FormError } from '@/components/ui/form-error';
import { AlertBar } from '@/components/ui/alert-bar';
import { AuthCard, AuthPage } from '@/components/auth/auth-card';
import { PASSWORD_MIN_LENGTH, validatePasswordStrength } from '@/lib/password';

export default function ResetPasswordConfirmPage() {
  const router = useRouter();

  const [motDePasse, setMotDePasse] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [erreur, setErreur] = useState('');
  const [sessionPerdue, setSessionPerdue] = useState(false);
  const [succes, setSucces] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErreur('');

    // Même politique que le serveur (§09 l.84-85) : vérifiée ici pour rendre la
    // règle immédiatement lisible, JAMAIS en remplacement du contrôle serveur
    // (`api/auth/update-password` la revalide avant tout appel GoTrue).
    const force = validatePasswordStrength(motDePasse);
    if (!force.ok) {
      setErreur(force.error);
      return;
    }
    if (motDePasse !== confirmation) {
      setErreur('Les deux mots de passe ne sont pas identiques.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/update-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mot_de_passe: motDePasse }),
      });

      if (res.ok) {
        setSucces(true);
        return;
      }

      if (res.status === 401) {
        setSessionPerdue(true);
        return;
      }

      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setErreur(
        data.error ?? 'Modification impossible. Réessayez dans un instant.',
      );
    } catch {
      setErreur('Modification impossible. Vérifiez votre connexion.');
    } finally {
      setLoading(false);
    }
  }

  if (succes) {
    return (
      <AuthPage>
        <AuthCard
          titre="Mot de passe modifié"
          description="Votre nouveau mot de passe est actif. Vous pouvez vous connecter."
          pied={
            <Button
              className="w-full"
              onClick={() => router.push('/login')}
              type="button"
            >
              Aller à la connexion
            </Button>
          }
        />
      </AuthPage>
    );
  }

  if (sessionPerdue) {
    return (
      <AuthPage>
        <AuthCard
          titre="Lien expiré"
          pied={
            <Button asChild className="w-full">
              <Link href="/reset-password">Demander un nouveau lien</Link>
            </Button>
          }
        >
          <AlertBar variant="warn" className="font-normal">
            Ce lien de réinitialisation n&apos;est plus valable — il expire au
            bout d&apos;une heure et ne sert qu&apos;une fois. Votre mot de
            passe n&apos;a pas été modifié.
          </AlertBar>
        </AuthCard>
      </AuthPage>
    );
  }

  return (
    <AuthPage>
      <AuthCard
        titre="Nouveau mot de passe"
        description={`Choisissez un mot de passe : au moins ${PASSWORD_MIN_LENGTH} caractères, avec une majuscule, un chiffre et un caractère spécial.`}
        onSubmit={(e) => void handleSubmit(e)}
        pied={
          <Button
            type="submit"
            className="w-full"
            loading={loading}
            loadingText="Enregistrement…"
          >
            Enregistrer le mot de passe
          </Button>
        }
      >
        <FormField label="Nouveau mot de passe" htmlFor="mot-de-passe" required>
          <Input
            id="mot-de-passe"
            name="mot-de-passe"
            type="password"
            autoComplete="new-password"
            required
            value={motDePasse}
            error={!!erreur}
            onChange={(e) => setMotDePasse(e.target.value)}
          />
        </FormField>

        <FormField label="Confirmation" htmlFor="confirmation" required>
          <Input
            id="confirmation"
            name="confirmation"
            type="password"
            autoComplete="new-password"
            required
            value={confirmation}
            error={!!erreur}
            onChange={(e) => setConfirmation(e.target.value)}
          />
        </FormField>

        <FormError>{erreur}</FormError>
      </AuthCard>
    </AuthPage>
  );
}
