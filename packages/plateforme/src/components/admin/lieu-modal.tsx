'use client';

import * as React from 'react';
import {
  Building2,
  ChefHat,
  History,
  ImageIcon,
  KeyRound,
  Lock,
  MapPin,
  Truck,
} from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { AlertBar } from '@/components/ui/alert-bar';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Combobox } from '@/components/ui/combobox';
import { FormField } from '@/components/ui/form-field';
import { Switch } from '@/components/ui/switch';
import { Timeline, TimelineItem } from '@/components/ui/timeline';
import { Tabs, TabsContent, TabsList } from '@/components/ui/tabs';
import {
  BlocHeader,
  EnTeteMention,
  EnTetePuce,
  FicheEnTete,
  OngletAvecErreurs,
} from '@/components/collecte/fiche-blocs';
import { DIFFICULTE_LABEL, VEHICULE_LABEL } from '@/lib/lieux-labels';
import { Text } from '@/components/ui/text';

// Modale création/édition d'un lieu — remplace la fiche + les pages nouveau/modifier
// (point unique, ouverte depuis la liste /admin/lieux). En édition, les champs sont
// hydratés par GET /api/v1/admin/lieux/{id} (seul endroit qui expose le gestionnaire
// rattaché via organisations_lieux). Miroir de TransporteurModal (#252/#254).
// Cadre commun des fiches Admin (décisions Val 2026-09-30) : grand en-tête
// (FicheEnTete) puis onglets seuls, sans colonne — Informations / Accès &
// logistique / Interne Savr / Activité (édition seule). Un seul « Enregistrer »
// pour tous les onglets : les valeurs vivent dans l'état du formulaire.

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
  gestionnaire_nom?: string | null;
  commentaire_lieu: string | null;
  commentaires_internes: string | null;
  siren: string | null;
  email_gestionnaire: string | null;
  reference_citeo: boolean;
}

// Réponse de GET /api/v1/admin/lieux/{id}/activite (onglet Activité).
interface ActiviteApi {
  traiteurs: { id: string; nom: string; nb_collectes: number }[];
  historique: {
    // audit_log.id = bigint (nombre en JSON).
    id: number | string;
    created_at: string;
    action: string;
    auteur: string | null;
    champs: string[];
    impersonation: boolean;
  }[];
  /** true = seules les écritures les plus récentes sont renvoyées. */
  historique_tronque: boolean;
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
  // Admin/ops only (RLS column-level) — onglet « Interne Savr ».
  commentaire_lieu: string;
  commentaires_internes: string;
  siren: string;
  email_gestionnaire: string;
  reference_citeo: boolean;
}

type Onglet = 'informations' | 'acces' | 'interne' | 'activite';

// Onglet qui porte chaque champ validé : à l'enregistrement, la modale ouvre le
// premier onglet en erreur (décision Val C4) — sinon « Créer » semble ne rien faire.
const ONGLET_DU_CHAMP: Record<string, Onglet> = {
  nom: 'informations',
  adresse_acces: 'informations',
  code_postal: 'informations',
  ville: 'informations',
  type_vehicule_max: 'acces',
  siren: 'interne',
};
const ONGLETS: { value: Onglet; label: string }[] = [
  { value: 'informations', label: 'Informations' },
  { value: 'acces', label: 'Accès & logistique' },
  { value: 'interne', label: 'Interne Savr' },
  // Lieu existant seulement (rien à montrer en création).
  { value: 'activite', label: 'Activité' },
];

const OPTIONS_DIFFICULTE = [
  { value: '', label: 'Non renseigné' },
  ...Object.entries(DIFFICULTE_LABEL).map(([value, label]) => ({
    value,
    label,
  })),
];

const OPTIONS_VEHICULE = Object.entries(VEHICULE_LABEL).map(
  ([value, label]) => ({ value, label }),
);

