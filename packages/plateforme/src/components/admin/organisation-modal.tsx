'use client';

import * as React from 'react';
import { Building2, Mail, MapPin } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { AlertBar } from '@/components/ui/alert-bar';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { FormField } from '@/components/ui/form-field';
import { FormGrid } from '@/components/ui/form-grid';
import { normaliserSiretOrganisation } from '@/lib/siret-organisation';
import { SectionCard } from '@/components/ui/section-header';
import { LIBELLE_TYPE_ORGANISATION } from '@/lib/libelles/organisation';
import {
  MESSAGE_FORMAT_SIRET,
  messageObligatoire,
} from '@/lib/libelles/validation';
import { FormActions } from '@/components/ui/form-actions';

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

interface OrganisationModalProps {
  open: boolean;
  onClose: () => void;
  /** Appelé après une création réussie (rafraîchir la liste). */
  onCreated: () => void;
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
      setSubmitting(false);
    }
  }, [open]);

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!values.nom.trim()) next.nom = messageObligatoire('Nom');
    if (!values.raison_sociale.trim())
      next.raison_sociale = messageObligatoire('Raison sociale');
    if (!values.type) next.type = messageObligatoire('Type');
    if (!values.email_principal.trim())
      next.email_principal = messageObligatoire('Email principal');
    // Même normalisation que POST/PATCH /admin/organisations (§06.06) : le
    // contrôle client ne peut pas diverger du contrôle serveur.
    if (!normaliserSiretOrganisation(values.siret).valide)
      next.siret = MESSAGE_FORMAT_SIRET;
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  // Champs optionnels vides → omis (JSON.stringify ignore `undefined`), jamais
  // une chaîne vide persistée en base.
  function buildPayload() {
    const opt = (s: string) => s.trim() || undefined;
    const siret = normaliserSiretOrganisation(values.siret);
    return {
      nom: values.nom.trim(),
      raison_sociale: values.raison_sociale.trim(),
      type: values.type,
      siret: (siret.valide && siret.siret) || undefined,
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
    // Corps de succès non relu : la liste se recharge, l'id est inutile ici
    // (et un corps illisible ne doit pas bloquer une création déjà faite).
    onCreated();
    onClose();
  }

  function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    void submitForm();
  }

  // Pas de fermeture (Échap, fond, croix) pendant l'envoi : la réponse
  // arriverait sur une modale fermée ou rouverte vide.
  const fermer = () => {
    if (!submitting) onClose();
  };

  const footer = (
    <FormActions
      cancel={{ label: 'Annuler', onClick: onClose }}
      submit={{
        label: 'Créer l’organisation',
        type: 'button',
        onClick: () => void submitForm(),
      }}
      loading={submitting}
      loadingText="Création…"
    />
  );

  return (
    <Modal
      open={open}
      onClose={fermer}
      wide
      title="Nouvelle organisation"
      footer={footer}
    >
      <form onSubmit={handleFormSubmit} noValidate className="space-y-4">
        <SectionCard icon={Building2} title="Identité">
          <FormGrid>
            <FormField
              label="Nom"
              htmlFor="om_nom"
              required
              error={errors.nom}
              hint="Nom usuel affiché dans l’app"
            >
              <Input
                id="om_nom"
                required
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
                required
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
              <Combobox
                id="om_type"
                icon={null}
                required
                value={values.type}
                onChange={(v) => set('type', v)}
                error={Boolean(errors.type)}
                options={Object.entries(LIBELLE_TYPE_ORGANISATION).map(
                  ([k, v]) => ({ value: k, label: v }),
                )}
              />
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
          </FormGrid>
        </SectionCard>

        <SectionCard icon={Mail} title="Contact">
          <FormGrid>
            <FormField
              label="Email principal"
              htmlFor="om_email_principal"
              required
              error={errors.email_principal}
            >
              <Input
                id="om_email_principal"
                type="email"
                required
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
          </FormGrid>
        </SectionCard>

        <SectionCard icon={MapPin} title="Adresse">
          <FormField
            label="Adresse"
            htmlFor="om_adresse"
            hint="Optionnel — l’adresse de facturation se saisit dans la fiche"
          >
            <Input
              id="om_adresse"
              value={values.adresse}
              onChange={(e) => set('adresse', e.target.value)}
            />
          </FormField>
        </SectionCard>

        {serverError && (
          <AlertBar variant="err" role="alert">
            {serverError}
          </AlertBar>
        )}
      </form>
    </Modal>
  );
}
