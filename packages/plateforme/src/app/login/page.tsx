'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { safeNextPath } from '@/lib/safe-next-path';
import { AlertBar } from '@/components/ui/alert-bar';

// Motifs posés par `api/auth/verify-email` quand le lien d'activation n'aboutit
// pas. Ils arrivaient déjà en `?error=` mais n'étaient affichés nulle part :
// l'utilisateur voyait un écran de connexion muet (revue go-live 2026-09-23).
//
// ⚠ `Map` et non objet littéral : un objet rend AUSSI les clés héritées
// d'`Object.prototype`. Avec un objet, `/login?error=__proto__` rendait un objet
// là où React attend du texte et FAISAIT PLANTER la page de connexion — par
// simple lien forgé, et sans `error.tsx` pour amortir. `toString`, `valueOf` &
// consorts rendaient une fonction ou passaient en silence. Un `Map` n'a pas de
// clés héritées : seul ce qui est posé ici peut sortir.
const MESSAGES_ERREUR = new Map<string, string>([
  [
    'lien_invalide',
    "Ce lien de vérification est incomplet ou a déjà servi. Écrivez-nous à hello@gosavr.io si vous n'arrivez pas à activer votre compte.",
  ],
  [
    'verification_echouee',
    "Ce lien de vérification a expiré ou a déjà été utilisé. Écrivez-nous à hello@gosavr.io pour recevoir un nouveau lien d'activation.",
  ],
]);

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // `?error=` : motif d'un lien d'activation qui n'a pas abouti. Lu dans une
  // table fermée — un motif inconnu (URL forgée) n'affiche rien plutôt que
  // d'imprimer le paramètre tel quel.
  const messageLien = MESSAGES_ERREUR.get(searchParams.get('error') ?? '');
  // Pas de `next` (login direct) → `/` qui redirige vers l'espace du rôle
  // (page.tsx / HOME_BY_ROLE). Surtout pas `/admin/dashboard` en dur, sinon
  // tous les rôles atterrissent sur le back-office Admin. Validé : un `next`
  // externe (lien forgé) retombe sur `/` (open redirect, cf. safeNextPath).
  const next = safeNextPath(searchParams.get('next'));

  const [email, setEmail] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [erreur, setErreur] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErreur('');

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, mot_de_passe: motDePasse }),
    });

    if (res.ok) {
      router.push(next);
      router.refresh();
    } else {
      const data = (await res.json()) as { error?: string };
      setErreur(data.error ?? 'Identifiants incorrects');
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-sm bg-savr-white rounded-savr-lg border border-savr-neutral-200 p-8 shadow-sm">
      <h1 className="text-xl font-semibold text-savr-neutral-900 mb-6">
        Connexion Savr
      </h1>
      {messageLien && (
        <AlertBar variant="warn" className="mb-4 font-normal">
          {messageLien}
        </AlertBar>
      )}
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <div className="space-y-1">
          <label className="text-sm font-medium text-savr-neutral-700">
            Email
          </label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-savr-md border border-savr-neutral-300 px-3 py-2 text-sm focus:outline-2 focus:outline-savr-primary-500"
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium text-savr-neutral-700">
            Mot de passe
          </label>
          <input
            type="password"
            required
            value={motDePasse}
            onChange={(e) => setMotDePasse(e.target.value)}
            className="w-full rounded-savr-md border border-savr-neutral-300 px-3 py-2 text-sm focus:outline-2 focus:outline-savr-primary-500"
          />
        </div>
        {erreur && <p className="text-sm text-savr-error">{erreur}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-savr-md bg-savr-primary-700 text-savr-white py-2 text-sm font-medium hover:bg-savr-primary-800 disabled:opacity-50"
        >
          {loading ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>
      <div className="mt-6 space-y-2 text-sm">
        <Link
          href="/reset-password"
          className="block font-semibold text-savr-primary-700 underline-offset-4 hover:underline"
        >
          Mot de passe oublié ?
        </Link>
        {/* Sans ce lien, /signup n'était atteignable qu'en tapant l'URL. */}
        <Link
          href="/signup"
          className="block font-semibold text-savr-primary-700 underline-offset-4 hover:underline"
        >
          Créer un compte
        </Link>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-savr-neutral-50">
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