// Libellés de l'historique (onglet Activité) — mêmes intitulés que le formulaire.
const LIBELLE_ACTION: Record<string, string> = {
  INSERT: 'Création du lieu',
  UPDATE: 'Modification',
  NORMALISE: 'Lieu normalisé',
  lieu_override_programmation: 'Modification signalée à la programmation',
};

const LIBELLE_CHAMP: Record<string, string> = {
  nom: 'Nom du lieu',
  nom_alternatif: 'Nom alternatif',
  adresse_acces: 'Adresse accès livraison',
  code_postal: 'Code postal',
  ville: 'Ville',
  region: 'Région',
  acces_office: 'Accès office',
  stationnement: 'Stationnement',
  type_vehicule_max: 'Type de véhicule max',
  controle_acces_requis_default: "Contrôle d'accès requis",
  capacite_maximum: 'Capacité maximum',
  volume_max_bacs: 'Volume max',
  contraintes_horaires: 'Contraintes horaires',
  acces_details: "Carnet d'accès terrain",
  flux_autorises: 'Flux autorisés',
  photos_urls: 'Photos',
  actif: 'Actif',
  commentaire_lieu: 'Commentaire sur le lieu',
  commentaires_internes: 'Notes internes',
  siren: 'SIREN',
  email_gestionnaire: 'Mail gestionnaire du lieu',
  reference_citeo: 'Référencé Citeo',
};

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

