'use client';

// /reset-password — demande d'un lien de réinitialisation (CDC §09 §1 :
// « lien magique signé par Supabase », valide 1 h). Écran public : déclaré dans
// `PUBLIC_PREFIXES` du middleware, il n'existait pas jusqu'ici — le lien émis par
// `/api/auth/reset-password` tombait donc sur un 404.

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/ui/form-field';
import { FormError } from '@/components/ui/form-error';
import { AlertBar } from '@/components/ui/alert-bar';
import { AuthCard, AuthPage, authLienClass } from '@/components/auth/auth-card';

function DemandeResetForm() {
  const searchParams = useSearchParams();
  // Motif posé par la route d'échange quand le lien de l'email n'aboutit pas.
  const lienInvalide = searchParams.get('error') === 'lien_invalide';

  const [email, setEmail] = useState('');
  const [erreur, setErreur] = useState('');
  const [envoye, setEnvoye] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErreur('');

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      if (res.ok) {
        setEnvoye(true);
      } else {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setErreur(data.error ?? 'Envoi impossible. Réessayez dans un instant.');
      }
    } catch {
      setErreur('Envoi impossible. Vérifiez votre connexion.');
    } finally {
      setLoading(false);
    }
  }

  // Confirmation volontairement NEUTRE : la route répond 200 même si l'adresse
  // est inconnue (pas d'énumération de comptes) — l'écran ne doit pas trahir
  // l'information que la route protège.
  if (envoye) {
    return (
      <AuthCard
        titre="Vérifiez votre boîte mail"
        pied={
          <Link href="/login" className={authLienClass}>
            Retour à la connexion
          </Link>
        }
      >
        <p className="text-sm text-savr-neutral-700">
          Si un compte Savr existe pour <strong>{email}</strong>, un lien de
          réinitialisation vient d&apos;être envoyé. Il est valide pendant
          1&nbsp;heure.
        </p>
        <p className="text-sm text-savr-neutral-500">
          Ouvrez le lien dans ce navigateur : c&apos;est ici que la demande a
          été faite.
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      titre="Mot de passe oublié"
      description="Indiquez votre adresse email : nous vous envoyons un lien pour choisir un nouveau mot de passe."
      action={
        <Link href="/login" className={authLienClass}>
          Se connecter
        </Link>
      }
      onSubmit={(e) => void handleSubmit(e)}
      pied={
        <Button type="submit" disabled={loading} className="w-full">
          {loading ? 'Envoi…' : 'Envoyer le lien'}
        </Button>
      }
    >
      {lienInvalide && (
        <AlertBar variant="warn" className="font-normal">
          Ce lien n&apos;est plus valable. Il expire au bout d&apos;une heure,
          ne sert qu&apos;une fois, et doit être ouvert dans le navigateur où la
          demande a été faite. Demandez-en un nouveau ci-dessous.
        </AlertBar>
      )}

      <FormField label="Email" htmlFor="email" required>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="nom@entreprise.fr"
          value={email}
          error={!!erreur}
          onChange={(e) => setEmail(e.target.value)}
        />
      </FormField>

      <FormError>{erreur}</FormError>
    </AuthCard>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthPage>
      <Suspense>
        <DemandeResetForm />
      </Suspense>
    </AuthPage>
  );
}
