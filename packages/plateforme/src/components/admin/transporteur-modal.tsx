'use client';

import * as React from 'react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { FormField } from '@/components/ui/form-field';
import { cn } from '@/lib/utils';

// Enregistrement transporteur complet, aligné sur le select('*') de l'API liste —
// sert à préremplir la modale d'édition sans re-fetch (toutes les colonnes sont
// déjà renvoyées par GET /api/v1/admin/transporteurs).
export interface TransporteurRecord {
  id: string;
  nom: string;
  siren: string;
  contact_nom: string;
  contact_telephone: string;
  contact_email: string;
  adresse: string;
  code_postal: string;
  ville: string;
  types_vehicules: string[];
  types_collecte: string[] | null;
  type_tms: string;
  description_process_collecte: string | null;
  code_transporteur_mts1: string | null;
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

interface FormValues {
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
  type_tms: string;
  description_process_collecte: string;
  code_transporteur_mts1: string;
}

function toForm(t: TransporteurRecord | null): FormValues {
  return {
    nom: t?.nom ?? '',
    siren: t?.siren ?? '',
    contact_nom: t?.contact_nom ?? '',
    contact_telephone: t?.contact_telephone ?? '',
    contact_email: t?.contact_email ?? '',
    adresse: t?.adresse ?? '',
    code_postal: t?.code_postal ?? '',
    ville: t?.ville ?? '',
    types_vehicules: t?.types_vehicules ?? [],
    types_collecte: t?.types_collecte ?? [],
    type_tms: t?.type_tms ?? '',
    description_process_collecte: t?.description_process_collecte ?? '',
    code_transporteur_mts1: t?.code_transporteur_mts1 ?? '',
  };
}

interface TransporteurModalProps {
  open: boolean;
  /** Transporteur à éditer, ou null pour une création. */
  transporteur: TransporteurRecord | null;
  onClose: () => void;
  /** Appelé après un enregistrement/désactivation réussi (rafraîchir la liste). */
  onSaved: () => void;
}

export function TransporteurModal({
  open,
  transporteur,
  onClose,
  onSaved,
}: TransporteurModalProps) {
  const isEdition = Boolean(transporteur);
  const [values, setValues] = React.useState<FormValues>(() =>
    toForm(transporteur),
  );
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  // (Ré)initialise le formulaire à chaque ouverture / changement de cible.
  React.useEffect(() => {
    if (open) {
      setValues(toForm(transporteur));
      setErrors({});
      setServerError(null);
    }
  }, [open, transporteur]);

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function toggle(key: 'types_vehicules' | 'types_collecte', value: string) {
    setValues((v) => ({
      ...v,
      [key]: v[key].includes(value)
        ? v[key].filter((t) => t !== value)
        : [...v[key], value],
    }));
  }

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!values.nom.trim()) next.nom = 'Nom obligatoire';
    if (!/^\d{9}$/.test(values.siren.trim())) next.siren = 'SIREN : 9 chiffres';
    if (!values.contact_nom.trim())
      next.contact_nom = 'Nom du contact obligatoire';
    if (!values.contact_telephone.trim())
      next.contact_telephone = 'Téléphone obligatoire';
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

  function buildPayload() {
    return {
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
    };
  }

