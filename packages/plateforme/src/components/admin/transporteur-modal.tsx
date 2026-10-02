'use client';

import * as React from 'react';
import {
  Building2,
  ClipboardList,
  Lock,
  MapPin,
  Phone,
  Truck,
  UserRound,
  Workflow,
} from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { AlertBar } from '@/components/ui/alert-bar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Combobox } from '@/components/ui/combobox';
import { FormField } from '@/components/ui/form-field';
import { Tabs, TabsContent, TabsList } from '@/components/ui/tabs';
import {
  ACTION_DESTRUCTIVE_CONTOUR,
  BlocHeader,
  EnTeteMention,
  EnTetePuce,
  FicheEnTete,
  OngletAvecErreurs,
} from '@/components/collecte/fiche-blocs';
import { cn } from '@/lib/utils';
import { TYPES_TMS_AVEC_PRESTATAIRE } from '@/lib/transporteur-lien-prestataire';

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
  prestataire_logistique_id: string | null;
  actif: boolean;
}

// Entrée de GET /api/v1/admin/prestataires.
export interface PrestataireOption {
  id: string;
  nom: string;
  code: string;
  statut: string;
  /** Transporteur déjà rattaché — un prestataire n'en admet qu'un (#323). */
  transporteur_id: string | null;
  transporteur_nom: string | null;
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

// `label` = option du sélecteur, `court` = badge de l'en-tête de la fiche.
const TYPES_TMS = [
  { value: 'mts1', label: 'MTS-1 (Strike / Marathon)', court: 'MTS-1' },
  { value: 'a_toutes', label: 'A Toutes! (vélo cargo)', court: 'A Toutes!' },
  {
    value: 'autre',
    label: 'Autre (province — email/téléphone)',
    court: 'Autre',
  },
  {
    value: 'par_mail',
    label: 'Par mail (validation Admin manuelle)',
    court: 'Par mail',
  },
  {
    value: 'par_telephone',
    label: 'Par téléphone (validation Admin manuelle)',
    court: 'Par téléphone',
  },
] as const;

// Fiche en 3 onglets au format du pop-up fiche collecte (décision Val
// 2026-09-30, C1/C2) : ce qu'on modifie souvent / ce que le transporteur sait
// faire / la connexion logistique, fixée à la création.
type Onglet = 'identite' | 'capacites' | 'connexion';

const ONGLETS: { value: Onglet; label: string }[] = [
  { value: 'identite', label: 'Identité & contact' },
  { value: 'capacites', label: 'Capacités' },
  { value: 'connexion', label: 'Connexion logistique' },
];

// Onglet de chaque champ validé : une erreur dans un onglet caché y ramène.
const ONGLET_DU_CHAMP: Record<string, Onglet> = {
  nom: 'identite',
  siren: 'identite',
  contact_nom: 'identite',
  contact_telephone: 'identite',
  contact_email: 'identite',
  adresse: 'identite',
  code_postal: 'identite',
  ville: 'identite',
  types_vehicules: 'capacites',
  type_tms: 'connexion',
  code_transporteur_mts1: 'connexion',
  prestataire_logistique_id: 'connexion',
};

// Coordonnées d'un tiers : sans ça, Bitwarden propose l'identité de l'admin
// connecté sur ces champs (décision Val C5).
const SANS_AUTOREMPLISSAGE = {
  autoComplete: 'off',
  'data-bwignore': 'true',
} as const;

const GRILLE_2 = 'grid grid-cols-1 gap-4 md:grid-cols-2';

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
  prestataire_logistique_id: string;
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
    prestataire_logistique_id: t?.prestataire_logistique_id ?? '',
  };
}

interface TransporteurModalProps {
  open: boolean;
  /** Transporteur à éditer, ou null pour une création. */
  transporteur: TransporteurRecord | null;
  onClose: () => void;
  /** Appelé après un enregistrement/désactivation réussi (rafraîchir la liste). */
  onSaved: () => void;
  /**
   * Référentiel des prestataires logistiques (GET /api/v1/admin/prestataires).
   * `null` = pas (encore) chargé ou en échec — à ne pas confondre avec un
   * référentiel vide.
   */
  prestataires?: PrestataireOption[] | null;
}

