'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function AcceptInvitationForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tokenHash = searchParams.get('token_hash') ?? '';

  const [prenom, setPrenom] = useState('');
  const [nom, setNom] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [cgu, setCgu] = useState(false);
  const [erreur, setErreur] = useState('');
  const [loading, setLoading] = useState(false);
  const [succes, setSucces] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErreur('');

    const res = await fetch('/api/auth/accept-invitation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token_hash: tokenHash,
        prenom,
        nom,
        mot_de_passe: motDePasse,
        acceptation_cgu: cgu,
      }),
    });

    if (res.ok) {
      setSucces(true);
      setLoading(false);
    } else {
      const data = (await res.json()) as { error?: string };
      setErreur(data.error ?? 'Impossible de finaliser le compte.');
      setLoading(false);
    }
  }

  if (!tokenHash) {
    return (
      <div className="w-full max-w-sm bg-savr-white rounded-savr-lg border border-savr-neutral-200 p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-savr-neutral-900 mb-2">
          Lien invalide
        </h1>
        <p className="text-sm text-savr-neutral-600">
          Ce lien d&apos;invitation est invalide ou incomplet. Demandez une
          nouvelle invitation à votre organisation.
        </p>
      </div>
    );
  }

  if (succes) {
    return (
      <div className="w-full max-w-sm bg-savr-white rounded-savr-lg border border-savr-neutral-200 p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-savr-neutral-900 mb-2">
          Compte créé
        </h1>
        <p className="text-sm text-savr-neutral-600 mb-6">
          Votre compte est prêt. Vous pouvez maintenant vous connecter.
        </p>
        <button
          onClick={() => router.push('/login')}
          className="w-full rounded-savr-md bg-savr-primary-700 text-savr-white py-2 text-sm font-medium hover:bg-savr-primary-800"
        >
          Se connecter
        </button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm bg-savr-white rounded-savr-lg border border-savr-neutral-200 p-8 shadow-sm">
      <h1 className="text-xl font-semibold text-savr-neutral-900 mb-1">
        Finaliser votre compte
      </h1>
      <p className="text-sm text-savr-neutral-600 mb-6">
        Vous avez été invité à rejoindre votre organisation sur Savr. Complétez
        vos informations pour activer votre compte.
      </p>
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <div className="space-y-1">
          <label className="text-sm font-medium text-savr-neutral-700">
            Prénom
          </label>
          <input
            type="text"
            required
            value={prenom}
            onChange={(e) => setPrenom(e.target.value)}
            className="w-full rounded-savr-md border border-savr-neutral-300 px-3 py-2 text-sm focus:outline-2 focus:outline-savr-primary-500"
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium text-savr-neutral-700">
            Nom
          </label>
          <input
            type="text"
            required
            value={nom}
            onChange={(e) => setNom(e.target.value)}
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
          <p className="text-xs text-savr-neutral-500">
            10 caractères minimum, avec majuscule, chiffre et caractère spécial.
          </p>
        </div>
        <label className="flex items-start gap-2 text-sm text-savr-neutral-700">
          <input
            type="checkbox"
            required
            checked={cgu}
            onChange={(e) => setCgu(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            J&apos;accepte les conditions générales d&apos;utilisation de Savr.
          </span>
        </label>
        {erreur && <p className="text-sm text-savr-error">{erreur}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-savr-md bg-savr-primary-700 text-savr-white py-2 text-sm font-medium hover:bg-savr-primary-800 disabled:opacity-50"
        >
          {loading ? 'Création…' : 'Activer mon compte'}
        </button>
      </form>
    </div>
  );
}

export default function AcceptInvitationPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-savr-neutral-50 p-4">
      <Suspense>
        <AcceptInvitationForm />
      </Suspense>
    </div>
  );
}
