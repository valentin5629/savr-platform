'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertBar } from '@/components/ui/alert-bar';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';

// Panneau « Mon compte » RGPD (transverse, tous rôles) — câble les droits :
//   · Art.16 Rectification  → PATCH /api/me/profil  (prénom / nom)
//   · Art.15/20 Accès/Porta → GET   /api/me/export-rgpd  (téléchargement JSON)
//   · Art.17 Suppression    → POST  /api/me/demande-suppression  (workflow Admin 48h)
// Remplace les boutons inertes des pages mon-profil (BL-P0-09 / OBS-04 / P2-27).
// `avecSuppression=false` : pas de demande de suppression de compte (profil staff —
// décision Val 2026-09-28 : un compte Admin ne se supprime pas en self-service).
export function RgpdComptePanel({
  avecSuppression = true,
}: { avecSuppression?: boolean } = {}): React.JSX.Element {
  const [prenom, setPrenom] = useState('');
  const [nom, setNom] = useState('');
  const [telephone, setTelephone] = useState('');
  const [chargement, setChargement] = useState(true);
  // Chargement en échec : formulaire bloqué — l'enregistrer tel quel (vide)
  // effacerait le téléphone.
  const [chargementKo, setChargementKo] = useState(false);
  const [profilErreur, setProfilErreur] = useState<string | null>(null);
  // Demande de suppression : statut persistant (validation Admin sous 48 h
  // ouvrées, §15) → bandeau, pas un toast éphémère (revue conformité #488).
  const [suppressionDemandee, setSuppressionDemandee] = useState(false);
  const [suppressionErreur, setSuppressionErreur] = useState<string | null>(
    null,
  );
  const { toast } = useToast();
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/me/profil');
        if (!res.ok) throw new Error();
        const { data } = await res.json();
        setPrenom(data?.prenom ?? '');
        setNom(data?.nom ?? '');
        setTelephone(data?.telephone ?? '');
      } catch {
        setChargementKo(true);
        setProfilErreur(
          'Impossible de charger vos informations. Veuillez recharger la page.',
        );
      } finally {
        setChargement(false);
      }
    })();
  }, []);

  async function enregistrerProfil(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setEnCours(true);
    setProfilErreur(null);
    try {
      const res = await fetch('/api/me/profil', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prenom, nom, telephone }),
      });
      if (res.ok) toast({ title: 'Profil mis à jour.', variant: 'success' });
      else setProfilErreur('Échec de la mise à jour du profil.');
    } catch {
      setProfilErreur('Échec de la mise à jour du profil.');
    } finally {
      setEnCours(false);
    }
  }

  async function exporter(): Promise<void> {
    const res = await fetch('/api/me/export-rgpd');
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mes-donnees-savr.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  const { confirmer, dialogue } = useConfirm();
  async function demanderSuppression(): Promise<void> {
    if (
      !(await confirmer({
        title: 'Demander la suppression de votre compte ?',
        children:
          'Un administrateur Savr traitera votre demande sous 48h ouvrées (anonymisation de vos données personnelles ; les pièces comptables légales sont conservées).',
        confirmLabel: 'Demander la suppression',
        variant: 'destructive',
      }))
    ) {
      return;
    }
    setEnCours(true);
    setSuppressionErreur(null);
    try {
      const res = await fetch('/api/me/demande-suppression', {
        method: 'POST',
      });
      if (res.ok) setSuppressionDemandee(true);
      else setSuppressionErreur('Échec de l’enregistrement de la demande.');
    } finally {
      setEnCours(false);
    }
  }

  return (
    <>
      {dialogue}
      <Card>
        <CardHeader>
          <CardTitle>Informations personnelles</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={enregistrerProfil} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Prénom" htmlFor="profil-prenom">
                <Input
                  id="profil-prenom"
                  value={prenom}
                  autoComplete="given-name"
                  onChange={(e) => setPrenom(e.target.value)}
                  disabled={chargement || chargementKo}
                />
              </FormField>
              <FormField label="Nom" htmlFor="profil-nom">
                <Input
                  id="profil-nom"
                  value={nom}
                  autoComplete="family-name"
                  onChange={(e) => setNom(e.target.value)}
                  disabled={chargement || chargementKo}
                />
              </FormField>
              <FormField label="Téléphone" htmlFor="profil-telephone">
                <Input
                  id="profil-telephone"
                  type="tel"
                  value={telephone}
                  autoComplete="tel"
                  onChange={(e) => setTelephone(e.target.value)}
                  disabled={chargement || chargementKo}
                />
              </FormField>
            </div>
            <FormError>{profilErreur}</FormError>
            <Button
              type="submit"
              disabled={enCours || chargement || chargementKo}
            >
              Enregistrer
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Mes données (RGPD)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button variant="secondary" onClick={exporter}>
            Exporter mes données (JSON)
          </Button>
          <Text variant="hint">
            Téléchargez l’ensemble de vos données personnelles (droit d’accès et
            de portabilité).
          </Text>
        </CardContent>
      </Card>

      {avecSuppression && (
        <Card>
          <CardHeader>
            <CardTitle>Suppression du compte</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button
              variant="destructive"
              onClick={demanderSuppression}
              loading={enCours}
            >
              Demander la suppression de mon compte
            </Button>
            {suppressionDemandee && (
              <AlertBar variant="success">
                Demande enregistrée — en attente de validation Admin (48h
                ouvrées).
              </AlertBar>
            )}
            {suppressionErreur && (
              <AlertBar variant="err" role="alert">
                {suppressionErreur}
              </AlertBar>
            )}
            <Text variant="hint">
              Validation Admin sous 48h ouvrées, puis anonymisation des données
              personnelles. Les factures et bordereaux légaux sont conservés.
            </Text>
          </CardContent>
        </Card>
      )}
    </>
  );
}
