'use client';

import * as React from 'react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { FormField } from '@/components/ui/form-field';
import { LogoUpload } from '@/components/admin/logo-upload';
import {
  HorairesOuvertureEditor,
  horairesParDefaut,
  type JourHoraire,
} from '@/components/admin/horaires-ouverture-editor';

// Enregistrement association complet, aligné sur le select('*') de l'API liste —
// sert à préremplir la modale d'édition sans re-fetch (toutes les colonnes sont
// déjà renvoyées par GET /api/v1/admin/associations).
export interface AssociationRecord {
  id: string;
  nom: string;
  adresse: string;
  region: string;
  ville: string;
  contact_nom: string | null;
  contact_email: string;
  contact_telephone: string | null;
  capacite_max_beneficiaires: number | null;
  types_aliments_acceptes: string[] | null;
  description_rapport_impact: string;
  commentaires_internes: string | null;
  instructions_acces: string | null;
  siren: string | null;
  logo_url: string | null;
  id_point_collecte_mts1: string | null;
  habilitee_attestation_fiscale: boolean;
  date_expiration_habilitation: string | null;
  actif: boolean;
  horaires_ouverture: JourHoraire[] | null;
}

interface FormValues {
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
  instructions_acces: string;
  siren: string;
  logo_url: string;
  id_point_collecte_mts1: string;
  habilitee_attestation_fiscale: boolean;
  date_expiration_habilitation: string;
  horaires_ouverture: JourHoraire[];
}

function toForm(a: AssociationRecord | null): FormValues {
  return {
    nom: a?.nom ?? '',
    adresse: a?.adresse ?? '',
    region: (a?.region as FormValues['region']) ?? '',
    ville: a?.ville ?? '',
    contact_nom: a?.contact_nom ?? '',
    contact_email: a?.contact_email ?? '',
    contact_telephone: a?.contact_telephone ?? '',
    capacite_max_beneficiaires: a?.capacite_max_beneficiaires?.toString() ?? '',
    types_aliments_acceptes: a?.types_aliments_acceptes?.join(', ') ?? '',
    description_rapport_impact: a?.description_rapport_impact ?? '',
    commentaires_internes: a?.commentaires_internes ?? '',
    instructions_acces: a?.instructions_acces ?? '',
    siren: a?.siren ?? '',
    logo_url: a?.logo_url ?? '',
    id_point_collecte_mts1: a?.id_point_collecte_mts1 ?? '',
    habilitee_attestation_fiscale: a?.habilitee_attestation_fiscale ?? false,
    date_expiration_habilitation: a?.date_expiration_habilitation ?? '',
    horaires_ouverture: a?.horaires_ouverture ?? horairesParDefaut(),
  };
}

interface AssociationModalProps {
  open: boolean;
  /** Association à éditer, ou null pour une création. */
  association: AssociationRecord | null;
  onClose: () => void;
  /** Appelé après un enregistrement/désactivation réussi (rafraîchir la liste). */
  onSaved: () => void;
}

