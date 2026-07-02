'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { FormField } from '@/components/ui/form-field';

export interface TransporteurFormValues {
  nom: string;
  siren: string;
  contact_nom: string;
  contact_telephone: string;
  contact_email: string;
  adresse: string;
  code_postal: string;
  ville: string;
  types_vehicules: string[];
  types_collecte: string[];
  type_tms: 'mts1' | 'a_toutes' | 'autre' | 'par_mail' | 'par_telephone' | '';
  description_process_collecte: string;
  code_transporteur_mts1: string;
  actif: boolean;
}

const TYPES_VEHICULES = [
  { value: 'velo_cargo', label: 'Vélo cargo' },
  { value: 'camionnette', label: 'Camionnette' },
  { value: 'fourgon', label: 'Fourgon' },
  { value: 'vul', label: 'VUL' },
  { value: 'poids_lourd', label: 'Poids lourd' },
] as const;

// Flux gérés — valeurs alignées sur collectes.type (multi, décision Val 2026-07-02).
const TYPES_COLLECTE = [
  { value: 'anti_gaspi', label: 'Anti-Gaspi (AG)' },
  { value: 'zero_dechet', label: 'Zéro Déchet (ZD)' },
] as const;

const VIDE: TransporteurFormValues = {
  nom: '',
  siren: '',
  contact_nom: '',
  contact_telephone: '',
  contact_email: '',
  adresse: '',
  code_postal: '',
  ville: '',
  types_vehicules: [],
  types_collecte: [],
  type_tms: '',
  description_process_collecte: '',
  code_transporteur_mts1: '',
  actif: true,
};

interface TransporteurFormProps {
  transporteurId?: string;
  initialValues?: Partial<TransporteurFormValues>;
}

