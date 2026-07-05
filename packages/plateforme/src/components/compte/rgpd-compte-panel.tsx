'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

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
  const [profilMsg, setProfilMsg] = useState<string | null>(null);
  const [suppressionMsg, setSuppressionMsg] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/me/profil');
        if (res.ok) {
          const { data } = await res.json();
          setPrenom(data?.prenom ?? '');
          setNom(data?.nom ?? '');
          setTelephone(data?.telephone ?? '');
        }
      } finally {
        setChargement(false);
      }
    })();
  }, []);

  async function enregistrerProfil(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setEnCours(true);
    setProfilMsg(null);
    try {
      const res = await fetch('/api/me/profil', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prenom, nom, telephone }),
      });
      setProfilMsg(
        res.ok ? 'Profil mis à jour.' : 'Échec de la mise à jour du profil.',
      );
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
              <label className="block text-sm">
                <span className="text-savr-neutral-500">Prénom</span>
                <input
                  value={prenom}
                  onChange={(e) => setPrenom(e.target.value)}
                  disabled={chargement}
                  className="mt-1 w-full rounded border border-savr-neutral-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-sm">
                <span className="text-savr-neutral-500">Nom</span>
                <input
                  value={nom}
                  onChange={(e) => setNom(e.target.value)}
                  disabled={chargement}
                  className="mt-1 w-full rounded border border-savr-neutral-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-sm">
                <span className="text-savr-neutral-500">Téléphone</span>
                <input
                  type="tel"
                  value={telephone}
                  onChange={(e) => setTelephone(e.target.value)}
                  disabled={chargement}
                  className="mt-1 w-full rounded border border-savr-neutral-300 px-3 py-2 text-sm"
                />
              </label>
            </div>
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={enCours || chargement}>
                Enregistrer
              </Button>
              {profilMsg && (
                <span className="text-xs text-savr-neutral-500">
                  {profilMsg}
                </span>
              )}
            </div>
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