export function AssociationModal({
  open,
  association,
  onClose,
  onSaved,
}: AssociationModalProps) {
  const isEdition = Boolean(association);
  const [values, setValues] = React.useState<FormValues>(() =>
    toForm(association),
  );
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  // (Ré)initialise le formulaire à chaque ouverture / changement de cible.
  React.useEffect(() => {
    if (open) {
      setValues(toForm(association));
      setErrors({});
      setServerError(null);
    }
  }, [open, association]);

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
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
    if (values.siren.trim() !== '' && !/^\d{9}$/.test(values.siren.trim()))
      next.siren = 'SIREN : 9 chiffres';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function buildPayload() {
    return {
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
      instructions_acces: values.instructions_acces.trim() || null,
      siren: values.siren.trim() || null,
      logo_url: values.logo_url || null,
      id_point_collecte_mts1: values.id_point_collecte_mts1.trim() || null,
      habilitee_attestation_fiscale: values.habilitee_attestation_fiscale,
      date_expiration_habilitation: values.date_expiration_habilitation || null,
      horaires_ouverture: values.horaires_ouverture,
    };
  }

  async function submitForm() {
    setServerError(null);
    if (!validate()) return;

    setSubmitting(true);
    const url = isEdition
      ? `/api/v1/admin/associations/${association!.id}`
      : '/api/v1/admin/associations';
    const res = await fetch(url, {
      method: isEdition ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPayload()),
    });
    setSubmitting(false);

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      setServerError(body?.error ?? 'Erreur lors de l’enregistrement');
      return;
    }
    onSaved();
    onClose();
  }

  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    void submitForm();
  }

  async function handleToggleActif() {
    if (!association) return;
    setServerError(null);
    setSubmitting(true);
    const res = await fetch(`/api/v1/admin/associations/${association.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actif: !association.actif }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      setServerError(body?.error ?? 'Erreur lors de la mise à jour');
      return;
    }
    onSaved();
    onClose();
  }

  const checkboxClass =
    'h-4 w-4 rounded border-savr-neutral-300 text-savr-primary-700 focus:outline-2 focus:outline-savr-primary-500';

  const footer = (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={onClose}
        disabled={submitting}
      >
        Annuler
      </Button>
      {isEdition &&
        (association!.actif ? (
          <Button
            type="button"
            variant="destructive"
            onClick={() => void handleToggleActif()}
            disabled={submitting}
          >
            Désactiver
          </Button>
        ) : (
          <Button
            type="button"
            variant="secondary"
            onClick={() => void handleToggleActif()}
            disabled={submitting}
          >
            Réactiver
          </Button>
        ))}
      <Button
        type="button"
        onClick={() => void submitForm()}
        disabled={submitting}
      >
        {submitting
          ? 'Enregistrement…'
          : isEdition
            ? 'Enregistrer'
            : 'Créer l’association'}
      </Button>
    </>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={
        isEdition
          ? `Fiche association — ${association!.nom}`
          : 'Nouvelle association'
      }
      footer={footer}
    >
      <form onSubmit={handleFormSubmit} noValidate className="space-y-6">
        {/* Identité */}
        <section className="space-y-4">
          <h3 className="text-sm font-semibold text-savr-neutral-800">
            Identité
          </h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField
              label="Nom de l'association"
              htmlFor="am_nom"
              required
              error={errors.nom}
            >
              <Input
                id="am_nom"
                value={values.nom}
                onChange={(e) => set('nom', e.target.value)}
                error={Boolean(errors.nom)}
              />
            </FormField>
            <FormField
              label="Capacité max bénéficiaires (repas)"
              htmlFor="am_capacite_max_beneficiaires"
              required
              error={errors.capacite_max_beneficiaires}
              hint="Détermine le matching algo par taille d'événement"
            >
              <Input
                id="am_capacite_max_beneficiaires"
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
          <FormField
            label="Logo de l'association"
            htmlFor="am_logo"
            hint="Affiché dans les rapports AG — optionnel"
          >
            <LogoUpload
              inputId="am_logo"
              value={values.logo_url}
              onChange={(v) => set('logo_url', v)}
            />
          </FormField>
        </section>

        {/* Adresse */}
        <section className="space-y-4">
          <h3 className="text-sm font-semibold text-savr-neutral-800">
            Adresse
          </h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <FormField
              label="Adresse"
              htmlFor="am_adresse"
              required
              error={errors.adresse}
              hint="Géocodée automatiquement à l'enregistrement"
              className="md:col-span-2"
            >
              <Input
                id="am_adresse"
                value={values.adresse}
                onChange={(e) => set('adresse', e.target.value)}
                error={Boolean(errors.adresse)}
              />
            </FormField>
            <FormField
              label="Ville"
              htmlFor="am_ville"
              required
              error={errors.ville}
            >
              <Input
                id="am_ville"
                value={values.ville}
                onChange={(e) => set('ville', e.target.value)}
                error={Boolean(errors.ville)}
              />
            </FormField>
            <FormField
              label="Région"
              htmlFor="am_region"
              required
              error={errors.region}
            >
              <Select
                id="am_region"
                value={values.region}
                onChange={(e) =>
                  set('region', e.target.value as FormValues['region'])
                }
                error={Boolean(errors.region)}
              >
                <option value="">Sélectionner…</option>
                <option value="idf">Île-de-France</option>
                <option value="province">Province</option>
              </Select>
            </FormField>
          </div>
        </section>

        {/* Contact */}
        <section className="space-y-4">
          <h3 className="text-sm font-semibold text-savr-neutral-800">
            Contact
          </h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <FormField
              label="Nom prénom du contact"
              htmlFor="am_contact_nom"
              required
              error={errors.contact_nom}
            >
              <Input
                id="am_contact_nom"
                value={values.contact_nom}
                onChange={(e) => set('contact_nom', e.target.value)}
                error={Boolean(errors.contact_nom)}
              />
            </FormField>
            <FormField
              label="Numéro de contact"
              htmlFor="am_contact_telephone"
              required
              error={errors.contact_telephone}
            >
              <Input
                id="am_contact_telephone"
                value={values.contact_telephone}
                onChange={(e) => set('contact_telephone', e.target.value)}
                error={Boolean(errors.contact_telephone)}
              />
            </FormField>
            <FormField
              label="Email(s) à prévenir en cas de collecte"
              htmlFor="am_contact_email"
              required
              error={errors.contact_email}
              hint="Plusieurs emails séparés par une virgule"
            >
              <Input
                id="am_contact_email"
                value={values.contact_email}
                onChange={(e) => set('contact_email', e.target.value)}
                error={Boolean(errors.contact_email)}
              />
            </FormField>
          </div>
        </section>

        {/* Horaires d'ouverture */}
        <section className="space-y-4">
          <h3 className="text-sm font-semibold text-savr-neutral-800">
            Horaires d'ouverture
          </h3>
          <HorairesOuvertureEditor
            value={values.horaires_ouverture}
            onChange={(v) => set('horaires_ouverture', v)}
          />
        </section>

        {/* Rapport d'impact */}
        <section className="space-y-4">
          <h3 className="text-sm font-semibold text-savr-neutral-800">
            Rapport d'impact
          </h3>
          <FormField
            label="Description pour le rapport d'impact (pour le client)"
            htmlFor="am_description_rapport_impact"
            required
            error={errors.description_rapport_impact}
            hint="Minimum 30 caractères, copiée dans le rapport AG"
          >
            <Textarea
              id="am_description_rapport_impact"
              rows={4}
              value={values.description_rapport_impact}
              onChange={(e) =>
                set('description_rapport_impact', e.target.value)
              }
              error={Boolean(errors.description_rapport_impact)}
            />
          </FormField>
          <FormField
            label="Types d'aliments acceptés"
            htmlFor="am_types_aliments_acceptes"
            hint="Séparés par une virgule"
          >
            <Input
              id="am_types_aliments_acceptes"
              value={values.types_aliments_acceptes}
              onChange={(e) => set('types_aliments_acceptes', e.target.value)}
            />
          </FormField>
          <FormField
            label="Instructions d'accès (pour le transporteur)"
            htmlFor="am_instructions_acces"
          >
            <Textarea
              id="am_instructions_acces"
              rows={2}
              value={values.instructions_acces}
              onChange={(e) => set('instructions_acces', e.target.value)}
            />
          </FormField>
        </section>

        {/* Admin / Ops */}
        <section className="space-y-4">
          <h3 className="text-sm font-semibold text-savr-neutral-800">
            Admin / Ops
          </h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField
              label="SIREN"
              htmlFor="am_siren"
              error={errors.siren}
              hint="9 chiffres — optionnel, édition admin"
            >
              <Input
                id="am_siren"
                value={values.siren}
                onChange={(e) => set('siren', e.target.value)}
                error={Boolean(errors.siren)}
              />
            </FormField>
            <FormField
              label="Id du point de collecte dans MTS-1"
              htmlFor="am_id_point_collecte_mts1"
              hint="V1 only — sert au pré-fill lors de l'envoi vers MTS-1"
            >
              <Input
                id="am_id_point_collecte_mts1"
                value={values.id_point_collecte_mts1}
                onChange={(e) => set('id_point_collecte_mts1', e.target.value)}
              />
            </FormField>
            <FormField
              label="Date d'expiration habilitation 2041-GE"
              htmlFor="am_date_expiration_habilitation"
              hint="Optionnel — édition admin"
            >
              <Input
                id="am_date_expiration_habilitation"
                type="date"
                value={values.date_expiration_habilitation}
                onChange={(e) =>
                  set('date_expiration_habilitation', e.target.value)
                }
              />
            </FormField>
            <FormField
              label="Commentaire interne"
              htmlFor="am_commentaires_internes"
            >
              <Textarea
                id="am_commentaires_internes"
                rows={2}
                value={values.commentaires_internes}
                onChange={(e) => set('commentaires_internes', e.target.value)}
              />
            </FormField>
          </div>
          <label className="flex items-center gap-2 text-sm font-medium text-savr-neutral-700">
            <input
              type="checkbox"
              checked={values.habilitee_attestation_fiscale}
              onChange={(e) =>
                set('habilitee_attestation_fiscale', e.target.checked)
              }
              className={checkboxClass}
            />
            Habilitation 2041-GE (attestation fiscale)
          </label>
        </section>

        {serverError && (
          <p className="text-sm text-savr-error-strong">{serverError}</p>
        )}
      </form>
    </Modal>
  );
}
