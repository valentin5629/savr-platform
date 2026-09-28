'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';

// Panneau « Mon compte » RGPD (transverse, tous rôles) — câble les droits :
//   · Art.16 Rectification  → PATCH /api/me/profil  (prénom / nom)
//   · Art.15/20 Accès/Porta → GET   /api/me/export-rgpd  (téléchargement JSON)
//   · Art.17 Suppression    → POST  /api/me/demande-suppression  (workflow Admin 48h)
// Remplace les boutons inertes des pages mon-profil (BL-P0-09 / OBS-04 / P2-27).
export function RgpdComptePanel(): React.JSX.Element {
  const [prenom, setPrenom] = useState('');
  const [nom, setNom] = useState('');
  const [telephone, setTelephone] = useState('');
  const [chargement, setChargement] = useState(true);
  // Chargement en échec : formulaire bloqué — l'enregistrer tel quel (vide)
  // effacerait le téléphone.
  const [chargementKo, setChargementKo] = useState(false);
  const [profilMsg, setProfilMsg] = useState<string | null>(null);
  const [profilErreur, setProfilErreur] = useState<string | null>(null);
  const [suppressionMsg, setSuppressionMsg] = useState<string | null>(null);
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
    setProfilMsg(null);
    setProfilErreur(null);
    try {
      const res = await fetch('/api/me/profil', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prenom, nom, telephone }),
      });
      if (res.ok) setProfilMsg('Profil mis à jour.');
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

  async function demanderSuppression(): Promise<void> {
    if (
      !window.confirm(
        'Demander la suppression de votre compte ? Un administrateur Savr ' +
          'traitera votre demande sous 48h ouvrées (anonymisation de vos ' +
          'données personnelles ; les pièces comptables légales sont conservées).',
      )
    ) {
      return;
    }
    setEnCours(true);
    setSuppressionMsg(null);
    try {
      const res = await fetch('/api/me/demande-suppression', {
        method: 'POST',
      });
      setSuppressionMsg(
        res.ok
          ? 'Demande enregistrée — en attente de validation Admin (48h ouvrées).'
          : 'Échec de l’enregistrement de la demande.',
      );
    } finally {
      setEnCours(false);
    }
  }

  return (
    <>
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
            {profilMsg && (
              <p role="status" className="text-sm text-savr-success-strong">
                {profilMsg}
              </p>
            )}
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
          <p className="text-xs text-savr-neutral-500">
            Téléchargez l’ensemble de vos données personnelles (droit d’accès et
            de portabilité).
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Suppression du compte</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button
            variant="destructive"
            onClick={demanderSuppression}
            disabled={enCours}
          >
            Demander la suppression de mon compte
          </Button>
          {suppressionMsg ? (
            <p className="text-xs text-savr-neutral-500">{suppressionMsg}</p>
          ) : (
            <p className="text-xs text-savr-neutral-500">
              Validation Admin sous 48h ouvrées, puis anonymisation des données
              personnelles. Les factures et bordereaux légaux sont conservés.
            </p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
