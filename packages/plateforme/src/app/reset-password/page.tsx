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
      <div className="w-full max-w-sm rounded-savr-lg border border-savr-neutral-200 bg-savr-white p-8 shadow-sm">
        <h1 className="mb-4 text-xl font-semibold text-savr-neutral-900">
          Vérifiez votre boîte mail
        </h1>
        <p className="text-sm text-savr-neutral-700">
          Si un compte Savr existe pour <strong>{email}</strong>, un lien de
          réinitialisation vient d&apos;être envoyé. Il est valide pendant
          1&nbsp;heure.
        </p>
        <p className="mt-4 text-sm text-savr-neutral-500">
          Ouvrez le lien dans ce navigateur : c&apos;est ici que la demande a
          été faite.
        </p>
        <div className="mt-6">
          <Link
            href="/login"
            className="text-sm font-semibold text-savr-primary-700 underline-offset-4 hover:underline"
          >
            Retour à la connexion
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm rounded-savr-lg border border-savr-neutral-200 bg-savr-white p-8 shadow-sm">
      <h1 className="mb-2 text-xl font-semibold text-savr-neutral-900">
        Mot de passe oublié
      </h1>
      <p className="mb-6 text-sm text-savr-neutral-600">
        Indiquez votre adresse email : nous vous envoyons un lien pour choisir
        un nouveau mot de passe.
      </p>

      {lienInvalide && (
        <AlertBar variant="warn" className="mb-4 font-normal">
          Ce lien n&apos;est plus valable. Il expire au bout d&apos;une heure,
          ne sert qu&apos;une fois, et doit être ouvert dans le navigateur où la
          demande a été faite. Demandez-en un nouveau ci-dessous.
        </AlertBar>
      )}

      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <FormField label="Email" htmlFor="email" required>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            error={!!erreur}
            onChange={(e) => setEmail(e.target.value)}
          />
        </FormField>

        <FormError>{erreur}</FormError>

        <Button type="submit" disabled={loading} className="w-full">
          {loading ? 'Envoi…' : 'Envoyer le lien'}
        </Button>
      </form>

      <div className="mt-6">
        <Link
          href="/login"
          className="text-sm font-semibold text-savr-primary-700 underline-offset-4 hover:underline"
        >
          Retour à la connexion
        </Link>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-savr-neutral-50 px-4">
      <Suspense>
        <DemandeResetForm />
      </Suspense>
    </div>
  );
}