export function TransporteurForm({
  transporteurId,
  initialValues,
}: TransporteurFormProps) {
  const router = useRouter();
  const isEdition = Boolean(transporteurId);
  const [values, setValues] = React.useState<TransporteurFormValues>({
    ...VIDE,
    ...initialValues,
  });
  const [submitting, setSubmitting] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [serverError, setServerError] = React.useState<string | null>(null);

  function set<K extends keyof TransporteurFormValues>(
    key: K,
    value: TransporteurFormValues[K],
  ) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function toggleTypeVehicule(value: string) {
    setValues((v) => ({
      ...v,
      types_vehicules: v.types_vehicules.includes(value)
        ? v.types_vehicules.filter((t) => t !== value)
        : [...v.types_vehicules, value],
    }));
  }

  function toggleTypeCollecte(value: string) {
    setValues((v) => ({
      ...v,
      types_collecte: v.types_collecte.includes(value)
        ? v.types_collecte.filter((t) => t !== value)
        : [...v.types_collecte, value],
    }));
  }

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!values.nom.trim()) next.nom = 'Nom obligatoire';
    if (!/^\d{9}$/.test(values.siren.trim())) next.siren = 'SIREN : 9 chiffres';
    if (!values.contact_nom.trim())
      next.contact_nom = 'Nom du contact obligatoire';
    if (!values.contact_telephone.trim())
      next.contact_telephone = 'Numéro de téléphone obligatoire';
    if (!values.contact_email.trim())
      next.contact_email = 'Email de contact obligatoire';
    if (!values.adresse.trim()) next.adresse = 'Adresse obligatoire';
    if (!values.code_postal.trim())
      next.code_postal = 'Code postal obligatoire';
    if (!values.ville.trim()) next.ville = 'Ville obligatoire';
    if (values.types_vehicules.length === 0)
      next.types_vehicules = 'Au moins un type de véhicule';
    if (!values.type_tms) next.type_tms = 'Type de TMS obligatoire';
    if (values.type_tms === 'mts1' && !values.code_transporteur_mts1.trim())
      next.code_transporteur_mts1 =
        'Code transporteur MTS-1 obligatoire pour type_tms = mts1';
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
      siren: values.siren.trim(),
      contact_nom: values.contact_nom.trim(),
      contact_telephone: values.contact_telephone.trim(),
      contact_email: values.contact_email.trim(),
      adresse: values.adresse.trim(),
      code_postal: values.code_postal.trim(),
      ville: values.ville.trim(),
      types_vehicules: values.types_vehicules,
      types_collecte:
        values.types_collecte.length > 0 ? values.types_collecte : null,
      type_tms: values.type_tms,
      description_process_collecte:
        values.description_process_collecte.trim() || null,
      code_transporteur_mts1:
        values.type_tms === 'mts1'
          ? values.code_transporteur_mts1.trim()
          : null,
      actif: values.actif,
    };

    const url = isEdition
      ? `/api/v1/admin/transporteurs/${transporteurId}`
      : '/api/v1/admin/transporteurs';
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
    router.push(`/admin/transporteurs/${isEdition ? transporteurId : data.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      <Card className="p-6 space-y-4">
        <h2 className="font-semibold text-savr-neutral-800">Identité</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            label="Nom du transporteur"
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
            label="SIREN"
            htmlFor="siren"
            required
            error={errors.siren}
            hint="9 chiffres, validation INSEE"
          >
            <Input
              id="siren"
              value={values.siren}
              onChange={(e) => set('siren', e.target.value)}
              error={Boolean(errors.siren)}
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
        <h2 className="font-semibold text-savr-neutral-800">Contact</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormField
            label="Nom du contact"
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
            label="Numéro de téléphone"
            htmlFor="contact_telephone"
            required
            error={errors.contact_telephone}
            hint="Joignable jour J, format E.164 recommandé"
          >
            <Input
              id="contact_telephone"
              value={values.contact_telephone}
              onChange={(e) => set('contact_telephone', e.target.value)}
              error={Boolean(errors.contact_telephone)}
            />
          </FormField>
          <FormField
            label="Mail de contact"
            htmlFor="contact_email"
            required
            error={errors.contact_email}
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
          Véhicules &amp; collecte
        </h2>
        <FormField
          label="Type(s) de véhicule"
          htmlFor="types_vehicules"
          required
          error={errors.types_vehicules}
        >
          <div
            id="types_vehicules"
            role="group"
            aria-label="Type(s) de véhicule"
            className="flex flex-wrap gap-4"
          >
            {TYPES_VEHICULES.map((t) => (
              <label
                key={t.value}
                className="flex items-center gap-2 text-sm text-savr-neutral-700"
              >
                <input
                  type="checkbox"
                  checked={values.types_vehicules.includes(t.value)}
                  onChange={() => toggleTypeVehicule(t.value)}
                  className="h-4 w-4 rounded border-savr-neutral-300 text-savr-primary-700 focus:outline-2 focus:outline-savr-primary-500"
                />
                {t.label}
              </label>
            ))}
          </div>
        </FormField>

        <FormField
          label="Type(s) de collecte"
          htmlFor="types_collecte"
          hint="Flux gérés par ce transporteur — AG et/ou ZD"
        >
          <div
            id="types_collecte"
            role="group"
            aria-label="Type(s) de collecte"
            className="flex flex-wrap gap-4"
          >
            {TYPES_COLLECTE.map((t) => (
              <label
                key={t.value}
                className="flex items-center gap-2 text-sm text-savr-neutral-700"
              >
                <input
                  type="checkbox"
                  checked={values.types_collecte.includes(t.value)}
                  onChange={() => toggleTypeCollecte(t.value)}
                  className="h-4 w-4 rounded border-savr-neutral-300 text-savr-primary-700 focus:outline-2 focus:outline-savr-primary-500"
                />
                {t.label}
              </label>
            ))}
          </div>
        </FormField>
      </Card>

      <Card className="p-6 space-y-4">
        <h2 className="font-semibold text-savr-neutral-800">
          Admin / Intégration
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            label="Type de TMS"
            htmlFor="type_tms"
            required
            error={errors.type_tms}
          >
            <Select
              id="type_tms"
              value={values.type_tms}
              onChange={(e) =>
                set(
                  'type_tms',
                  e.target.value as TransporteurFormValues['type_tms'],
                )
              }
              error={Boolean(errors.type_tms)}
            >
              <option value="">Sélectionner…</option>
              <option value="mts1">MTS-1 (Strike / Marathon)</option>
              <option value="a_toutes">A Toutes! (vélo cargo)</option>
              <option value="autre">Autre (province — email/téléphone)</option>
              <option value="par_mail">
                Par mail (validation Admin manuelle)
              </option>
              <option value="par_telephone">
                Par téléphone (validation Admin manuelle)
              </option>
            </Select>
          </FormField>
          {values.type_tms === 'mts1' && (
            <FormField
              label="Code transporteur MTS-1"
              htmlFor="code_transporteur_mts1"
              required
              error={errors.code_transporteur_mts1}
              hint="carrierShareableCode récupérable via GET /v3/carrier"
            >
              <Input
                id="code_transporteur_mts1"
                value={values.code_transporteur_mts1}
                onChange={(e) => set('code_transporteur_mts1', e.target.value)}
                error={Boolean(errors.code_transporteur_mts1)}
              />
            </FormField>
          )}
        </div>

        <FormField
          label="Description process de création de collecte"
          htmlFor="description_process_collecte"
          hint="Comment déclencher une collecte auprès de ce transporteur (texte libre)"
        >
          <Textarea
            id="description_process_collecte"
            rows={3}
            value={values.description_process_collecte}
            onChange={(e) =>
              set('description_process_collecte', e.target.value)
            }
          />
        </FormField>

        <label className="flex items-center gap-2 text-sm font-medium text-savr-neutral-700 pt-2">
          <input
            type="checkbox"
            checked={values.actif}
            onChange={(e) => set('actif', e.target.checked)}
            className="h-4 w-4 rounded border-savr-neutral-300 text-savr-primary-700 focus:outline-2 focus:outline-savr-primary-500"
          />
          Actif
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
              : 'Créer le transporteur'}
        </Button>
      </div>
    </form>
  );
}
