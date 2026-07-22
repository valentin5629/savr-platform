'use client';

import * as React from 'react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { FormField } from '@/components/ui/form-field';

// Modale création/édition d'un lieu — remplace la fiche + les pages nouveau/modifier
// (point unique, ouverte depuis la liste /admin/lieux). En édition, les champs sont
// hydratés par GET /api/v1/admin/lieux/{id} (seul endroit qui expose le gestionnaire
// rattaché via organisations_lieux). Miroir de TransporteurModal (#252/#254).

// Réponse du GET détail — sert à préremplir le formulaire d'édition.
interface LieuApi {
  nom: string;
  nom_alternatif: string | null;
  adresse_acces: string;
  code_postal: string;
  ville: string;
  region: string | null;
  acces_office: string | null;
  stationnement: string | null;
  type_vehicule_max: string;
  controle_acces_requis_default: boolean;
  capacite_maximum: number | null;
  volume_max_bacs: number | null;
  contraintes_horaires: string | null;
  acces_details: string | null;
  flux_autorises: string[] | null;
  photos_urls: string[] | null;
  actif: boolean;
  gestionnaire_organisation_id: string | null;
  commentaire_lieu: string | null;
  commentaires_internes: string | null;
  siren: string | null;
  email_gestionnaire: string | null;
  reference_citeo: boolean;
}

interface OrgOption {
  id: string;
  raison_sociale: string | null;
  nom?: string | null;
}

interface FormValues {
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
  region: '' | 'idf' | 'province';
  controle_acces_requis_default: boolean;
  capacite_maximum: string;
  volume_max_bacs: string;
  contraintes_horaires: string;
  acces_details: string;
  // text[] libre (pas d'enum) — saisie séparée par des virgules.
  flux_autorises: string;
  actif: boolean;
  // Gestionnaire rattaché (organisations_lieux) — organisation type gestionnaire_lieux.
  gestionnaire_organisation_id: string;
  commentaire_lieu: string;
  // Admin/ops only (RLS column-level).
  commentaires_internes: string;
  siren: string;
  email_gestionnaire: string;
  reference_citeo: boolean;
}

const VIDE: FormValues = {
  nom: '',
  nom_alternatif: '',
  adresse_acces: '',
  code_postal: '',
  ville: '',
  acces_office: '',
  stationnement: '',
  type_vehicule_max: '',
  region: '',
  controle_acces_requis_default: false,
  capacite_maximum: '',
  volume_max_bacs: '',
  contraintes_horaires: '',
  acces_details: '',
  flux_autorises: '',
  actif: true,
  gestionnaire_organisation_id: '',
  commentaire_lieu: '',
  commentaires_internes: '',
  siren: '',
  email_gestionnaire: '',
  reference_citeo: false,
};

function toForm(d: LieuApi): FormValues {
  return {
    nom: d.nom ?? '',
    nom_alternatif: d.nom_alternatif ?? '',
    adresse_acces: d.adresse_acces ?? '',
    code_postal: d.code_postal ?? '',
    ville: d.ville ?? '',
    acces_office: (d.acces_office as FormValues['acces_office']) ?? '',
    stationnement: (d.stationnement as FormValues['stationnement']) ?? '',
    type_vehicule_max:
      (d.type_vehicule_max as FormValues['type_vehicule_max']) ?? '',
    region: (d.region as FormValues['region']) ?? '',
    controle_acces_requis_default: d.controle_acces_requis_default ?? false,
    capacite_maximum: d.capacite_maximum?.toString() ?? '',
    volume_max_bacs: d.volume_max_bacs?.toString() ?? '',
    contraintes_horaires: d.contraintes_horaires ?? '',
    acces_details: d.acces_details ?? '',
    flux_autorises: (d.flux_autorises ?? []).join(', '),
    actif: d.actif ?? true,
    gestionnaire_organisation_id: d.gestionnaire_organisation_id ?? '',
    commentaire_lieu: d.commentaire_lieu ?? '',
    commentaires_internes: d.commentaires_internes ?? '',
    siren: d.siren ?? '',
    email_gestionnaire: d.email_gestionnaire ?? '',
    reference_citeo: d.reference_citeo ?? false,
  };
}

