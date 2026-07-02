'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { FormField } from '@/components/ui/form-field';

export interface LieuFormValues {
  nom: string;
  nom_alternatif: string;
  adresse_acces: string;
  code_postal: string;
  ville: string;
  acces_office: '' | 'facile' | 'difficile' | 'tres_difficile';
  stationnement: '' | 'facile' | 'difficile' | 'tres_difficile';
  type_vehicule_max:
    | ''
    | 'velo_cargo'
    | 'camionnette'
    | 'fourgon'
    | 'vul'
    | 'poids_lourd';
  controle_acces_requis_default: boolean;
  capacite_maximum: string;
  actif: boolean;
  // Gestionnaire rattaché (organisations_lieux) — organisation type gestionnaire_lieux
  gestionnaire_organisation_id: string;
  // Admin/ops only (RLS column-level)
  commentaire_lieu: string;
  siren: string;
  email_gestionnaire: string;
  reference_citeo: boolean;
}

const VIDE: LieuFormValues = {
  nom: '',
  nom_alternatif: '',
  adresse_acces: '',
  code_postal: '',
  ville: '',
  acces_office: '',
  stationnement: '',
  type_vehicule_max: '',
  controle_acces_requis_default: false,
  capacite_maximum: '',
  actif: true,
  gestionnaire_organisation_id: '',
  commentaire_lieu: '',
  siren: '',
  email_gestionnaire: '',
  reference_citeo: false,
};

interface OrgOption {
  id: string;
  raison_sociale: string | null;
  nom?: string | null;
}

interface LieuFormProps {
  lieuId?: string;
  initialValues?: Partial<LieuFormValues>;
}