// En-tête de la fiche : il décrit le transporteur ENREGISTRÉ (stable pendant
// la saisie), pas les valeurs en cours de modification.
function EnTete({ transporteur }: { transporteur: TransporteurRecord | null }) {
  if (!transporteur) {
    return (
      <FicheEnTete
        titre="Nouveau transporteur"
        description="Renseignez les trois onglets, puis créez le transporteur."
      />
    );
  }
  const typeTms = TYPES_TMS.find((t) => t.value === transporteur.type_tms);
  const vehicules = transporteur.types_vehicules
    .map((v) => TYPES_VEHICULES.find((t) => t.value === v)?.label ?? v)
    .join(', ');
  const lieu = [transporteur.ville, transporteur.code_postal]
    .filter(Boolean)
    .join(' ');
  return (
    <FicheEnTete
      surtitre={
        <>
          <EnTetePuce data-testid="badge-type-tms">
            {typeTms?.court ?? transporteur.type_tms}
          </EnTetePuce>
          <EnTeteMention>
            SIREN {transporteur.siren.replace(/(\d{3})(?=\d)/g, '$1 ')}
          </EnTeteMention>
        </>
      }
      titre={transporteur.nom}
      infosTestId="fiche-transporteur-sous-ligne"
      infos={[
        { icon: MapPin, texte: lieu || '—' },
        { icon: Truck, texte: vehicules || '—' },
        { icon: Phone, texte: transporteur.contact_telephone || '—' },
      ]}
      statut={
        transporteur.actif ? (
          <Badge variant="success">Actif</Badge>
        ) : (
          <Badge variant="neutral">Inactif</Badge>
        )
      }
    />
  );
}