interface LieuModalProps {
  open: boolean;
  /** Id du lieu à éditer, ou null pour une création. */
  lieuId: string | null;
  onClose: () => void;
  /** Appelé après un enregistrement réussi (rafraîchir la liste). */
  onSaved: () => void;
}

export function LieuModal({ open, lieuId, onClose, onSaved }: LieuModalProps) {
  const isEdition = Boolean(lieuId);
  const [values, setValues] = React.useState<FormValues>(VIDE);
  // Photos (R2) — lecture seule, non éditées via le formulaire.
  const [photos, setPhotos] = React.useState<string[]>([]);
  const [gestionnaires, setGestionnaires] = React.useState<OrgOption[]>([]);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [hydrating, setHydrating] = React.useState(false);

  // Liste des organisations gestionnaires de lieux (sélecteur mono) — à l'ouverture.
  React.useEffect(() => {
    if (!open) return;
    void fetch('/api/v1/admin/organisations?type=gestionnaire_lieux&actif=true')
      .then((r) => r.json())
      .then((j: { data?: OrgOption[] }) => setGestionnaires(j.data ?? []))
      .catch(() => setGestionnaires([]));
  }, [open]);

  // (Ré)initialise / hydrate le formulaire à chaque ouverture ou changement de cible.
  React.useEffect(() => {
    if (!open) return;
    setErrors({});
    setServerError(null);
    if (lieuId) {
      setHydrating(true);
      void fetch(`/api/v1/admin/lieux/${lieuId}`)
        .then((r) => r.json())
        .then((d: LieuApi) => {
          setValues(toForm(d));
          setPhotos(d.photos_urls ?? []);
        })
        .catch(() => setServerError('Erreur lors du chargement du lieu'))
        .finally(() => setHydrating(false));
    } else {
      setValues(VIDE);
      setPhotos([]);
    }
  }, [open, lieuId]);

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
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

  function buildPayload() {
    return {
      nom: values.nom.trim(),
      nom_alternatif: values.nom_alternatif.trim() || null,
      adresse_acces: values.adresse_acces.trim(),
      code_postal: values.code_postal.trim(),
      ville: values.ville.trim(),
      region: values.region || null,
      acces_office: values.acces_office || null,
      stationnement: values.stationnement || null,
      type_vehicule_max: values.type_vehicule_max,
      controle_acces_requis_default: values.controle_acces_requis_default,
      capacite_maximum: values.capacite_maximum
        ? parseInt(values.capacite_maximum, 10)
        : null,
      volume_max_bacs: values.volume_max_bacs
        ? parseInt(values.volume_max_bacs, 10)
        : null,
      contraintes_horaires: values.contraintes_horaires.trim() || null,
      acces_details: values.acces_details.trim() || null,
      flux_autorises: values.flux_autorises.trim()
        ? values.flux_autorises
            .split(',')
            .map((f) => f.trim())
            .filter(Boolean)
        : null,
      actif: values.actif,
      gestionnaire_organisation_id: values.gestionnaire_organisation_id || '',
      commentaire_lieu: values.commentaire_lieu.trim() || null,
      commentaires_internes: values.commentaires_internes.trim() || null,
      siren: values.siren.trim() || null,
      email_gestionnaire: values.email_gestionnaire.trim() || null,
      reference_citeo: values.reference_citeo,
    };
  }

  async function submitForm() {
    setServerError(null);
    if (!validate()) return;

    setSubmitting(true);
    const url = isEdition
      ? `/api/v1/admin/lieux/${lieuId}`
      : '/api/v1/admin/lieux';
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
        disabled={submitting || hydrating}
      >
        {submitting
          ? 'Enregistrement…'
          : isEdition
            ? 'Enregistrer'
            : 'Créer le lieu'}
      </Button>
    </>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={isEdition ? 'Fiche lieu' : 'Nouveau lieu'}
      footer={footer}
    >
      {hydrating ? (
        <p className="py-8 text-center text-sm text-savr-neutral-500">
          Chargement du lieu…
        </p>
      ) : (
        <form onSubmit={handleFormSubmit} noValidate className="space-y-5">
          {/* Identité */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField
              label="Nom du lieu"
              htmlFor="lm_nom"
              required
              error={errors.nom}
            >
              <Input
                id="lm_nom"
                value={values.nom}
                onChange={(e) => set('nom', e.target.value)}
                error={Boolean(errors.nom)}
              />
            </FormField>
            <FormField label="Nom alternatif" htmlFor="lm_nom_alternatif">
              <Input
                id="lm_nom_alternatif"
                value={values.nom_alternatif}
                onChange={(e) => set('nom_alternatif', e.target.value)}
              />
            </FormField>
            <FormField
              label="Gestionnaire de lieux"
              htmlFor="lm_gestionnaire"
              hint="Organisation gestionnaire rattachée — optionnel"
              className="md:col-span-2"
            >
              <Select
                id="lm_gestionnaire"
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
          </div>

          {/* Adresse */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <FormField
              label="Adresse accès livraison"
              htmlFor="lm_adresse_acces"
              required
              error={errors.adresse_acces}
              hint="Géocodée automatiquement à l'enregistrement"
              className="md:col-span-2"
            >
              <Input
                id="lm_adresse_acces"
                value={values.adresse_acces}
                onChange={(e) => set('adresse_acces', e.target.value)}
                error={Boolean(errors.adresse_acces)}
              />
            </FormField>
            <FormField label="Région" htmlFor="lm_region">
              <Select
                id="lm_region"
                value={values.region}
                onChange={(e) =>
                  set('region', e.target.value as FormValues['region'])
                }
              >
                <option value="">Non renseignée</option>
                <option value="idf">Île-de-France</option>
                <option value="province">Province</option>
              </Select>
            </FormField>
            <FormField
              label="Code postal"
              htmlFor="lm_code_postal"
              required
              error={errors.code_postal}
            >
              <Input
                id="lm_code_postal"
                value={values.code_postal}
                onChange={(e) => set('code_postal', e.target.value)}
                error={Boolean(errors.code_postal)}
              />
            </FormField>
            <FormField
              label="Ville"
              htmlFor="lm_ville"
              required
              error={errors.ville}
            >
              <Input
                id="lm_ville"
                value={values.ville}
                onChange={(e) => set('ville', e.target.value)}
                error={Boolean(errors.ville)}
              />
            </FormField>
          </div>

          {/* Accès & véhicule */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <FormField label="Accès office" htmlFor="lm_acces_office">
              <Select
                id="lm_acces_office"
                value={values.acces_office}
                onChange={(e) =>
                  set(
                    'acces_office',
                    e.target.value as FormValues['acces_office'],
                  )
                }
              >
                <option value="">Non renseigné</option>
                <option value="facile">Facile</option>
                <option value="difficile">Difficile</option>
                <option value="tres_difficile">Très difficile</option>
              </Select>
            </FormField>
            <FormField label="Stationnement" htmlFor="lm_stationnement">
              <Select
                id="lm_stationnement"
                value={values.stationnement}
                onChange={(e) =>
                  set(
                    'stationnement',
                    e.target.value as FormValues['stationnement'],
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
              htmlFor="lm_type_vehicule_max"
              required
              error={errors.type_vehicule_max}
              hint="Tous les véhicules ≤ max sont acceptés"
            >
              <Select
                id="lm_type_vehicule_max"
                value={values.type_vehicule_max}
                onChange={(e) =>
                  set(
                    'type_vehicule_max',
                    e.target.value as FormValues['type_vehicule_max'],
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
            <FormField label="Capacité maximum" htmlFor="lm_capacite_maximum">
              <Input
                id="lm_capacite_maximum"
                type="number"
                min={0}
                value={values.capacite_maximum}
                onChange={(e) => set('capacite_maximum', e.target.value)}
              />
            </FormField>
            <FormField
              label="Volume max (bacs 1100L)"
              htmlFor="lm_volume_max_bacs"
            >
              <Input
                id="lm_volume_max_bacs"
                type="number"
                min={0}
                value={values.volume_max_bacs}
                onChange={(e) => set('volume_max_bacs', e.target.value)}
              />
            </FormField>
            <FormField
              label="Contraintes horaires"
              htmlFor="lm_contraintes_horaires"
              hint="Plages autorisées pour la collecte"
            >
              <Input
                id="lm_contraintes_horaires"
                value={values.contraintes_horaires}
                onChange={(e) => set('contraintes_horaires', e.target.value)}
              />
            </FormField>
          </div>

          <div className="flex flex-wrap gap-6 pt-1">
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

          <FormField
            label="Carnet d'accès terrain"
            htmlFor="lm_acces_details"
            hint="Badge, code, interphone, contact gardien, digicode parking, notes stationnement — partagé au transporteur"
          >
            <Textarea
              id="lm_acces_details"
              rows={2}
              value={values.acces_details}
              onChange={(e) => set('acces_details', e.target.value)}
            />
          </FormField>

          <FormField
            label="Flux autorisés"
            htmlFor="lm_flux_autorises"
            hint="Flux acceptés sur ce lieu — séparés par des virgules"
          >
            <Input
              id="lm_flux_autorises"
              value={values.flux_autorises}
              onChange={(e) => set('flux_autorises', e.target.value)}
            />
          </FormField>

          <FormField
            label="Commentaire sur le lieu"
            htmlFor="lm_commentaire_lieu"
          >
            <Textarea
              id="lm_commentaire_lieu"
              rows={2}
              value={values.commentaire_lieu}
              onChange={(e) => set('commentaire_lieu', e.target.value)}
            />
          </FormField>

          {/* Photos — lecture seule (upload géré hors formulaire, stockage R2). */}
          {photos.length > 0 && (
            <div>
              <p className="mb-1 text-sm font-medium text-savr-neutral-700">
                Photos ({photos.length})
              </p>
              <ul className="space-y-1 text-sm">
                {photos.map((url, i) => (
                  <li key={url}>
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-savr-primary-700 hover:underline"
                    >
                      Photo {i + 1}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Admin / Ops (RLS column-level — invisible côté client) */}
          <div className="space-y-4 rounded-savr-md border border-savr-neutral-200 bg-savr-neutral-50 p-4">
            <h3 className="text-sm font-semibold text-savr-neutral-800">
              Admin / Ops
              <span className="ml-2 text-xs font-normal text-savr-neutral-500">
                (invisible côté traiteur, agence, gestionnaire, client
                organisateur)
              </span>
            </h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField
                label="SIREN"
                htmlFor="lm_siren"
                error={errors.siren}
                hint="9 chiffres, distinct du SIREN du gestionnaire"
              >
                <Input
                  id="lm_siren"
                  value={values.siren}
                  onChange={(e) => set('siren', e.target.value)}
                  error={Boolean(errors.siren)}
                />
              </FormField>
              <FormField
                label="Mail gestionnaire du lieu"
                htmlFor="lm_email_gestionnaire"
                hint="Référent — relances commerciales/opérationnelles internes"
              >
                <Input
                  id="lm_email_gestionnaire"
                  value={values.email_gestionnaire}
                  onChange={(e) => set('email_gestionnaire', e.target.value)}
                />
              </FormField>
            </div>
            <FormField
              label="Notes internes"
              htmlFor="lm_commentaires_internes"
              hint="Notes opérationnelles Admin (technique migration, contexte historique)"
            >
              <Textarea
                id="lm_commentaires_internes"
                rows={2}
                value={values.commentaires_internes}
                onChange={(e) => set('commentaires_internes', e.target.value)}
              />
            </FormField>
            <label className="flex items-center gap-2 text-sm font-medium text-savr-neutral-700">
              <input
                type="checkbox"
                checked={values.reference_citeo}
                onChange={(e) => set('reference_citeo', e.target.checked)}
                className="h-4 w-4 rounded border-savr-neutral-300 text-savr-primary-700 focus:outline-2 focus:outline-savr-primary-500"
              />
              Référencé Citeo (REP emballages)
            </label>
          </div>

          {serverError && (
            <p className="text-sm text-savr-error-strong">{serverError}</p>
          )}
        </form>
      )}
    </Modal>
  );
}
