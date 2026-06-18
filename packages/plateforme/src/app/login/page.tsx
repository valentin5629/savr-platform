'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Pas de `next` (login direct) → `/` qui redirige vers l'espace du rôle
  // (page.tsx / HOME_BY_ROLE). Surtout pas `/admin/dashboard` en dur, sinon
  // tous les rôles atterrissent sur le back-office Admin.
  const next = searchParams.get('next') ?? '/';

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
