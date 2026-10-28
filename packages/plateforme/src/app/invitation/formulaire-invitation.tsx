'use client';

// Formulaire de la page /invitation : choix du mot de passe depuis l'email
// d'invitation. L'état du lien est déjà vérifié par la page (serveur) ; la route
// `POST /api/auth/invitation` le revérifie avant d'enregistrer quoi que ce soit.

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/ui/form-field';
import { FormError } from '@/components/ui/form-error';
import { AuthCard, AuthPage } from '@/components/auth/auth-card';
import { PASSWORD_MIN_LENGTH, validatePasswordStrength } from '@/lib/password';
import { ROUTES } from '@/lib/routes';
import { CarteLienInvitation } from './carte-lien-invitation';

type Motif = 'invalide' | 'expire' | 'utilise' | 'inactif';

export function FormulaireInvitation({
  jeton,
  prenom,
  email,
}: {
  jeton: string;
  prenom: string;
  email: string;
}) {
  const [motDePasse, setMotDePasse] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [erreur, setErreur] = useState('');
  const [motif, setMotif] = useState<Motif | null>(null);
  const [succes, setSucces] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErreur('');

    // Même politique que le serveur, vérifiée ici pour la rendre lisible tout de
    // suite ; la route la revalide.
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
      const res = await fetch('/api/auth/invitation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jeton, mot_de_passe: motDePasse }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        motif?: Motif;
      };
      if (res.ok) {
        setSucces(true);
        return;
      }
      if (data.motif) {
        setMotif(data.motif);
        return;
      }
      setErreur(
        data.error ?? 'Enregistrement impossible. Réessayez dans un instant.',
      );
    } catch {
      setErreur('Enregistrement impossible. Vérifiez votre connexion.');
    } finally {
      setLoading(false);
    }
  }

  if (motif) return <CarteLienInvitation motif={motif} />;

  if (succes) {
    return (
      <AuthPage>
        <AuthCard
          titre="Votre compte est prêt"
          description="Votre mot de passe est enregistré. Connectez-vous pour accéder à votre espace Savr."
          pied={
            <Button asChild className="w-full">
              <Link href={ROUTES.login}>Se connecter</Link>
            </Button>
          }
        />
      </AuthPage>
    );
  }

  return (
    <AuthPage>
      <AuthCard
        titre={prenom ? `Bienvenue, ${prenom}` : 'Bienvenue sur Savr'}
        description={`Choisissez le mot de passe de votre compte${email ? ` (${email})` : ''} : au moins ${PASSWORD_MIN_LENGTH} caractères, avec une majuscule, un chiffre et un caractère spécial.`}
        onSubmit={(e) => void handleSubmit(e)}
        pied={
          <Button
            type="submit"
            className="w-full"
            loading={loading}
            loadingText="Enregistrement…"
          >
            Enregistrer mon mot de passe
          </Button>
        }
      >
        <FormField label="Mot de passe" htmlFor="mot-de-passe" required>
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
