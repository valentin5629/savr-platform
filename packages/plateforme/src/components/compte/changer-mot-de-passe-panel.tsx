'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

// Panneau « Changer mon mot de passe » (transverse, tous rôles) — CDC §06.04 §7.
// Câble le changement de mot de passe IN-APP pour l'utilisateur connecté :
// POST /api/auth/update-password (session normale ; la politique §09 l.84-85 —
// 10 caractères + majuscule + chiffre + spécial — est vérifiée côté serveur par
// validatePasswordStrength, même helper que le signup). Remplace le lien inerte
// « <a href="/login"> » de la carte Sécurité (BL-P1-TRAIT-02).
export function ChangerMotDePassePanel(): React.JSX.Element {
  const [motDePasse, setMotDePasse] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function soumettre(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setMsg(null);
    setErreur(null);
    if (motDePasse !== confirmation) {
      setErreur('Les deux mots de passe ne correspondent pas.');
      return;
    }
    setEnCours(true);
    try {
      const res = await fetch('/api/auth/update-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mot_de_passe: motDePasse }),
      });
      if (res.ok) {
        setMsg('Mot de passe mis à jour.');
        setMotDePasse('');
        setConfirmation('');
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setErreur(body.error ?? 'Échec de la mise à jour du mot de passe.');
      }
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Changer mon mot de passe</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={soumettre} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-savr-neutral-500">
                Nouveau mot de passe
              </span>
              <input
                type="password"
                value={motDePasse}
                onChange={(e) => setMotDePasse(e.target.value)}
                autoComplete="new-password"
                className="mt-1 w-full rounded border border-savr-neutral-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="text-savr-neutral-500">Confirmation</span>
              <input
                type="password"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                autoComplete="new-password"
                className="mt-1 w-full rounded border border-savr-neutral-300 px-3 py-2 text-sm"
              />
            </label>
          </div>
          <p className="text-xs text-savr-neutral-500">
            Au moins 10 caractères, dont une majuscule, un chiffre et un
            caractère spécial.
          </p>
          <div className="flex items-center gap-3">
            <Button
              type="submit"
              disabled={enCours || motDePasse === '' || confirmation === ''}
            >
              Mettre à jour
            </Button>
            {msg && (
              <span className="text-xs text-savr-success-600">{msg}</span>
            )}
            {erreur && (
              <span className="text-xs text-savr-error-600">{erreur}</span>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
