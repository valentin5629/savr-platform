'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FormError } from '@/components/ui/form-error';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';

// « Informations légales » de SA propre organisation, partagé par les espaces
// clients. Raison sociale, SIRET et adresse modifiables par tous les rôles
// (décision Val 2026-09-28) ; nom, email et téléphone en lecture seule
// (modification via le support Savr). La route PATCH n'accepte que ces 3 champs.

export interface ProfilOrganisation {
  id: string;
  nom: string;
  raison_sociale: string | null;
  siret: string | null;
  adresse: string | null;
  email_principal: string | null;
  telephone: string | null;
  logo_url: string | null;
}

type ChampLegal = 'raison_sociale' | 'siret' | 'adresse';

const CHAMPS: { cle: ChampLegal; libelle: string; id: string }[] = [
  {
    cle: 'raison_sociale',
    libelle: 'Raison sociale',
    id: 'org-raison-sociale',
  },
  { cle: 'siret', libelle: 'SIRET', id: 'org-siret' },
  { cle: 'adresse', libelle: 'Adresse', id: 'org-adresse' },
];

const ERREUR_ENREGISTREMENT = 'Enregistrement impossible. Veuillez réessayer.';
const ERREUR_CHARGEMENT =
  'Impossible de charger ces informations. Veuillez réessayer.';

function valeursDe(p: ProfilOrganisation): Record<ChampLegal, string> {
  return {
    raison_sociale: p.raison_sociale ?? '',
    siret: p.siret ?? '',
    adresse: p.adresse ?? '',
  };
}

export function InfosLegalesCard({
  profil,
  urlProfil,
  onSaved,
}: {
  profil: ProfilOrganisation;
  urlProfil: string;
  onSaved: (p: ProfilOrganisation) => void;
}) {
  const [valeurs, setValeurs] = useState(() => valeursDe(profil));
  const [saving, setSaving] = useState(false);
  const [erreur, setErreur] = useState('');
  const [succes, setSucces] = useState('');

  // Réaligné sur les seules valeurs légales : un nouvel objet `profil` venu d'un
  // envoi de logo n'écrase pas une saisie en cours.
  const { raison_sociale, siret, adresse } = profil;
  useEffect(
    () =>
      setValeurs({
        raison_sociale: raison_sociale ?? '',
        siret: siret ?? '',
        adresse: adresse ?? '',
      }),
    [raison_sociale, siret, adresse],
  );

  const initiales = valeursDe(profil);
  const modifies = CHAMPS.filter(({ cle }) => valeurs[cle] !== initiales[cle]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErreur('');
    setSucces('');
    try {
      // Seuls les champs modifiés partent : pas d'audit pour une valeur inchangée.
      const patch = Object.fromEntries(
        modifies.map(({ cle }) => [cle, valeurs[cle]]),
      );
      const res = await fetch(urlProfil, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const j = (await res.json().catch(() => ({}))) as {
        data?: ProfilOrganisation;
        error?: string;
      };
      if (!res.ok || !j.data) throw new Error(j.error ?? ERREUR_ENREGISTREMENT);
      setSucces('Informations enregistrées.');
      // Valeurs nettoyées par le serveur (espaces retirés), même si inchangées.
      setValeurs(valeursDe(j.data));
      onSaved(j.data);
    } catch (err) {
      setErreur((err as Error).message || ERREUR_ENREGISTREMENT);
    } finally {
      setSaving(false);
    }
  }

  const lectureSeule = [
    ['Nom', profil.nom],
    ['Email', profil.email_principal],
    ['Téléphone', profil.telephone],
  ] as const;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Informations légales</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <form onSubmit={save} className="space-y-3 md:max-w-xl">
          {CHAMPS.map(({ cle, libelle, id }) => (
            <FormField key={cle} label={libelle} htmlFor={id}>
              <Input
                id={id}
                value={valeurs[cle]}
                maxLength={500}
                onChange={(e) => {
                  setValeurs((v) => ({ ...v, [cle]: e.target.value }));
                  setSucces('');
                  setErreur('');
                }}
              />
            </FormField>
          ))}
          <FormError>{erreur}</FormError>
          {succes && (
            <p role="status" className="text-sm text-savr-success-strong">
              {succes}
            </p>
          )}
          <Button type="submit" disabled={saving || modifies.length === 0}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </form>
        <div className="space-y-2">
          <dl className="grid grid-cols-1 gap-4 text-sm md:grid-cols-3">
            {lectureSeule.map(([libelle, valeur]) => (
              <div key={libelle}>
                <dt className="font-semibold text-savr-neutral-700">
                  {libelle}
                </dt>
                <dd className="text-savr-neutral-900">{valeur ?? '—'}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-savr-neutral-500">
            Nom, email et téléphone : modification via le support Savr.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// Variante autonome : charge le profil puis affiche la carte (espaces agence et
// client organisateur, sans autre bloc dépendant du profil).
export function InfosLegalesOrganisation({ urlProfil }: { urlProfil: string }) {
  const [profil, setProfil] = useState<ProfilOrganisation | null>(null);
  const [erreur, setErreur] = useState('');

  useEffect(() => {
    let actif = true;
    fetch(urlProfil)
      .then(async (res) => {
        const j = (await res.json().catch(() => ({}))) as {
          data?: ProfilOrganisation;
        };
        if (!res.ok || !j.data) throw new Error();
        if (actif) setProfil(j.data);
      })
      .catch(() => {
        if (actif) setErreur(ERREUR_CHARGEMENT);
      });
    return () => {
      actif = false;
    };
  }, [urlProfil]);

  if (erreur)
    return (
      <Card>
        <CardContent className="py-4">
          <FormError>{erreur}</FormError>
        </CardContent>
      </Card>
    );
  if (!profil)
    return (
      <Card>
        <CardContent className="py-4 text-sm text-savr-neutral-500">
          Chargement…
        </CardContent>
      </Card>
    );
  return (
    <InfosLegalesCard
      profil={profil}
      urlProfil={urlProfil}
      onSaved={setProfil}
    />
  );
}