export function TransporteurModal({
  open,
  transporteur,
  onClose,
  onSaved,
  prestataires = null,
}: TransporteurModalProps) {
  const isEdition = Boolean(transporteur);
  const [values, setValues] = React.useState<FormValues>(() =>
    toForm(transporteur),
  );
  const [onglet, setOnglet] = React.useState<Onglet>('identite');
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const optionsPrestataires = prestataires ?? [];
  // Lien posé mais absent de la liste (non chargée, en échec) : on l'affiche
  // quand même, sinon le select verrouillé montrerait « Aucun » à tort.
  const lienHorsListe =
    Boolean(values.prestataire_logistique_id) &&
    !optionsPrestataires.some((p) => p.id === values.prestataire_logistique_id);
  const ongletsRef = React.useRef<Partial<Record<Onglet, HTMLButtonElement>>>(
    {},
  );
  function nbErreurs(o: Onglet): number {
    return Object.keys(errors).filter((champ) => ONGLET_DU_CHAMP[champ] === o)
      .length;
  }

  // (Ré)initialise le formulaire à chaque ouverture / changement de cible.
  React.useEffect(() => {
    if (open) {
      setValues(toForm(transporteur));
      setOnglet('identite');
      setErrors({});
      setServerError(null);
    }
  }, [open, transporteur]);

  // Un champ corrigé perd son erreur, et son onglet son compteur, sans
  // attendre le prochain envoi (même comportement que les fiches lieu et
  // association). Changer de type de TMS efface aussi les erreurs des champs
  // qui en dépendent (code MTS-1, prestataire) : ils peuvent disparaître.
  function effacerErreurs(champs: string[]) {
    setErrors((e) =>
      champs.some((c) => c in e)
        ? Object.fromEntries(
            Object.entries(e).filter(([champ]) => !champs.includes(champ)),
          )
        : e,
    );
  }

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    effacerErreurs(
      key === 'type_tms'
        ? ['type_tms', 'code_transporteur_mts1', 'prestataire_logistique_id']
        : [key],
    );
  }

  function toggle(key: 'types_vehicules' | 'types_collecte', value: string) {
    setValues((v) => ({
      ...v,
      [key]: v[key].includes(value)
        ? v[key].filter((t) => t !== value)
        : [...v[key], value],
    }));
    effacerErreurs([key]);
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
    // Exigé à la création seulement : en édition le lien n'est plus modifiable,
    // et un transporteur antérieur à ce contrôle doit rester éditable.
    if (
      !isEdition &&
      TYPES_TMS_AVEC_PRESTATAIRE.includes(values.type_tms) &&
      !values.prestataire_logistique_id
    )
      next.prestataire_logistique_id =
        'Prestataire logistique obligatoire pour ce type de TMS';
    setErrors(next);
    // Sinon « Enregistrer » ne fait rien de visible quand l'erreur est ailleurs.
    const premier = ONGLETS.find((o) =>
      Object.keys(next).some((champ) => ONGLET_DU_CHAMP[champ] === o.value),
    );
    if (premier) {
      setOnglet(premier.value);
      // Le focus recale l'onglet atteignable au clavier de Radix et fait
      // annoncer le changement aux lecteurs d'écran.
      ongletsRef.current[premier.value]?.focus();
    }
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
      description_process_collecte:
        values.description_process_collecte.trim() || null,
      code_transporteur_mts1:
        values.type_tms === 'mts1'
          ? values.code_transporteur_mts1.trim()
          : null,
      // Immuables après création (trg_transporteur_cols_immuables) : envoyés au
      // POST seulement, le PATCH les refuse.
      ...(isEdition
        ? {}
        : {
            type_tms: values.type_tms,
            prestataire_logistique_id: values.prestataire_logistique_id || null,
          }),
    };
  }

  async function submitForm() {
    setServerError(null);
    if (!validate()) return;

    setSubmitting(true);
    const url = isEdition
      ? `/api/v1/admin/transporteurs/${encodeURIComponent(transporteur!.id)}`
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
    const res = await fetch(
      `/api/v1/admin/transporteurs/${encodeURIComponent(transporteur.id)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actif: !transporteur.actif }),
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

  const chipClass = (selected: boolean) =>
    cn(
      // Cible tactile §10 : 44px mobile → 40px desktop, aligné sur Button/Select DS.
      'inline-flex min-h-[44px] items-center rounded-savr-full border px-4 text-sm font-medium transition-colors sm:min-h-[40px]',
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-savr-primary-500',
      selected
        ? 'border-savr-primary-700 bg-savr-primary-700 text-savr-white'
        : 'border-savr-neutral-300 bg-savr-white text-savr-neutral-700 hover:border-savr-primary-400',
    );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        isEdition
          ? `Fiche transporteur — ${transporteur!.nom}`
          : 'Nouveau transporteur'
      }
      // Même cadre que le pop-up fiche collecte : l'en-tête visuel est dans le
      // corps, qui fournit onglets et pied et gère lui-même le défilement.
      hideTitle
      bodyClassName="flex min-h-0 flex-col overflow-hidden p-0"
      className="max-w-5xl md:h-[min(90vh,48rem)]"
    >
      <form
        onSubmit={handleFormSubmit}
        noValidate
        className="flex h-full min-h-0 flex-col"
      >
        <EnTete transporteur={transporteur} />

        {/* Même barre d'onglets horizontale que les fiches lieu et association
            (décision Val 2026-09-30), fixe au défilement du corps. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 md:px-8">
          <Tabs value={onglet} onValueChange={(v) => setOnglet(v as Onglet)}>
            <TabsList
              aria-label="Sections de la fiche transporteur"
              className="sticky top-0 z-10 w-full overflow-x-auto bg-savr-white"
            >
              {ONGLETS.map(({ value, label }) => (
                <OngletAvecErreurs
                  key={value}
                  ref={(el) => {
                    if (el) ongletsRef.current[value] = el;
                  }}
                  value={value}
                  nbErreurs={nbErreurs(value)}
                >
                  {label}
                </OngletAvecErreurs>
              ))}
            </TabsList>

            <TabsContent value="identite" className="space-y-3">
              <Card padding="md" className="space-y-4">
                <BlocHeader icon={Building2} title="Société" />
                <div className={GRILLE_2}>
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
                      {...SANS_AUTOREMPLISSAGE}
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
                </div>
              </Card>

              <Card padding="md" className="space-y-4">
                <BlocHeader icon={UserRound} title="Contact jour J" />
                <div className={GRILLE_2}>
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
                      {...SANS_AUTOREMPLISSAGE}
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
                      {...SANS_AUTOREMPLISSAGE}
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
                      {...SANS_AUTOREMPLISSAGE}
                    />
                  </FormField>
                </div>
              </Card>

              <Card padding="md" className="space-y-4">
                <BlocHeader icon={MapPin} title="Adresse" />
                <div className={GRILLE_2}>
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
                      {...SANS_AUTOREMPLISSAGE}
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
                      {...SANS_AUTOREMPLISSAGE}
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
                      {...SANS_AUTOREMPLISSAGE}
                    />
                  </FormField>
                </div>
              </Card>
            </TabsContent>

            <TabsContent value="capacites" className="space-y-3">
              <Card padding="md" className="space-y-4">
                <BlocHeader icon={Truck} title="Véhicules et flux" />
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
              </Card>

              <Card padding="md" className="space-y-4">
                <BlocHeader icon={ClipboardList} title="Process de collecte" />
                <FormField
                  label="Description du process de collecte"
                  htmlFor="tm_description"
                  hint="Comment déclencher une collecte auprès de ce transporteur (texte libre)"
                >
                  <Textarea
                    id="tm_description"
                    rows={5}
                    value={values.description_process_collecte}
                    onChange={(e) =>
                      set('description_process_collecte', e.target.value)
                    }
                  />
                </FormField>
              </Card>
            </TabsContent>

            <TabsContent value="connexion" className="space-y-3">
              <AlertBar
                variant="info"
                icon={<Lock />}
                data-testid="bandeau-immuabilite"
              >
                {isEdition
                  ? 'Le type de TMS et le prestataire logistique sont fixés à la création. Pour en changer, créez un nouveau transporteur.'
                  : 'Le type de TMS et le prestataire logistique ne pourront plus être modifiés après la création : vérifiez-les avant de créer le transporteur.'}
              </AlertBar>

              <Card padding="md" className="space-y-4">
                <BlocHeader
                  icon={Workflow}
                  title="Transmission des collectes"
                />
                <div className={GRILLE_2}>
                  <FormField
                    label="Type de TMS"
                    htmlFor="tm_type_tms"
                    required
                    error={errors.type_tms}
                    hint={
                      isEdition
                        ? 'Fixé à la création'
                        : "Détermine l'adapter logistique (dispatch)"
                    }
                  >
                    <Combobox
                      id="tm_type_tms"
                      icon={null}
                      required
                      value={values.type_tms}
                      onChange={(v) => set('type_tms', v)}
                      error={Boolean(errors.type_tms)}
                      disabled={isEdition}
                      options={TYPES_TMS.map(({ value, label }) => ({
                        value,
                        label,
                      }))}
                    />
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
                        onChange={(e) =>
                          set('code_transporteur_mts1', e.target.value)
                        }
                        error={Boolean(errors.code_transporteur_mts1)}
                      />
                    </FormField>
                  )}
                  <FormField
                    label="Prestataire logistique"
                    htmlFor="tm_prestataire_logistique_id"
                    required={TYPES_TMS_AVEC_PRESTATAIRE.includes(
                      values.type_tms,
                    )}
                    error={errors.prestataire_logistique_id}
                    className="md:col-span-2"
                    hint={
                      isEdition
                        ? 'Fixé à la création'
                        : prestataires === null
                          ? 'Liste des prestataires indisponible — rechargez la page'
                          : prestataires.length === 0
                            ? 'Aucun prestataire logistique enregistré — à créer par l’équipe technique'
                            : 'Société qui exécute les courses : c’est ce lien qui rattache les tournées au bon transporteur.'
                    }
                  >
                    <Combobox
                      id="tm_prestataire_logistique_id"
                      icon={null}
                      placeholder="Aucun"
                      value={values.prestataire_logistique_id}
                      onChange={(v) => set('prestataire_logistique_id', v)}
                      error={Boolean(errors.prestataire_logistique_id)}
                      disabled={isEdition}
                      options={[
                        { value: '', label: 'Aucun' },
                        ...(lienHorsListe
                          ? [
                              {
                                value: values.prestataire_logistique_id,
                                label:
                                  'Prestataire rattaché (liste indisponible)',
                              },
                            ]
                          : []),
                        ...optionsPrestataires.map((p) => {
                          // Rattaché à un AUTRE transporteur : grisé (l'index
                          // unique le refuserait). Le sien reste choisissable.
                          const pris =
                            p.transporteur_id !== null &&
                            p.transporteur_id !== transporteur?.id;
                          return {
                            value: p.id,
                            label: `${p.nom}${p.statut !== 'actif' ? ` (${p.statut})` : ''}${pris ? ` — déjà rattaché à ${p.transporteur_nom}` : ''}`,
                            disabled: pris,
                          };
                        }),
                      ]}
                    />
                  </FormField>
                </div>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-savr-neutral-200 px-6 py-4 md:px-8">
          {serverError && (
            <p role="alert" className="mr-auto text-sm text-savr-error-strong">
              {serverError}
            </p>
          )}
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
              // Contour rouge, comme « Annuler la collecte » du pop-up collecte.
              <Button
                type="button"
                variant="secondary"
                onClick={() => void handleToggleActif()}
                disabled={submitting}
                className={ACTION_DESTRUCTIVE_CONTOUR}
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
        </footer>
      </form>
    </Modal>
  );
}