  async function submitForm() {
    setServerError(null);
    if (!validate()) return;

    setSubmitting(true);
    const url = isEdition
      ? `/api/v1/admin/transporteurs/${transporteur!.id}`
      : '/api/v1/admin/transporteurs';
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
    if (!transporteur) return;
    setServerError(null);
    setSubmitting(true);
    const res = await fetch(`/api/v1/admin/transporteurs/${transporteur.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actif: !transporteur.actif }),
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

  const chipClass = (selected: boolean) =>
    cn(
      // Cible tactile §10 : 44px mobile → 40px desktop, aligné sur Button/Select DS.
      'inline-flex min-h-[44px] items-center rounded-savr-full border px-4 text-sm font-medium transition-colors sm:min-h-[40px]',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-savr-primary-500',
      selected
        ? 'border-savr-primary-700 bg-savr-primary-700 text-savr-white'
        : 'border-savr-neutral-300 bg-savr-white text-savr-neutral-700 hover:border-savr-primary-400',
    );

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
        (transporteur!.actif ? (
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
            : 'Créer le transporteur'}
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
          ? `Fiche transporteur — ${transporteur!.nom}`
          : 'Nouveau transporteur'
      }
      footer={footer}
    >
      <form onSubmit={handleFormSubmit} noValidate className="space-y-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField
            label="Nom du transporteur"
            htmlFor="tm_nom"
            required
            error={errors.nom}
          >
            <Input
              id="tm_nom"
              value={values.nom}
              onChange={(e) => set('nom', e.target.value)}
              error={Boolean(errors.nom)}
            />
          </FormField>
          <FormField
            label="SIREN"
            htmlFor="tm_siren"
            required
            error={errors.siren}
            hint="9 chiffres, validation INSEE"
          >
            <Input
              id="tm_siren"
              value={values.siren}
              onChange={(e) => set('siren', e.target.value)}
              error={Boolean(errors.siren)}
            />
          </FormField>
          <FormField
            label="Nom du contact"
            htmlFor="tm_contact_nom"
            required
            error={errors.contact_nom}
          >
            <Input
              id="tm_contact_nom"
              value={values.contact_nom}
              onChange={(e) => set('contact_nom', e.target.value)}
              error={Boolean(errors.contact_nom)}
            />
          </FormField>
          <FormField
            label="Téléphone"
            htmlFor="tm_contact_telephone"
            required
            error={errors.contact_telephone}
            hint="Joignable jour J, format E.164 recommandé"
          >
            <Input
              id="tm_contact_telephone"
              value={values.contact_telephone}
              onChange={(e) => set('contact_telephone', e.target.value)}
              error={Boolean(errors.contact_telephone)}
            />
          </FormField>
          <FormField
            label="Mail de contact"
            htmlFor="tm_contact_email"
            required
            error={errors.contact_email}
            className="md:col-span-2"
          >
            <Input
              id="tm_contact_email"
              type="email"
              value={values.contact_email}
              onChange={(e) => set('contact_email', e.target.value)}
              error={Boolean(errors.contact_email)}
            />
          </FormField>
          <FormField
            label="Adresse"
            htmlFor="tm_adresse"
            required
            error={errors.adresse}
            hint="Géocodée automatiquement à l'enregistrement"
            className="md:col-span-2"
          >
            <Input
              id="tm_adresse"
              value={values.adresse}
              onChange={(e) => set('adresse', e.target.value)}
              error={Boolean(errors.adresse)}
            />
          </FormField>
          <FormField
            label="Code postal"
            htmlFor="tm_code_postal"
            required
            error={errors.code_postal}
          >
            <Input
              id="tm_code_postal"
              value={values.code_postal}
              onChange={(e) => set('code_postal', e.target.value)}
              error={Boolean(errors.code_postal)}
            />
          </FormField>
          <FormField
            label="Ville"
            htmlFor="tm_ville"
            required
            error={errors.ville}
          >
            <Input
              id="tm_ville"
              value={values.ville}
              onChange={(e) => set('ville', e.target.value)}
              error={Boolean(errors.ville)}
            />
          </FormField>
        </div>

        <FormField
          label="Type(s) de véhicule"
          htmlFor="tm_types_vehicules"
          required
          error={errors.types_vehicules}
        >
          <div
            id="tm_types_vehicules"
            role="group"
            aria-label="Type(s) de véhicule"
            className="flex flex-wrap gap-2"
          >
            {TYPES_VEHICULES.map((t) => {
              const selected = values.types_vehicules.includes(t.value);
              return (
                <button
                  key={t.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggle('types_vehicules', t.value)}
                  className={chipClass(selected)}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </FormField>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField
            label="Type de TMS"
            htmlFor="tm_type_tms"
            required
            error={errors.type_tms}
            hint="Détermine l'adapter logistique (dispatch)"
          >
            <Select
              id="tm_type_tms"
              value={values.type_tms}
              onChange={(e) => set('type_tms', e.target.value)}
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
              htmlFor="tm_code_transporteur_mts1"
              required
              error={errors.code_transporteur_mts1}
              hint="carrierShareableCode récupérable via GET /v3/carrier"
            >
              <Input
                id="tm_code_transporteur_mts1"
                value={values.code_transporteur_mts1}
                onChange={(e) => set('code_transporteur_mts1', e.target.value)}
                error={Boolean(errors.code_transporteur_mts1)}
              />
            </FormField>
          )}
        </div>

        <FormField
          label="Type(s) de collecte"
          htmlFor="tm_types_collecte"
          hint="Flux gérés par ce transporteur — AG et/ou ZD"
        >
          <div
            id="tm_types_collecte"
            role="group"
            aria-label="Type(s) de collecte"
            className="flex flex-wrap gap-2"
          >
            {TYPES_COLLECTE.map((t) => {
              const selected = values.types_collecte.includes(t.value);
              return (
                <button
                  key={t.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggle('types_collecte', t.value)}
                  className={chipClass(selected)}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </FormField>

        <FormField
          label="Description du process de collecte"
          htmlFor="tm_description"
          hint="Comment déclencher une collecte auprès de ce transporteur (texte libre)"
        >
          <Textarea
            id="tm_description"
            rows={3}
            value={values.description_process_collecte}
            onChange={(e) =>
              set('description_process_collecte', e.target.value)
            }
          />
        </FormField>

        {serverError && (
          <p className="text-sm text-savr-error-strong">{serverError}</p>
        )}
      </form>
    </Modal>
  );
}
