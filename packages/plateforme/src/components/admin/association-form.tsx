'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { FormField } from '@/components/ui/form-field';
import {
  HorairesOuvertureEditor,
  horairesParDefaut,
  type JourHoraire,
} from '@/components/admin/horaires-ouverture-editor';

export interface AssociationFormValues {
  nom: string;
  adresse: string;
  region: 'idf' | 'province' | '';
  ville: string;
  contact_nom: string;
  contact_email: string;
  contact_telephone: string;
  capacite_max_beneficiaires: string;
  types_aliments_acceptes: string;
  description_rapport_impact: string;
  commentaires_internes: string;
  id_point_collecte_mts1: string;
  habilitee_attestation_fiscale: boolean;
  actif: boolean;
  horaires_ouverture: JourHoraire[];
}

const VIDE: AssociationFormValues = {
  nom: '',
  adresse: '',
  region: '',
  ville: '',
  contact_nom: '',
  contact_email: '',
  contact_telephone: '',
  capacite_max_beneficiaires: '',
  types_aliments_acceptes: '',
  description_rapport_impact: '',
  commentaires_internes: '',
  id_point_collecte_mts1: '',
  habilitee_attestation_fiscale: false,
  actif: true,
  horaires_ouverture: horairesParDefaut(),
};

interface AssociationFormProps {
  associationId?: string;
  initialValues?: Partial<AssociationFormValues>;
}

