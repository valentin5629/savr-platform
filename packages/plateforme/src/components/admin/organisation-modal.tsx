'use client';

import * as React from 'react';
import { Building2, Mail, MapPin, type LucideIcon } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { FormField } from '@/components/ui/form-field';

// Libellés des 4 types d'organisation (enum `organisation_type`), mêmes
// libellés que le filtre de la liste Clients.
export const TYPE_ORGANISATION_LABELS: Record<string, string> = {
  traiteur: 'Traiteur',
  agence: 'Agence',
  gestionnaire_lieux: 'Gestionnaire lieux',
  client_organisateur: 'Client organisateur',
};

interface FormValues {
  nom: string;
  raison_sociale: string;
  type: string;
  siret: string;
  email_principal: string;
  telephone: string;
  adresse: string;
}

const VIDE: FormValues = {
  nom: '',
  raison_sociale: '',
  type: '',
  siret: '',
  email_principal: '',
  telephone: '',
  adresse: '',
};

// Garde de saisie seulement : l'email réel est confirmé par l'usage.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Bloc thématique — même gabarit Design System que la modale association
// (carte bordée + pastille primary + titre extrabold, §10).
function Bloc({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-savr-md border border-savr-neutral-200 bg-savr-white p-4 sm:p-5">
      <div className="mb-4 flex items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-savr-md bg-savr-primary-50 text-savr-primary-700">
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <h3 className="text-base font-extrabold tracking-[-0.01em] text-savr-neutral-900">
          {title}
        </h3>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

interface OrganisationModalProps {
  open: boolean;
  onClose: () => void;
  /** Appelé avec l'id de l'organisation créée (rafraîchir la liste). */
  onCreated: (id: string) => void;
}

// Modale « Nouvelle organisation » (§06.06 liste Clients, ajout 2026-09-16) —
// admin_savr ET ops_savr. Création seule : l'édition vit dans la fiche.
// Le payload se limite aux 7 colonnes de l'allowlist de
// POST /api/v1/admin/organisations ; admin-only (tarif, grille, notes) et
// système (est_shadow, actif…) ne sont jamais saisissables ici.
export function OrganisationModal({
  open,
  onClose,
  onCreated,
}: OrganisationModalProps) {
  const [values, setValues] = React.useState<FormValues>(VIDE);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setValues(VIDE);
      setErrors({});
      setServerError(null);
    }
  }, [open]);

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!values.nom.trim()) next.nom = 'Nom obligatoire';
    if (!values.raison_sociale.trim())
      next.raison_sociale = 'Raison sociale obligatoire';
    if (!values.type) next.type = 'Type obligatoire';
    const email = values.email_principal.trim();
    if (!email) next.email_principal = 'Email principal obligatoire';
    else if (!EMAIL_RE.test(email))
      next.email_principal = 'Email principal invalide';
    const siret = values.siret.replace(/\s/g, '');
    if (siret !== '' && !/^\d{14}$/.test(siret))
      next.siret = 'SIRET : 14 chiffres';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  // Champs optionnels vides → omis (JSON.stringify ignore `undefined`), jamais
  // une chaîne vide persistée en base.
  function buildPayload() {
    const opt = (s: string) => s.trim() || undefined;
    return {
      nom: values.nom.trim(),
      raison_sociale: values.raison_sociale.trim(),
      type: values.type,
      siret: values.siret.replace(/\s/g, '') || undefined,
      email_principal: values.email_principal.trim(),
      telephone: opt(values.telephone),
      adresse: opt(values.adresse),
    };
  }

  async function submitForm() {
    setServerError(null);
    if (!validate()) return;

    setSubmitting(true);
    const res = await fetch('/api/v1/admin/organisations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPayload()),
    }).catch(() => null);
    setSubmitting(false);

    if (!res || !res.ok) {
      const body = (await res?.json().catch(() => null)) as {
        error?: string;
      } | null;
      setServerError(body?.error ?? 'Erreur lors de la création');
      return;
    }
    const org = (await res.json()) as { id: string };
    onCreated(org.id);
    onClose();
  }

  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    void submitForm();
  }

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
      <Button
        type="button"
        onClick={() => void submitForm()}
        disabled={submitting}
      >
        {submitting ? 'Création…' : 'Créer l’organisation'}
      </Button>
    </>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="Nouvelle organisation"
      footer={footer}
    >
      <form onSubmit={handleFormSubmit} noValidate className="space-y-4">
        <Bloc icon={Building2} title="Identité">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField
              label="Nom"
              htmlFor="om_nom"
              required
              error={errors.nom}
              hint="Nom usuel affiché dans l'app"
            >
              <Input
                id="om_nom"
                value={values.nom}
                onChange={(e) => set('nom', e.target.value)}
                error={Boolean(errors.nom)}
              />
            </FormField>
            <FormField
              label="Raison sociale"
              htmlFor="om_raison_sociale"
              required
              error={errors.raison_sociale}
            >
              <Input
                id="om_raison_sociale"
                value={values.raison_sociale}
                onChange={(e) => set('raison_sociale', e.target.value)}
                error={Boolean(errors.raison_sociale)}
              />
            </FormField>
            <FormField
              label="Type"
              htmlFor="om_type"
              required
              error={errors.type}
            >
              <Select
                id="om_type"
                value={values.type}
                onChange={(e) => set('type', e.target.value)}
                error={Boolean(errors.type)}
              >
                <option value="">Sélectionner…</option>
                {Object.entries(TYPE_ORGANISATION_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField
              label="SIRET"
              htmlFor="om_siret"
              error={errors.siret}
              hint="14 chiffres — optionnel"
            >
              <Input
                id="om_siret"
                inputMode="numeric"
                value={values.siret}
                onChange={(e) => set('siret', e.target.value)}
                error={Boolean(errors.siret)}
              />
            </FormField>
          </div>
        </Bloc>

        <Bloc icon={Mail} title="Contact">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField
              label="Email principal"
              htmlFor="om_email_principal"
              required
              error={errors.email_principal}
            >
              <Input
                id="om_email_principal"
                type="email"
                value={values.email_principal}
                onChange={(e) => set('email_principal', e.target.value)}
                error={Boolean(errors.email_principal)}
              />
            </FormField>
            <FormField label="Téléphone" htmlFor="om_telephone">
              <Input
                id="om_telephone"
                type="tel"
                value={values.telephone}
                onChange={(e) => set('telephone', e.target.value)}
              />
            </FormField>
          </div>
        </Bloc>

        <Bloc icon={MapPin} title="Adresse">
          <FormField
            label="Adresse"
            htmlFor="om_adresse"
            hint="Optionnel — l'adresse de facturation se saisit dans la fiche"
          >
            <Input
              id="om_adresse"
              value={values.adresse}
              onChange={(e) => set('adresse', e.target.value)}
            />
          </FormField>
        </Bloc>

        {serverError && (
          <p className="text-sm text-savr-error-strong" role="alert">
            {serverError}
          </p>
        )}
      </form>
    </Modal>
  );
}
