'use client';

import * as React from 'react';
import {
  Heart,
  MapPin,
  User,
  Clock,
  DoorOpen,
  FileText,
  BadgeCheck,
  Settings2,
  UtensilsCrossed,
} from 'lucide-react';
import { AlertBar } from '@/components/ui/alert-bar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Combobox } from '@/components/ui/combobox';
import { DatePicker } from '@/components/ui/date-picker';
import { Checkbox } from '@/components/ui/checkbox';
import { FormField } from '@/components/ui/form-field';
import { FormGrid } from '@/components/ui/form-grid';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList } from '@/components/ui/tabs';
import { SectionCard } from '@/components/ui/section-header';
import {
  EnTeteMention,
  EnTetePuce,
  FicheEnTete,
} from '@/components/ui/fiche/fiche-en-tete';
import { FicheCorps, FicheModal } from '@/components/ui/fiche/fiche-modal';
import { OngletAvecErreurs } from '@/components/ui/fiche/onglet-avec-erreurs';
import { LogoUpload } from '@/components/admin/logo-upload';
import {
  HorairesOuvertureEditor,
  horairesParDefaut,
  type JourHoraire,
} from '@/components/admin/horaires-ouverture-editor';
import { ActifBadge } from '@/components/ui/actif-badge';
import { estSiren } from '@savr/shared/src/validation/index.js';
import {
  MESSAGE_FORMAT_SIREN,
  messageLongueurMin,
  messageObligatoire,
} from '@/lib/libelles/validation';

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
  numero_rup: string | null;
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
  numero_rup: string;
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
    numero_rup: a?.numero_rup ?? '',
    logo_url: a?.logo_url ?? '',
    id_point_collecte_mts1: a?.id_point_collecte_mts1 ?? '',
    habilitee_attestation_fiscale: a?.habilitee_attestation_fiscale ?? false,
    date_expiration_habilitation: a?.date_expiration_habilitation ?? '',
    horaires_ouverture: a?.horaires_ouverture ?? horairesParDefaut(),
  };
}

const REGIONS = [
  { value: 'idf', label: 'Île-de-France' },
  { value: 'province', label: 'Province' },
];

// Onglets — gabarit de la fiche collecte Admin (#423), une question par onglet
// (décision Val 2026-09-30) : qui / où / qui appeler, comment le transporteur
// passe, ce que voit le client dans son rapport AG, le fiscal et l'interne.
type Onglet = 'informations' | 'logistique' | 'rapport' | 'administratif';

const ONGLETS: { value: Onglet; label: string }[] = [
  { value: 'informations', label: 'Informations' },
  { value: 'logistique', label: 'Logistique' },
  { value: 'rapport', label: 'Rapport client' },
  { value: 'administratif', label: 'Administratif' },
];

// Onglet de chaque champ contrôlé par validate(). Un message d'erreur dans un
// onglet fermé est invisible : l'échec de validation ouvre le premier onglet
// fautif et chaque onglet affiche son nombre de champs à corriger. Les clés
// d'erreur sont typées par cette table : une validation ajoutée sans onglet ne
// compile pas.
const ONGLET_DU_CHAMP = {
  nom: 'informations',
  capacite_max_beneficiaires: 'informations',
  adresse: 'informations',
  ville: 'informations',
  region: 'informations',
  contact_nom: 'informations',
  contact_telephone: 'informations',
  contact_email: 'informations',
  description_rapport_impact: 'rapport',
  siren: 'administratif',
} satisfies Record<string, Onglet>;

type ChampValide = keyof typeof ONGLET_DU_CHAMP;
type Erreurs = Partial<Record<ChampValide, string>>;