export function AssociationForm({
  associationId,
  initialValues,
}: AssociationFormProps) {
  const router = useRouter();
  const isEdition = Boolean(associationId);
  const [values, setValues] = React.useState<AssociationFormValues>({
    ...VIDE,
    ...initialValues,
  });
  const [submitting, setSubmitting] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [serverError, setServerError] = React.useState<string | null>(null);

  function set<K extends keyof AssociationFormValues>(
    key: K,
    value: AssociationFormValues[K],
  ) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!values.nom.trim()) next.nom = 'Nom obligatoire';
    if (!values.adresse.trim()) next.adresse = 'Adresse obligatoire';
    if (!values.region) next.region = 'Région obligatoire';
    if (!values.ville.trim()) next.ville = 'Ville obligatoire';
    if (!values.contact_nom.trim())
      next.contact_nom = 'Nom du contact obligatoire';
    if (!values.contact_telephone.trim())
      next.contact_telephone = 'Numéro de contact obligatoire';
    if (!values.contact_email.trim())
      next.contact_email = 'Email de contact obligatoire';
    if (!values.capacite_max_beneficiaires.trim())
      next.capacite_max_beneficiaires = 'Capacité max obligatoire';
    if (values.description_rapport_impact.trim().length < 30)
      next.description_rapport_impact =
        'Description du rapport d’impact : 30 caractères minimum';
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
      adresse: values.adresse.trim(),
      region: values.region,
      ville: values.ville.trim(),
      contact_nom: values.contact_nom.trim(),
      contact_email: values.contact_email.trim(),
      contact_telephone: values.contact_telephone.trim(),
      capacite_max_beneficiaires: values.capacite_max_beneficiaires
        ? parseInt(values.capacite_max_beneficiaires, 10)
        : null,
      types_aliments_acceptes: values.types_aliments_acceptes
        ? values.types_aliments_acceptes.split(',').map((t) => t.trim())
        : null,
      description_rapport_impact: values.description_rapport_impact.trim(),
      commentaires_internes: values.commentaires_internes.trim() || null,
      id_point_collecte_mts1: values.id_point_collecte_mts1.trim() || null,
      habilitee_attestation_fiscale: values.habilitee_attestation_fiscale,
      actif: values.actif,
      horaires_ouverture: values.horaires_ouverture,
    };

    const url = isEdition
      ? `/api/v1/admin/associations/${associationId}`
      : '/api/v1/admin/associations';
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
    router.push(`/admin/associations/${isEdition ? associationId : data.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      <Card className="p-6 space-y-4">
        <h2 className="font-semibold text-savr-neutral-800">Identité</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            label="Nom de l'association"
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
          <FormField
            label="Capacité max bénéficiaires (repas)"
            htmlFor="capacite_max_beneficiaires"
            required
            error={errors.capacite_max_beneficiaires}
            hint="Détermine le matching algo par taille d'événement"
          >
            <Input
              id="capacite_max_beneficiaires"
              type="number"
              min={0}
              value={values.capacite_max_beneficiaires}
              onChange={(e) =>
                set('capacite_max_beneficiaires', e.target.value)
              }
              error={Boolean(errors.capacite_max_beneficiaires)}
            />
          </FormField>
        </div>
      </Card>

      <Card className="p-6 space-y-4">
        <h2 className="font-semibold text-savr-neutral-800">Adresse</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormField
            label="Adresse"
            htmlFor="adresse"
            required
            error={errors.adresse}
            hint="Géocodée automatiquement à l'enregistrement"
            className="md:col-span-2"
          >
            <Input
              id="adresse"
              value={values.adresse}
              onChange={(e) => set('adresse', e.target.value)}
              error={Boolean(errors.adresse)}
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
          <FormField
            label="Région"
            htmlFor="region"
            required
            error={errors.region}
          >
            <Select
              id="region"
              value={values.region}
              onChange={(e) =>
                set('region', e.target.value as AssociationFormValues['region'])
              }
              error={Boolean(errors.region)}
            >
              <option value="">Sélectionner…</option>
              <option value="idf">Île-de-France</option>
              <option value="province">Province</option>
            </Select>
          </FormField>
        </div>
      </Card>

      <Card className="p-6 space-y-4">
        <h2 className="font-semibold text-savr-neutral-800">Contact</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormField
            label="Nom prénom du contact"
            htmlFor="contact_nom"
            required
            error={errors.contact_nom}
          >
            <Input
              id="contact_nom"
              value={values.contact_nom}
              onChange={(e) => set('contact_nom', e.target.value)}
              error={Boolean(errors.contact_nom)}
            />
          </FormField>
          <FormField
            label="Numéro de contact"
            htmlFor="contact_telephone"
            required
            error={errors.contact_telephone}
          >
            <Input
              id="contact_telephone"
              value={values.contact_telephone}
              onChange={(e) => set('contact_telephone', e.target.value)}
              error={Boolean(errors.contact_telephone)}
            />
          </FormField>
          <FormField
            label="Email(s) à prévenir en cas de collecte"
            htmlFor="contact_email"
            required
            error={errors.contact_email}
            hint="Plusieurs emails séparés par une virgule"
          >
            <Input
              id="contact_email"
              value={values.contact_email}
              onChange={(e) => set('contact_email', e.target.value)}
              error={Boolean(errors.contact_email)}
            />
          </FormField>
        </div>
      </Card>

      <Card className="p-6 space-y-4">
        <h2 className="font-semibold text-savr-neutral-800">
          Horaires d'ouverture
        </h2>
        <HorairesOuvertureEditor
          value={values.horaires_ouverture}
          onChange={(v) => set('horaires_ouverture', v)}
        />
      </Card>

      <Card className="p-6 space-y-4">
        <h2 className="font-semibold text-savr-neutral-800">
          Rapport d'impact
        </h2>
        <FormField
          label="Description pour le rapport d'impact (pour le client)"
          htmlFor="description_rapport_impact"
          required
          error={errors.description_rapport_impact}
          hint="Minimum 30 caractères, copiée dans le rapport AG"
        >
          <Textarea
            id="description_rapport_impact"
            rows={4}
            value={values.description_rapport_impact}
            onChange={(e) => set('description_rapport_impact', e.target.value)}
            error={Boolean(errors.description_rapport_impact)}
          />
        </FormField>
        <FormField
          label="Types d'aliments acceptés"
          htmlFor="types_aliments_acceptes"
          hint="Séparés par une virgule"
        >
          <Input
            id="types_aliments_acceptes"
            value={values.types_aliments_acceptes}
            onChange={(e) => set('types_aliments_acceptes', e.target.value)}
          />
        </FormField>
      </Card>

      <Card className="p-6 space-y-4">
        <h2 className="font-semibold text-savr-neutral-800">Admin / Ops</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            label="Id du point de collecte dans MTS-1"
            htmlFor="id_point_collecte_mts1"
            hint="V1 only — sert au pré-fill lors de l'envoi vers MTS-1"
          >
            <Input
              id="id_point_collecte_mts1"
              value={values.id_point_collecte_mts1}
              onChange={(e) => set('id_point_collecte_mts1', e.target.value)}
            />
          </FormField>
          <FormField
            label="Commentaire interne"
            htmlFor="commentaires_internes"
          >
            <Textarea
              id="commentaires_internes"
              rows={2}
              value={values.commentaires_internes}
              onChange={(e) => set('commentaires_internes', e.target.value)}
            />
          </FormField>
        </div>
        <div className="flex flex-wrap gap-6 pt-2">
          <label className="flex items-center gap-2 text-sm font-medium text-savr-neutral-700">
            <input
              type="checkbox"
              checked={values.habilitee_attestation_fiscale}
              onChange={(e) =>
                set('habilitee_attestation_fiscale', e.target.checked)
              }
              className="h-4 w-4 rounded border-savr-neutral-300 text-savr-primary-700 focus:outline-2 focus:outline-savr-primary-500"
            />
            Habilitation 2041-GE (attestation fiscale)
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-savr-neutral-700">
            <input
              type="checkbox"
              checked={values.actif}
              onChange={(e) => set('actif', e.target.checked)}
              className="h-4 w-4 rounded border-savr-neutral-300 text-savr-primary-700 focus:outline-2 focus:outline-savr-primary-500"
            />
            Active
          </label>
        </div>
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
              : 'Créer l’association'}
        </Button>
      </div>
    </form>
  );
}