export function LieuForm({ lieuId, initialValues }: LieuFormProps) {
  const router = useRouter();
  const isEdition = Boolean(lieuId);
  const [values, setValues] = React.useState<LieuFormValues>({
    ...VIDE,
    ...initialValues,
  });
  const [submitting, setSubmitting] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [gestionnaires, setGestionnaires] = React.useState<OrgOption[]>([]);

  // Liste des organisations gestionnaires de lieux (pour le sélecteur mono).
  React.useEffect(() => {
    void fetch('/api/v1/admin/organisations?type=gestionnaire_lieux&actif=true')
      .then((r) => r.json())
      .then((j: { data?: OrgOption[] }) => setGestionnaires(j.data ?? []))
      .catch(() => setGestionnaires([]));
  }, []);

  function set<K extends keyof LieuFormValues>(
    key: K,
    value: LieuFormValues[K],
  ) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!values.nom.trim()) next.nom = 'Nom obligatoire';
    if (!values.adresse_acces.trim())
      next.adresse_acces = 'Adresse accès livraison obligatoire';
    if (!values.code_postal.trim())
      next.code_postal = 'Code postal obligatoire';
    if (!values.ville.trim()) next.ville = 'Ville obligatoire';
    if (!values.type_vehicule_max)
      next.type_vehicule_max = 'Type de véhicule max obligatoire';
    if (values.siren.trim() !== '' && !/^\d{9}$/.test(values.siren.trim()))
      next.siren = 'SIREN : 9 chiffres';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);
    if (!validate()) return;

    setSubmitting(true);
    const payload = {
      nom: values.nom.trim(),
      nom_alternatif: values.nom_alternatif.trim() || null,
      adresse_acces: values.adresse_acces.trim(),
      code_postal: values.code_postal.trim(),
      ville: values.ville.trim(),
      acces_office: values.acces_office || null,
      stationnement: values.stationnement || null,
      type_vehicule_max: values.type_vehicule_max,
      controle_acces_requis_default: values.controle_acces_requis_default,
      capacite_maximum: values.capacite_maximum
        ? parseInt(values.capacite_maximum, 10)
        : null,
      actif: values.actif,
      gestionnaire_organisation_id: values.gestionnaire_organisation_id || '',
      commentaire_lieu: values.commentaire_lieu.trim() || null,
      siren: values.siren.trim() || null,
      email_gestionnaire: values.email_gestionnaire.trim() || null,
      reference_citeo: values.reference_citeo,
    };

    const url = isEdition
      ? `/api/v1/admin/lieux/${lieuId}`
      : '/api/v1/admin/lieux';
    const res = await fetch(url, {
      method: isEdition ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    setSubmitting(false);

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      setServerError(body?.error ?? 'Erreur lors de l’enregistrement');
      return;
    }

    const data = (await res.json()) as { id: string };
    router.push(`/admin/lieux/${isEdition ? lieuId : data.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      <Card className="p-6 space-y-4">
        <h2 className="font-semibold text-savr-neutral-800">Identité</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            label="Nom du lieu"
            htmlFor="nom"
            required
            error={errors.nom}
          >
            <Input
              id="nom"
              value={values.nom}
              onChange={(e) => set('nom', e.target.value)}
              error={Boolean(errors.nom)}
            />
          </FormField>
          <FormField label="Nom alternatif" htmlFor="nom_alternatif">
            <Input
              id="nom_alternatif"
              value={values.nom_alternatif}
              onChange={(e) => set('nom_alternatif', e.target.value)}
            />
          </FormField>
        </div>
        <FormField
          label="Gestionnaire de lieux"
          htmlFor="gestionnaire_organisation_id"
          hint="Organisation gestionnaire rattachée — optionnel"
        >
          <Select
            id="gestionnaire_organisation_id"
            value={values.gestionnaire_organisation_id}
            onChange={(e) =>
              set('gestionnaire_organisation_id', e.target.value)
            }
          >
            <option value="">Aucun</option>
            {gestionnaires.map((g) => (
              <option key={g.id} value={g.id}>
                {g.raison_sociale ?? g.nom ?? g.id}
              </option>
            ))}
          </Select>
        </FormField>
      </Card>

      <Card className="p-6 space-y-4">
        <h2 className="font-semibold text-savr-neutral-800">Adresse</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormField
            label="Adresse accès livraison"
            htmlFor="adresse_acces"
            required
            error={errors.adresse_acces}
            hint="Géocodée automatiquement à l'enregistrement"
            className="md:col-span-2"
          >
            <Input
              id="adresse_acces"
              value={values.adresse_acces}
              onChange={(e) => set('adresse_acces', e.target.value)}
              error={Boolean(errors.adresse_acces)}
            />
          </FormField>
          <FormField
            label="Code postal"
            htmlFor="code_postal"
            required
            error={errors.code_postal}
          >
            <Input
              id="code_postal"
              value={values.code_postal}
              onChange={(e) => set('code_postal', e.target.value)}
              error={Boolean(errors.code_postal)}
            />
          </FormField>
          <FormField
            label="Ville"
            htmlFor="ville"
            required
            error={errors.ville}
          >
            <Input
              id="ville"
              value={values.ville}
              onChange={(e) => set('ville', e.target.value)}
              error={Boolean(errors.ville)}
            />
          </FormField>
        </div>
      </Card>

      <Card className="p-6 space-y-4">
        <h2 className="font-semibold text-savr-neutral-800">
          Accès &amp; véhicule
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormField label="Accès office" htmlFor="acces_office">
            <Select
              id="acces_office"
              value={values.acces_office}
              onChange={(e) =>
                set(
                  'acces_office',
                  e.target.value as LieuFormValues['acces_office'],
                )
              }
            >
              <option value="">Non renseigné</option>
              <option value="facile">Facile</option>
              <option value="difficile">Difficile</option>
              <option value="tres_difficile">Très difficile</option>
            </Select>
          </FormField>
          <FormField label="Stationnement" htmlFor="stationnement">
            <Select
              id="stationnement"
              value={values.stationnement}
              onChange={(e) =>
                set(
                  'stationnement',
                  e.target.value as LieuFormValues['stationnement'],
                )
              }
            >
              <option value="">Non renseigné</option>
              <option value="facile">Facile</option>
              <option value="difficile">Difficile</option>
              <option value="tres_difficile">Très difficile</option>
            </Select>
          </FormField>
          <FormField
            label="Type de véhicule max"
            htmlFor="type_vehicule_max"
            required
            error={errors.type_vehicule_max}
            hint="Tous les véhicules ≤ max sont acceptés"
          >
            <Select
              id="type_vehicule_max"
              value={values.type_vehicule_max}
              onChange={(e) =>
                set(
                  'type_vehicule_max',
                  e.target.value as LieuFormValues['type_vehicule_max'],
                )
              }
              error={Boolean(errors.type_vehicule_max)}
            >
              <option value="">Sélectionner…</option>
              <option value="velo_cargo">Vélo cargo</option>
              <option value="camionnette">Camionnette</option>
              <option value="fourgon">Fourgon</option>
              <option value="vul">VUL</option>
              <option value="poids_lourd">Poids lourd</option>
            </Select>
          </FormField>
          <FormField label="Capacité maximum" htmlFor="capacite_maximum">
            <Input
              id="capacite_maximum"
              type="number"
              min={0}
              value={values.capacite_maximum}
              onChange={(e) => set('capacite_maximum', e.target.value)}
            />
          </FormField>
        </div>

        <div className="flex flex-wrap gap-6 pt-2">
          <label className="flex items-center gap-2 text-sm font-medium text-savr-neutral-700">
            <input
              type="checkbox"
              checked={values.controle_acces_requis_default}
              onChange={(e) =>
                set('controle_acces_requis_default', e.target.checked)
              }
              className="h-4 w-4 rounded border-savr-neutral-300 text-savr-primary-700 focus:outline-2 focus:outline-savr-primary-500"
            />
            Contrôle d'accès requis (plaque + nom chauffeur)
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-savr-neutral-700">
            <input
              type="checkbox"
              checked={values.actif}
              onChange={(e) => set('actif', e.target.checked)}
              className="h-4 w-4 rounded border-savr-neutral-300 text-savr-primary-700 focus:outline-2 focus:outline-savr-primary-500"
            />
            Actif
          </label>
        </div>

        <FormField label="Commentaire sur le lieu" htmlFor="commentaire_lieu">
          <Textarea
            id="commentaire_lieu"
            rows={2}
            value={values.commentaire_lieu}
            onChange={(e) => set('commentaire_lieu', e.target.value)}
          />
        </FormField>
      </Card>

      <Card className="p-6 space-y-4">
        <h2 className="font-semibold text-savr-neutral-800">
          Admin / Ops
          <span className="ml-2 text-xs font-normal text-savr-neutral-500">
            (invisible côté traiteur, agence, gestionnaire, client organisateur)
          </span>
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            label="SIREN"
            htmlFor="siren"
            error={errors.siren}
            hint="9 chiffres, distinct du SIREN du gestionnaire"
          >
            <Input
              id="siren"
              value={values.siren}
              onChange={(e) => set('siren', e.target.value)}
              error={Boolean(errors.siren)}
            />
          </FormField>
          <FormField
            label="Mail gestionnaire du lieu"
            htmlFor="email_gestionnaire"
            hint="Référent — relances commerciales/opérationnelles internes"
          >
            <Input
              id="email_gestionnaire"
              value={values.email_gestionnaire}
              onChange={(e) => set('email_gestionnaire', e.target.value)}
            />
          </FormField>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium text-savr-neutral-700">
          <input
            type="checkbox"
            checked={values.reference_citeo}
            onChange={(e) => set('reference_citeo', e.target.checked)}
            className="h-4 w-4 rounded border-savr-neutral-300 text-savr-primary-700 focus:outline-2 focus:outline-savr-primary-500"
          />
          Référencé Citeo (REP emballages)
        </label>
      </Card>

      {serverError && (
        <p className="text-sm text-savr-error-strong">{serverError}</p>
      )}

      <div className="flex justify-end gap-3">
        <Button
          type="button"
          variant="secondary"
          onClick={() => router.back()}
          disabled={submitting}
        >
          Annuler
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting
            ? 'Enregistrement…'
            : isEdition
              ? 'Enregistrer'
              : 'Créer le lieu'}
        </Button>
      </div>
    </form>
  );
}