// Interrupteur DS « Switch » + libellé cliquable.
function Interrupteur({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    // Toute la ligne est le libellé : zone cliquable de 44 px de haut (DS §10 Accessibilité).
    <label
      className="inline-flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium text-savr-neutral-700"
      htmlFor={id}
    >
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
      {label}
    </label>
  );
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
  // Lieu tel que chargé : l'en-tête le décrit (stable pendant la saisie).
  const [lieuCharge, setLieuCharge] = React.useState<LieuApi | null>(null);
  const [onglet, setOnglet] = React.useState<Onglet>('informations');
  const [gestionnaires, setGestionnaires] = React.useState<OrgOption[]>([]);
  const [activite, setActivite] = React.useState<ActiviteApi | null>(null);
  const [activiteErreur, setActiviteErreur] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const ongletsRef = React.useRef<Partial<Record<Onglet, HTMLButtonElement>>>(
    {},
  );
  const alerteRef = React.useRef<HTMLDivElement>(null);
  // Chargement du lieu en échec : pas de formulaire, rien d'enregistrable.
  const [chargementEchoue, setChargementEchoue] = React.useState(false);

  // Liste des organisations gestionnaires de lieux (sélecteur mono) — à l'ouverture.
  React.useEffect(() => {
    if (!open) return;
    void fetch('/api/v1/admin/organisations?type=gestionnaire_lieux&actif=true')
      .then((r) => r.json())
      .then((j: { data?: OrgOption[] }) => setGestionnaires(j.data ?? []))
      .catch(() => setGestionnaires([]));
  }, [open]);

  // (Ré)initialise / hydrate le formulaire à chaque ouverture ou changement de cible.
  // `obsolete` écarte la réponse tardive d'un lieu précédent (fermer A puis ouvrir
  // B avant la réponse de A) : sinon B afficherait — et enregistrerait — A.
  React.useEffect(() => {
    if (!open) return;
    let obsolete = false;
    setErrors({});
    setServerError(null);
    setChargementEchoue(false);
    setOnglet('informations');
    setLieuCharge(null);
    setValues(VIDE);
    if (lieuId) {
      void fetch(`/api/v1/admin/lieux/${encodeURIComponent(lieuId)}`)
        .then((r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.json() as Promise<LieuApi>;
        })
        .then((d) => {
          if (obsolete) return;
          setValues(toForm(d));
          setLieuCharge(d);
        })
        .catch(() => {
          if (!obsolete) setChargementEchoue(true);
        });
    }
    return () => {
      obsolete = true;
    };
  }, [open, lieuId]);

  // Onglet Activité (édition seule) : traiteurs opérant + historique.
  React.useEffect(() => {
    setActivite(null);
    setActiviteErreur(false);
    if (!open || !lieuId) return;
    let obsolete = false;
    void fetch(`/api/v1/admin/lieux/${encodeURIComponent(lieuId)}/activite`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<ActiviteApi>;
      })
      .then((a) => {
        if (!obsolete) setActivite(a);
      })
      .catch(() => {
        if (!obsolete) setActiviteErreur(true);
      });
    return () => {
      obsolete = true;
    };
  }, [open, lieuId]);

  // L'erreur serveur vit en tête du corps : la ramener à l'écran quand on a
  // fait défiler un onglet long.
  React.useEffect(() => {
    if (serverError) alerteRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [serverError]);

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    // Un champ corrigé perd son erreur, et son onglet son compteur, sans
    // attendre le prochain envoi.
    setErrors((e) =>
      key in e
        ? Object.fromEntries(
            Object.entries(e).filter(([champ]) => champ !== key),
          )
        : e,
    );
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
    const premierOngletEnErreur = ONGLETS.find(({ value }) =>
      Object.keys(next).some((champ) => ONGLET_DU_CHAMP[champ] === value),
    )?.value;
    if (premierOngletEnErreur) {
      setOnglet(premierOngletEnErreur);
      // Le focus recale l'onglet atteignable au clavier de Radix (sinon
      // Maj+Tab rouvrirait l'ancien onglet et cacherait les erreurs) et fait
      // annoncer le changement aux lecteurs d'écran.
      ongletsRef.current[premierOngletEnErreur]?.focus();
    }
    return Object.keys(next).length === 0;
  }

  function nbErreurs(o: Onglet): number {
    return Object.keys(errors).filter((champ) => ONGLET_DU_CHAMP[champ] === o)
      .length;
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
      ? `/api/v1/admin/lieux/${encodeURIComponent(lieuId!)}`
      : '/api/v1/admin/lieux';
    let res: Response;
    try {
      res = await fetch(url, {
        method: isEdition ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload()),
      });
    } catch {
      setServerError('Enregistrement impossible : vérifiez votre connexion');
      return;
    } finally {
      setSubmitting(false);
    }

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

  // Liste des gestionnaires actifs + le gestionnaire chargé s'il n'y figure pas
  // (ex. organisation désactivée).
  const gestionnaireCharge: OrgOption | null =
    lieuCharge?.gestionnaire_organisation_id
      ? {
          id: lieuCharge.gestionnaire_organisation_id,
          raison_sociale: lieuCharge.gestionnaire_nom ?? null,
        }
      : null;
  const optionsGestionnaires =
    gestionnaireCharge &&
    !gestionnaires.some((g) => g.id === gestionnaireCharge.id)
      ? [...gestionnaires, gestionnaireCharge]
      : gestionnaires;

  // Dérivés du lieu chargé : chargement en cours, photos (R2, lecture seule —
  // upload hors formulaire, jamais renvoyées au PATCH).
  const hydrating = isEdition && !lieuCharge && !chargementEchoue;
  const photos = lieuCharge?.photos_urls ?? [];

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
        disabled={submitting || (isEdition && !lieuCharge)}
        loading={submitting}
        loadingText="Enregistrement…"
      >
        {isEdition ? 'Enregistrer' : 'Créer le lieu'}
      </Button>
    </>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        isEdition
          ? lieuCharge
            ? `Fiche lieu — ${lieuCharge.nom}`
            : 'Fiche lieu'
          : 'Nouveau lieu'
      }
      // Même cadre que la fiche transporteur : grand en-tête fixe dans le
      // corps, qui défile en dessous ; hauteur fixe dès md, la modale ne
      // change ni de taille ni de place d'un onglet à l'autre.
      hideTitle
      bodyClassName="flex min-h-0 flex-col overflow-hidden p-0"
      className="max-w-5xl md:h-[min(90vh,48rem)]"
      footer={footer}
    >
      {isEdition ? (
        lieuCharge ? (
          <FicheEnTete
            surtitre={
              (lieuCharge.region || lieuCharge.gestionnaire_nom) && (
                <>
                  {lieuCharge.region && (
                    <EnTetePuce>
                      {lieuCharge.region === 'idf' ? 'IDF' : 'Province'}
                    </EnTetePuce>
                  )}
                  {lieuCharge.gestionnaire_nom && (
                    <EnTeteMention>{lieuCharge.gestionnaire_nom}</EnTeteMention>
                  )}
                </>
              )
            }
            titre={lieuCharge.nom}
            infos={[
              {
                icon: MapPin,
                texte:
                  [lieuCharge.ville, lieuCharge.code_postal]
                    .filter(Boolean)
                    .join(' ') || '—',
              },
              {
                icon: Truck,
                texte:
                  VEHICULE_LABEL[lieuCharge.type_vehicule_max] ??
                  lieuCharge.type_vehicule_max,
              },
            ]}
            statut={
              lieuCharge.actif ? (
                <Badge variant="success">Actif</Badge>
              ) : (
                <Badge variant="action">À normaliser</Badge>
              )
            }
          />
        ) : (
          // Chargement ou échec : un en-tête quand même (titre visible, place
          // de la croix de fermeture réservée, pas de saut à l'arrivée).
          <FicheEnTete titre="Fiche lieu" />
        )
      ) : (
        <FicheEnTete
          titre="Nouveau lieu"
          description="Renseignez les onglets, puis créez le lieu."
        />
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 md:px-8">
        {hydrating ? (
          <Text className="py-8 text-center">Chargement du lieu…</Text>
        ) : chargementEchoue ? (
          <AlertBar variant="err" role="alert">
            Erreur lors du chargement du lieu. Fermez la fiche et réessayez.
          </AlertBar>
        ) : (
          <form onSubmit={handleFormSubmit} noValidate>
            {/* En tête du corps : visible quel que soit l'onglet et le défilement. */}
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
                {ONGLETS.filter((o) => isEdition || o.value !== 'activite').map(
                  ({ value, label }) => (
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
                  ),
                )}
              </TabsList>

              <TabsContent value="informations" className="space-y-4">
                <Card padding="md" className="space-y-4">
                  <BlocHeader icon={Building2} title="Identité" />
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
                    <FormField
                      label="Nom alternatif"
                      htmlFor="lm_nom_alternatif"
                    >
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
                      <Combobox
                        id="lm_gestionnaire"
                        icon={null}
                        placeholder="Aucun"
                        value={values.gestionnaire_organisation_id}
                        onChange={(v) => set('gestionnaire_organisation_id', v)}
                        options={[
                          { value: '', label: 'Aucun' },
                          ...optionsGestionnaires.map((g) => ({
                            value: g.id,
                            label: g.raison_sociale ?? g.nom ?? g.id,
                          })),
                        ]}
                      />
                    </FormField>
                  </div>
                  <Interrupteur
                    id="lm_actif"
                    label="Actif"
                    checked={values.actif}
                    onChange={(v) => set('actif', v)}
                  />
                </Card>

                <Card padding="md" className="space-y-4">
                  <BlocHeader icon={MapPin} title="Adresse" />
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
                      <Combobox
                        id="lm_region"
                        icon={null}
                        placeholder="Non renseignée"
                        value={values.region}
                        onChange={(v) =>
                          set('region', v as FormValues['region'])
                        }
                        options={[
                          { value: '', label: 'Non renseignée' },
                          { value: 'idf', label: 'Île-de-France' },
                          { value: 'province', label: 'Province' },
                        ]}
                      />
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
                </Card>
              </TabsContent>

              <TabsContent value="acces" className="space-y-4">
                <Card padding="md" className="space-y-4">
                  <BlocHeader icon={KeyRound} title="Accès au lieu" />
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <FormField
                      label="Type de véhicule max"
                      htmlFor="lm_type_vehicule_max"
                      required
                      error={errors.type_vehicule_max}
                      hint="Tous les véhicules ≤ max sont acceptés"
                    >
                      <Combobox
                        id="lm_type_vehicule_max"
                        icon={null}
                        required
                        value={values.type_vehicule_max}
                        onChange={(v) =>
                          set(
                            'type_vehicule_max',
                            v as FormValues['type_vehicule_max'],
                          )
                        }
                        error={Boolean(errors.type_vehicule_max)}
                        options={OPTIONS_VEHICULE}
                      />
                    </FormField>
                    <FormField label="Accès office" htmlFor="lm_acces_office">
                      <Combobox
                        id="lm_acces_office"
                        icon={null}
                        placeholder="Non renseigné"
                        value={values.acces_office}
                        onChange={(v) =>
                          set('acces_office', v as FormValues['acces_office'])
                        }
                        options={OPTIONS_DIFFICULTE}
                      />
                    </FormField>
                    <FormField label="Stationnement" htmlFor="lm_stationnement">
                      <Combobox
                        id="lm_stationnement"
                        icon={null}
                        placeholder="Non renseigné"
                        value={values.stationnement}
                        onChange={(v) =>
                          set('stationnement', v as FormValues['stationnement'])
                        }
                        options={OPTIONS_DIFFICULTE}
                      />
                    </FormField>
                  </div>
                  <Interrupteur
                    id="lm_controle_acces"
                    label="Contrôle d'accès requis (plaque + nom chauffeur)"
                    checked={values.controle_acces_requis_default}
                    onChange={(v) => set('controle_acces_requis_default', v)}
                  />
                  <FormField
                    label="Carnet d'accès terrain"
                    htmlFor="lm_acces_details"
                    hint="Badge, code, interphone, contact gardien, digicode parking, notes stationnement — partagé au transporteur"
                  >
                    <Textarea
                      id="lm_acces_details"
                      rows={3}
                      value={values.acces_details}
                      onChange={(e) => set('acces_details', e.target.value)}
                    />
                  </FormField>
                </Card>

                <Card padding="md" className="space-y-4">
                  <BlocHeader icon={Truck} title="Capacité et contraintes" />
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <FormField
                      label="Capacité maximum"
                      htmlFor="lm_capacite_maximum"
                    >
                      <Input
                        id="lm_capacite_maximum"
                        type="number"
                        min={0}
                        value={values.capacite_maximum}
                        onChange={(e) =>
                          set('capacite_maximum', e.target.value)
                        }
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
                        onChange={(e) =>
                          set('contraintes_horaires', e.target.value)
                        }
                      />
                    </FormField>
                  </div>
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
                </Card>

                {/* Photos — lecture seule (upload géré hors formulaire, stockage R2). */}
                {photos.length > 0 && (
                  <Card padding="md" className="space-y-3">
                    <BlocHeader
                      icon={ImageIcon}
                      title={`Photos (${photos.length})`}
                    />
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
                  </Card>
                )}
              </TabsContent>

              {/* Admin / Ops (RLS column-level — invisible côté client, §06.06 §7). */}
              <TabsContent value="interne" className="space-y-4">
                <AlertBar variant="info" icon={<Lock className="h-4 w-4" />}>
                  Ces informations ne sont jamais montrées aux clients
                  (traiteur, agence, gestionnaire, client organisateur).
                </AlertBar>
                <Card padding="md" className="space-y-4">
                  <BlocHeader icon={Lock} title="Réservé à l'équipe Savr" />
                  <FormField
                    label="Commentaire sur le lieu"
                    htmlFor="lm_commentaire_lieu"
                    hint="Note opérationnelle, contexte commercial, alerte"
                  >
                    <Textarea
                      id="lm_commentaire_lieu"
                      rows={3}
                      value={values.commentaire_lieu}
                      onChange={(e) => set('commentaire_lieu', e.target.value)}
                    />
                  </FormField>
                  <FormField
                    label="Notes internes"
                    htmlFor="lm_commentaires_internes"
                    hint="Notes opérationnelles Admin (technique migration, contexte historique)"
                  >
                    <Textarea
                      id="lm_commentaires_internes"
                      rows={3}
                      value={values.commentaires_internes}
                      onChange={(e) =>
                        set('commentaires_internes', e.target.value)
                      }
                    />
                  </FormField>
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
                        onChange={(e) =>
                          set('email_gestionnaire', e.target.value)
                        }
                      />
                    </FormField>
                  </div>
                  <Interrupteur
                    id="lm_reference_citeo"
                    label="Référencé Citeo (REP emballages)"
                    checked={values.reference_citeo}
                    onChange={(v) => set('reference_citeo', v)}
                  />
                </Card>
              </TabsContent>

              {isEdition && (
                <TabsContent value="activite" className="space-y-4">
                  {activiteErreur ? (
                    <AlertBar variant="err">
                      Impossible de charger l&apos;activité du lieu.
                    </AlertBar>
                  ) : !activite ? (
                    <Text className="py-6 text-center">
                      Chargement de l&apos;activité…
                    </Text>
                  ) : (
                    <>
                      <Card padding="md" className="space-y-4">
                        <BlocHeader icon={ChefHat} title="Traiteurs opérant" />
                        {activite.traiteurs.length === 0 ? (
                          <Text>
                            Aucune collecte sur ce lieu pour l&apos;instant.
                          </Text>
                        ) : (
                          <ul className="divide-y divide-savr-neutral-100 text-sm">
                            {activite.traiteurs.map((t) => (
                              <li
                                key={t.id}
                                className="flex items-center justify-between gap-3 py-2"
                              >
                                <span className="font-medium text-savr-neutral-900">
                                  {t.nom}
                                </span>
                                <span className="shrink-0 text-savr-neutral-600">
                                  {t.nb_collectes}{' '}
                                  {t.nb_collectes > 1
                                    ? 'collectes'
                                    : 'collecte'}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </Card>

                      <Card padding="md" className="space-y-4">
                        <BlocHeader
                          icon={History}
                          title="Historique des modifications"
                        />
                        {activite.historique.length === 0 ? (
                          <Text>
                            Aucune modification enregistrée sur ce lieu.
                          </Text>
                        ) : (
                          <Timeline>
                            {activite.historique.map((h) => (
                              <TimelineItem key={h.id}>
                                <Text tone="strong" className="font-medium">
                                  {LIBELLE_ACTION[h.action] ?? h.action}
                                </Text>
                                {h.champs.length > 0 ? (
                                  <Text tone="soft">
                                    {h.champs
                                      .map((c) => LIBELLE_CHAMP[c] ?? c)
                                      .join(', ')}
                                  </Text>
                                ) : (
                                  h.action === 'UPDATE' && (
                                    <Text>
                                      Aucun champ du lieu modifié (le
                                      gestionnaire rattaché a pu changer)
                                    </Text>
                                  )
                                )}
                                <Text variant="hint">
                                  {new Date(h.created_at).toLocaleString(
                                    'fr-FR',
                                    { timeZone: 'Europe/Paris' },
                                  )}
                                  {h.auteur ? ` · ${h.auteur}` : ''}
                                  {h.impersonation ? ' · (impersonation)' : ''}
                                </Text>
                              </TimelineItem>
                            ))}
                          </Timeline>
                        )}
                        {activite.historique_tronque && (
                          <Text variant="hint">
                            Seules les {activite.historique.length}{' '}
                            modifications les plus récentes sont affichées.
                          </Text>
                        )}
                      </Card>
                    </>
                  )}
                </TabsContent>
              )}
            </Tabs>
          </form>
        )}
      </div>
    </Modal>
  );
}
