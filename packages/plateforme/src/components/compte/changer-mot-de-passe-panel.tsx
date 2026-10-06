'use client';

import { useId, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { FormError } from '@/components/ui/form-error';
import { useToast } from '@/components/ui/toast';

// Panneau « Changer mon mot de passe » (transverse, tous rôles) — CDC §06.04 §7.
// Câble le changement de mot de passe IN-APP pour l'utilisateur connecté :
// POST /api/auth/update-password (session normale ; la politique §09 l.84-85 —
// 10 caractères + majuscule + chiffre + spécial — est vérifiée côté serveur par
// validatePasswordStrength, même helper que le signup). Remplace le lien inerte
// « <a href="/login"> » de la carte Sécurité (BL-P1-TRAIT-02).
export function ChangerMotDePassePanel(): React.JSX.Element {
  const idMotDePasse = useId();
  const idConfirmation = useId();
  const [motDePasse, setMotDePasse] = useState('');
  const [confirmation, setConfirmation] = useState('');
  // Succès = toast 4 s (R-UI-1 H1).
  const { toast } = useToast();
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function soumettre(e: React.FormEvent): Promise<void> {
    e.preventDefault();
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
        toast({ title: 'Mot de passe mis à jour.', variant: 'success' });
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
            <FormField label="Nouveau mot de passe" htmlFor={idMotDePasse}>
              <Input
                id={idMotDePasse}
                type="password"
                value={motDePasse}
                onChange={(e) => setMotDePasse(e.target.value)}
                autoComplete="new-password"
              />
            </FormField>
            <FormField label="Confirmation" htmlFor={idConfirmation}>
              <Input
                id={idConfirmation}
                type="password"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                autoComplete="new-password"
              />
            </FormField>
          </div>
          <Text variant="hint">
            Au moins 10 caractères, dont une majuscule, un chiffre et un
            caractère spécial.
          </Text>
          <div className="flex items-center gap-3">
            <Button
              type="submit"
              disabled={enCours || motDePasse === '' || confirmation === ''}
            >
              Mettre à jour
            </Button>
            <FormError>{erreur}</FormError>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