// Les onglets restent montés (forceMount) et l'inactif est seulement masqué :
// une saisie en cours (envoi du logo, copie d'horaires) survit au changement
// d'onglet.
const PANNEAU_ONGLET = 'space-y-4 data-[state=inactive]:hidden';

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
  const [errors, setErrors] = React.useState<Erreurs>({});
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [onglet, setOnglet] = React.useState<Onglet>('informations');
  const ongletsRef = React.useRef<
    Partial<Record<Onglet, HTMLButtonElement | null>>
  >({});
  const alerteRef = React.useRef<HTMLDivElement>(null);

  // (Ré)initialise le formulaire à chaque ouverture / changement de cible.
  React.useEffect(() => {
    if (open) {
      setValues(toForm(association));
      setErrors({});
      setServerError(null);
      setOnglet('informations');
    }
  }, [open, association]);

  // L'erreur serveur vit en tête du corps : la ramener à l'écran quand on a
  // fait défiler un onglet long (horaires).
  React.useEffect(() => {
    if (serverError) alerteRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [serverError]);

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    // Un champ corrigé perd son erreur, et son onglet son compteur, sans
    // attendre le prochain envoi.
    setErrors((e) =>
      key in e
        ? (Object.fromEntries(
            Object.entries(e).filter(([champ]) => champ !== key),
          ) as Erreurs)
        : e,
    );
  }

  function validate(): Erreurs {
    const next: Erreurs = {};
    if (!values.nom.trim()) next.nom = messageObligatoire('Nom');
    if (!values.adresse.trim()) next.adresse = messageObligatoire('Adresse');
    if (!values.region) next.region = messageObligatoire('Région');
    if (!values.ville.trim()) next.ville = messageObligatoire('Ville');
    if (!values.contact_nom.trim())
      next.contact_nom = messageObligatoire('Nom du contact');
    if (!values.contact_telephone.trim())
      next.contact_telephone = messageObligatoire('Numéro de contact');
    if (!values.contact_email.trim())
      next.contact_email = messageObligatoire('Email de contact');
    if (!values.capacite_max_beneficiaires.trim())
      next.capacite_max_beneficiaires = messageObligatoire('Capacité max');
    if (values.description_rapport_impact.trim().length < 30)
      next.description_rapport_impact = messageLongueurMin(
        'Description du rapport d’impact',
        30,
      );
    if (values.siren.trim() !== '' && !estSiren(values.siren.trim()))
      next.siren = MESSAGE_FORMAT_SIREN;
    setErrors(next);
    return next;
  }

  function nbErreurs(o: Onglet): number {
    return (Object.keys(errors) as ChampValide[]).filter(
      (champ) => ONGLET_DU_CHAMP[champ] === o,
    ).length;
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
      numero_rup: values.numero_rup.trim() || null,
      logo_url: values.logo_url || null,
      id_point_collecte_mts1: values.id_point_collecte_mts1.trim() || null,
      habilitee_attestation_fiscale: values.habilitee_attestation_fiscale,
      date_expiration_habilitation: values.date_expiration_habilitation || null,
      horaires_ouverture: values.horaires_ouverture,
    };
  }

  async function submitForm() {
    setServerError(null);
    const champsEnErreur = Object.keys(validate()) as ChampValide[];
    if (champsEnErreur.length > 0) {
      const fautif = ONGLETS.find(({ value }) =>
        champsEnErreur.some((champ) => ONGLET_DU_CHAMP[champ] === value),
      );
      if (fautif) {
        setOnglet(fautif.value);
        // Le focus recale l'onglet atteignable au clavier de Radix (sinon
        // Maj+Tab rouvrirait l'ancien onglet et cacherait les erreurs) et fait
        // annoncer le changement aux lecteurs d'écran.
        ongletsRef.current[fautif.value]?.focus();
      }
      return;
    }

    setSubmitting(true);
    const url = isEdition
      ? `/api/v1/admin/associations/${encodeURIComponent(association!.id)}`
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
    const res = await fetch(
      `/api/v1/admin/associations/${encodeURIComponent(association.id)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actif: !association.actif }),
      },
    );
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
          // Contour rouge, comme la fiche transporteur et « Annuler la collecte ».
          <Button
            type="button"
            variant="outline-destructive"
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
        loading={submitting}
        loadingText="Enregistrement…"
      >
        {isEdition ? 'Enregistrer' : 'Créer l’association'}
      </Button>
    </>
  );

  return (
    // Même shell que les fiches transporteur et lieu (FicheModal) : grand
    // en-tête fixe, corps défilant, hauteur fixe dès md (la modale ne bouge
    // pas d'un onglet à l'autre).
    <FicheModal
      open={open}
      onClose={onClose}
      title={
        isEdition
          ? `Fiche association — ${association!.nom}`
          : 'Nouvelle association'
      }
      footer={footer}
    >
      {isEdition ? (
        // Association ENREGISTRÉE : l'en-tête ne suit pas la saisie.
        <FicheEnTete
          surtitre={
            <>
              <EnTetePuce>
                {association!.region === 'idf' ? 'IDF' : 'Province'}
              </EnTetePuce>
              {association!.siren && (
                <EnTeteMention>
                  SIREN {association!.siren.replace(/(\d{3})(?=\d)/g, '$1 ')}
                </EnTeteMention>
              )}
            </>
          }
          titre={association!.nom}
          infos={[
            { icon: MapPin, texte: association!.ville || '—' },
            {
              icon: UtensilsCrossed,
              texte:
                association!.capacite_max_beneficiaires != null
                  ? `${association!.capacite_max_beneficiaires} repas`
                  : '—',
            },
          ]}
          statut={<ActifBadge actif={association!.actif} sujet="association" />}
        />
      ) : (
        <FicheEnTete
          titre="Nouvelle association"
          description="Renseignez les onglets, puis créez l’association."
        />
      )}
      <FicheCorps>
        <form onSubmit={handleFormSubmit} noValidate>
          {serverError && (
            <AlertBar
              ref={alerteRef}
              variant="err"
              role="alert"
              className="mb-4"
            >
              {serverError}
            </AlertBar>
          )}

          <Tabs value={onglet} onValueChange={(v) => setOnglet(v as Onglet)}>
            {/* Barre d'onglets fixe au défilement du corps de la modale. */}
            <TabsList className="sticky top-0 z-10 w-full overflow-x-auto bg-savr-white">
              {ONGLETS.map(({ value, label }) => (
                <OngletAvecErreurs
                  key={value}
                  ref={(el) => {
                    ongletsRef.current[value] = el;
                  }}
                  value={value}
                  nbErreurs={nbErreurs(value)}
                >
                  {label}
                </OngletAvecErreurs>
              ))}
            </TabsList>

            <TabsContent
              value="informations"
              forceMount
              className={PANNEAU_ONGLET}
            >
              <SectionCard icon={Heart} title="Identité">
                <FormGrid>
                  <FormField
                    label="Nom de l'association"
                    htmlFor="am_nom"
                    required
                    error={errors.nom}
                  >
                    <Input
                      id="am_nom"
                      required
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
                      required
                      type="number"
                      min={0}
                      value={values.capacite_max_beneficiaires}
                      onChange={(e) =>
                        set('capacite_max_beneficiaires', e.target.value)
                      }
                      error={Boolean(errors.capacite_max_beneficiaires)}
                    />
                  </FormField>
                </FormGrid>
              </SectionCard>

              <SectionCard icon={MapPin} title="Adresse">
                <FormGrid cols={3}>
                  <FormField
                    label="Adresse"
                    htmlFor="am_adresse"
                    required
                    error={errors.adresse}
                    hint="Géocodée automatiquement à l'enregistrement"
                    className="sm:col-span-2"
                  >
                    <Input
                      id="am_adresse"
                      required
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
                      required
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
                    <Combobox
                      id="am_region"
                      icon={null}
                      required
                      value={values.region}
                      onChange={(v) => set('region', v as FormValues['region'])}
                      error={Boolean(errors.region)}
                      options={REGIONS}
                    />
                  </FormField>
                </FormGrid>
              </SectionCard>

              <SectionCard icon={User} title="Contact">
                <FormGrid cols={3}>
                  <FormField
                    label="Nom prénom du contact"
                    htmlFor="am_contact_nom"
                    required
                    error={errors.contact_nom}
                  >
                    <Input
                      id="am_contact_nom"
                      required
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
                      required
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
                      required
                      value={values.contact_email}
                      onChange={(e) => set('contact_email', e.target.value)}
                      error={Boolean(errors.contact_email)}
                    />
                  </FormField>
                </FormGrid>
              </SectionCard>
            </TabsContent>

            <TabsContent
              value="logistique"
              forceMount
              className={PANNEAU_ONGLET}
            >
              <SectionCard icon={Clock} title="Horaires d'ouverture">
                <HorairesOuvertureEditor
                  value={values.horaires_ouverture}
                  onChange={(v) => set('horaires_ouverture', v)}
                />
              </SectionCard>

              <SectionCard icon={DoorOpen} title="Accès et réception">
                <FormField
                  label="Instructions d'accès (pour le transporteur)"
                  htmlFor="am_instructions_acces"
                >
                  <Textarea
                    id="am_instructions_acces"
                    rows={3}
                    value={values.instructions_acces}
                    onChange={(e) => set('instructions_acces', e.target.value)}
                  />
                </FormField>
                <FormGrid>
                  <FormField
                    label="Types d'aliments acceptés"
                    htmlFor="am_types_aliments_acceptes"
                    hint="Séparés par une virgule"
                  >
                    <Input
                      id="am_types_aliments_acceptes"
                      value={values.types_aliments_acceptes}
                      onChange={(e) =>
                        set('types_aliments_acceptes', e.target.value)
                      }
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
                      onChange={(e) =>
                        set('id_point_collecte_mts1', e.target.value)
                      }
                    />
                  </FormField>
                </FormGrid>
              </SectionCard>
            </TabsContent>

            <TabsContent value="rapport" forceMount className={PANNEAU_ONGLET}>
              <SectionCard icon={FileText} title="Rapport d'impact">
                <FormField
                  label="Description pour le rapport d'impact (pour le client)"
                  htmlFor="am_description_rapport_impact"
                  required
                  error={errors.description_rapport_impact}
                  hint="Minimum 30 caractères, copiée dans le rapport AG"
                >
                  <Textarea
                    id="am_description_rapport_impact"
                    required
                    rows={5}
                    value={values.description_rapport_impact}
                    onChange={(e) =>
                      set('description_rapport_impact', e.target.value)
                    }
                    error={Boolean(errors.description_rapport_impact)}
                  />
                </FormField>
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
              </SectionCard>
            </TabsContent>

            <TabsContent
              value="administratif"
              forceMount
              className={PANNEAU_ONGLET}
            >
              <SectionCard icon={BadgeCheck} title="Habilitation fiscale">
                <Label
                  variant="choice"
                  className="flex items-center gap-2 font-medium"
                >
                  <Checkbox
                    checked={values.habilitee_attestation_fiscale}
                    onCheckedChange={(v) =>
                      set('habilitee_attestation_fiscale', v === true)
                    }
                  />
                  Habilitation 2041-GE (attestation fiscale)
                </Label>
                <FormGrid>
                  <FormField
                    label="Date d'expiration habilitation 2041-GE"
                    htmlFor="am_date_expiration_habilitation"
                    hint="Optionnel — édition admin"
                  >
                    <DatePicker
                      id="am_date_expiration_habilitation"
                      value={values.date_expiration_habilitation}
                      onChange={(v) => set('date_expiration_habilitation', v)}
                    />
                  </FormField>
                  <FormField
                    label="N° RUP"
                    htmlFor="am_numero_rup"
                    hint="Reconnue d'utilité publique — optionnel, édition admin. Renseigné, il apparaît sur le Cerfa 2041-GE."
                  >
                    <Input
                      id="am_numero_rup"
                      value={values.numero_rup}
                      onChange={(e) => set('numero_rup', e.target.value)}
                    />
                  </FormField>
                </FormGrid>
              </SectionCard>

              <SectionCard
                icon={Settings2}
                title="Identification et suivi interne"
              >
                <FormGrid>
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
                    label="Commentaire interne"
                    htmlFor="am_commentaires_internes"
                  >
                    <Textarea
                      id="am_commentaires_internes"
                      rows={2}
                      value={values.commentaires_internes}
                      onChange={(e) =>
                        set('commentaires_internes', e.target.value)
                      }
                    />
                  </FormField>
                </FormGrid>
              </SectionCard>
            </TabsContent>
          </Tabs>
        </form>
      </FicheCorps>
    </FicheModal>
  );
}
