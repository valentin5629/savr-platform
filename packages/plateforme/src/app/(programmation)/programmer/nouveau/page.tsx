'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useUserRole } from '@/lib/use-user-role';
import {
  ChevronLeft,
  ChevronRight,
  Save,
  CheckCircle,
  PlusCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { FormField } from '@/components/ui/form-field';
import { FormError } from '@/components/ui/form-error';
import { Modal } from '@/components/ui/modal';
import { AlertBar } from '@/components/ui/alert-bar';
import { FormStepIndicator } from '@/components/programmation/form-step-indicator';
import {
  LieuCombobox,
  type LieuOption,
} from '@/components/programmation/lieu-combobox';
import {
  LieuChampsEditables,
  lieuToEdits,
  computeLieuOverrides,
  type LieuEdits,
} from '@/components/programmation/lieu-champs-editables';
import { LieuManuelForm } from '@/components/programmation/lieu-manuel-form';
import {
  ContactCombobox,
  type ContactOption,
} from '@/components/programmation/contact-combobox';
import {
  SousBlocCollecte,
  type CollecteFormData,
} from '@/components/programmation/sous-bloc-collecte';
import { useSignalZdSelection } from '@/components/layout/logo-context';

const STEPS = [
  { label: 'Événement' },
  { label: 'Lieu & contacts' },
  { label: 'Collecte(s)' },
];

interface TypeEvenement {
  id: string;
  code: string;
  libelle: string;
}

interface TraiteurOption {
  id: string;
  nom: string;
  raison_sociale: string;
  siret: string | null;
}

interface PackInfo {
  pack_actif: boolean;
  credits_initiaux?: number;
  credits_consommes?: number;
  credits_restants?: number;
}

// Source de pré-remplissage « Dupliquer » (?from=) — sous-ensemble du GET
// /api/v1/traiteur/collectes/:id.
interface SourceLieu {
  id: string;
  nom: string | null;
  adresse_acces: string | null;
  code_postal: string | null;
  ville: string | null;
}
interface SourceEvenement {
  pax: number | null;
  type_evenement_id: string | null;
  nom_client_organisateur: string | null;
  reference_affaire: string | null;
  contact_principal_nom: string | null;
  contact_principal_telephone: string | null;
  contact_secours_nom: string | null;
  contact_secours_telephone: string | null;
  lieu: SourceLieu | SourceLieu[] | null;
}
interface SourceCollecte {
  type: string;
  heure_collecte: string | null;
  controle_acces_requis: boolean;
  informations_supplementaires: string | null;
  evenement: SourceEvenement | SourceEvenement[] | null;
}

const emptyCollecte = (type: 'zd' | 'ag'): CollecteFormData => ({
  type,
  date_collecte: '',
  heure_collecte: '',
  informations_supplementaires: '',
});

// Liste des collectes propre à chaque rôle programmateur — cible de redirection
// après confirmation (la collecte créée y apparaît). L'admin en support voit toutes
// les collectes (dont celle créée pour le traiteur cible) dans /admin/collectes.
const COLLECTES_PATH_BY_ROLE: Record<string, string> = {
  admin_savr: '/admin/collectes',
  ops_savr: '/admin/collectes',
  traiteur_manager: '/traiteur/collectes',
  traiteur_commercial: '/traiteur/collectes',
  agence: '/agence/collectes',
  gestionnaire_lieux: '/gestionnaire/collectes',
};

export default function NouveauProgrammationPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Rôle courant (nécessaire pour UI agence/gestionnaire/admin). Lu via
  // useUserRole (décodage `atob` navigateur) — l'ancien décodage `Buffer.from`
  // échouait côté client (Buffer hors bundle) → rôle jamais détecté, sélecteur
  // traiteur/admin masqué.
  const role = useUserRole() ?? '';
  // Admin support : programmation « pour le compte d'un traiteur » (§06.01 l.15).
  const isAdmin = role === 'admin_savr' || role === 'ops_savr';
  const needsTraiteurSelector =
    role === 'agence' || role === 'gestionnaire_lieux' || isAdmin;

  // Traiteur cible du sélecteur : traiteur opérant (agence / gestionnaire_lieux)
  // ou organisation cible (admin support). Une seule state pour les trois rôles ;
  // c'est le submit qui route la valeur vers le bon champ du body.
  const [traiteurOperationnelId, setTraiteurOperationnelId] = useState('');
  const [traiteurs, setTraiteurs] = useState<TraiteurOption[]>([]);
  // Org cible à propager aux sous-requêtes lieux/contacts — admin support seulement
  // (le param cross-org n'est honoré que pour le staff côté route).
  const adminTargetOrgId =
    isAdmin && traiteurOperationnelId ? traiteurOperationnelId : undefined;

  // Étape 1
  const [nomClient, setNomClient] = useState('');
  const [pax, setPax] = useState('');
  const [typeEvenementId, setTypeEvenementId] = useState('');
  const [typesEvenements, setTypesEvenements] = useState<TypeEvenement[]>([]);
  const [typesCollecte, setTypesCollecte] = useState<{
    zd: boolean;
    ag: boolean;
  }>({ zd: false, ag: false });
  // Logo Savr vert dès qu'on sélectionne le ZD ; retour à l'orange sinon.
  useSignalZdSelection(typesCollecte.zd);
  const [referenceAffaire, setReferenceAffaire] = useState('');
  const [packAg, setPackAg] = useState<PackInfo | null>(null);
  const [agBloque, setAgBloque] = useState(false);

  // Étape 2
  const [lieu, setLieu] = useState<LieuOption | null>(null);
  // PROG-01 : champs lieu éditables (override per-collecte). `lieuBase` = valeurs de
  // référence à la sélection ; `lieuEdits` = valeurs courantes ; le diff = lieu_overrides.
  const [lieuBase, setLieuBase] = useState<LieuEdits | null>(null);
  const [lieuEdits, setLieuEdits] = useState<LieuEdits | null>(null);
  const [controleAcces, setControleAcces] = useState(false);
  // PROG-02 : création d'un traiteur « hors référentiel » (shadow) — agence uniquement.
  const [showShadowModal, setShowShadowModal] = useState(false);
  const [shadowForm, setShadowForm] = useState({
    raison_sociale: '',
    nom_commercial: '',
    siret: '',
  });
  const [shadowError, setShadowError] = useState<string | null>(null);

  const applyLieu = useCallback((l: LieuOption | null) => {
    setLieu(l);
    if (l) {
      const edits = lieuToEdits(l);
      setLieuBase(edits);
      setLieuEdits(edits);
    } else {
      setLieuBase(null);
      setLieuEdits(null);
    }
  }, []);
  const [contactPrincipal, setContactPrincipal] =
    useState<ContactOption | null>(null);
  const [contactSecours, setContactSecours] = useState<ContactOption | null>(
    null,
  );
  const [showLieuManuel, setShowLieuManuel] = useState(false);
  const [showContactForm, setShowContactForm] = useState<
    'principal' | 'secours' | null
  >(null);
  const [newContact, setNewContact] = useState({
    prenom: '',
    nom: '',
    telephone: '',
    fonction: '',
  });

  // Étape 3
  const [collectes, setCollectes] = useState<CollecteFormData[]>([]);

  useEffect(() => {
    void fetch('/api/v1/programmation/types-evenements')
      .then((r) => r.json() as Promise<TypeEvenement[]>)
      .then(setTypesEvenements);
  }, []);

  // Pré-remplissage « Dupliquer » (?from=<collecteId>) — décision Val 2026-07-05.
  // Charge la collecte source et pré-remplit le formulaire ; la date reste vide
  // (nouvelle date à choisir). Rien n'est créé tant que l'utilisateur ne valide
  // pas. Le sync-effect typesCollecte→collectes conserve la ligne pré-remplie
  // (même type). Erreur/absence = formulaire vierge (dégradation gracieuse).
  useEffect(() => {
    const from =
      typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('from')
        : null;
    if (!from) return;
    void fetch(`/api/v1/traiteur/collectes/${from}`)
      .then((r) =>
        r.ok ? (r.json() as Promise<{ data?: SourceCollecte }>) : null,
      )
      .then((j) => {
        const d = j?.data;
        if (!d) return;
        const evt = Array.isArray(d.evenement) ? d.evenement[0] : d.evenement;
        if (!evt) return;
        const lieuSrc = Array.isArray(evt.lieu) ? evt.lieu[0] : evt.lieu;
        const isZd = d.type === 'zero_dechet';
        setNomClient(evt.nom_client_organisateur ?? '');
        setPax(evt.pax != null ? String(evt.pax) : '');
        setTypeEvenementId(evt.type_evenement_id ?? '');
        setReferenceAffaire(evt.reference_affaire ?? '');
        setControleAcces(Boolean(d.controle_acces_requis));
        if (lieuSrc) {
          applyLieu({
            id: lieuSrc.id,
            nom: lieuSrc.nom ?? '',
            adresse_acces: lieuSrc.adresse_acces ?? '',
            ville: lieuSrc.ville ?? '',
            code_postal: lieuSrc.code_postal ?? '',
            controle_acces_requis_default: false,
          });
        }
        if (evt.contact_principal_nom) {
          setContactPrincipal({
            id: '',
            prenom: '',
            nom: evt.contact_principal_nom,
            telephone: evt.contact_principal_telephone ?? '',
          });
        }
        if (evt.contact_secours_nom) {
          setContactSecours({
            id: '',
            prenom: '',
            nom: evt.contact_secours_nom,
            telephone: evt.contact_secours_telephone ?? '',
          });
        }
        setTypesCollecte({ zd: isZd, ag: !isZd });
        setCollectes([
          {
            type: isZd ? 'zd' : 'ag',
            date_collecte: '',
            heure_collecte: (d.heure_collecte ?? '').slice(0, 5),
            informations_supplementaires: d.informations_supplementaires ?? '',
          },
        ]);
      })
      .catch(() => {});
  }, [applyLieu]);

  // Chargement des traiteurs pour les rôles qui programment pour le compte d'un
  // tiers (agence / gestionnaire_lieux) ou en support (admin_savr / ops_savr).
  useEffect(() => {
    if (
      role === 'agence' ||
      role === 'gestionnaire_lieux' ||
      role === 'admin_savr' ||
      role === 'ops_savr'
    ) {
      void fetch('/api/v1/programmation/organisations/traiteurs')
        .then((res) => res.json() as Promise<TraiteurOption[]>)
        .then(setTraiteurs);
    }
  }, [role]);

  // Sync collectes array when type selection changes
  useEffect(() => {
    setCollectes((prev) => {
      const next: CollecteFormData[] = [];
      if (typesCollecte.zd) {
        next.push(prev.find((c) => c.type === 'zd') ?? emptyCollecte('zd'));
      }
      if (typesCollecte.ag) {
        next.push(prev.find((c) => c.type === 'ag') ?? emptyCollecte('ag'));
      }
      return next;
    });
  }, [typesCollecte]);

  // Pré-cocher contrôle accès si lieu l'impose
  useEffect(() => {
    if (lieu?.controle_acces_requis_default) setControleAcces(true);
  }, [lieu]);

  const checkPackAg = useCallback(async (): Promise<boolean> => {
    // Admin support : le pack ciblé est celui de l'organisation choisie, pas du
    // caller (admin n'a pas d'organisation propre) → on passe organisation_id.
    const url =
      isAdmin && traiteurOperationnelId
        ? `/api/v1/programmation/pack-ag?organisation_id=${traiteurOperationnelId}`
        : '/api/v1/programmation/pack-ag';
    const res = await fetch(url);
    const data = (await res.json()) as PackInfo;
    setPackAg(data);
    const bloque = !data.pack_actif || (data.credits_restants ?? 0) <= 0;
    setAgBloque(bloque);
    if (bloque) setTypesCollecte((prev) => ({ ...prev, ag: false }));
    return bloque;
  }, [isAdmin, traiteurOperationnelId]);

  const handleAgCheck = async (checked: boolean) => {
    if (checked) {
      const bloque = await checkPackAg();
      if (!bloque) setTypesCollecte((prev) => ({ ...prev, ag: true }));
    } else {
      setTypesCollecte((prev) => ({ ...prev, ag: false }));
    }
  };

  const step1Valid =
    nomClient.trim() !== '' &&
    parseInt(pax) > 0 &&
    typeEvenementId !== '' &&
    (typesCollecte.zd || typesCollecte.ag) &&
    (!needsTraiteurSelector || traiteurOperationnelId !== '');

  const step2Valid = lieu !== null && contactPrincipal !== null;

  const step3Valid = collectes.every(
    (c) => c.date_collecte !== '' && c.heure_collecte !== '',
  );

  const handleAddContactInline = async (target: 'principal' | 'secours') => {
    if (!newContact.prenom || !newContact.nom || !newContact.telephone) return;
    const res = await fetch('/api/v1/programmation/contacts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        adminTargetOrgId
          ? { ...newContact, organisation_id: adminTargetOrgId }
          : newContact,
      ),
    });
    if (!res.ok) return;
    const created = (await res.json()) as ContactOption;
    if (target === 'principal') setContactPrincipal(created);
    else setContactSecours(created);
    setShowContactForm(null);
    setNewContact({ prenom: '', nom: '', telephone: '', fonction: '' });
  };

  // PROG-02 : création d'un traiteur « hors référentiel » (shadow) — agence uniquement.
  const handleCreateShadow = async () => {
    setShadowError(null);
    if (
      !shadowForm.raison_sociale.trim() ||
      shadowForm.nom_commercial.trim().length < 2
    ) {
      setShadowError('Raison sociale et nom commercial (2 car. min) requis.');
      return;
    }
    const res = await fetch('/api/v1/programmation/organisations/shadow', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        raison_sociale: shadowForm.raison_sociale.trim(),
        nom_commercial: shadowForm.nom_commercial.trim(),
        siret: shadowForm.siret.trim() || undefined,
      }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setShadowError(j.error ?? 'Échec de la création du traiteur.');
      return;
    }
    const created = (await res.json()) as TraiteurOption;
    setTraiteurs((prev) => [created, ...prev]);
    setTraiteurOperationnelId(created.id);
    setShowShadowModal(false);
    setShadowForm({ raison_sociale: '', nom_commercial: '', siret: '' });
  };

  const handleSubmit = async (confirmer: boolean) => {
    setSubmitting(true);
    setError(null);
    try {
      // PROG-01 : override lieu = diff des champs édités vs référence (undefined si aucun).
      const lieuOverrides =
        lieuBase && lieuEdits ? computeLieuOverrides(lieuBase, lieuEdits) : {};
      const body = {
        nom_evenement: nomClient.trim() || undefined,
        nom_client_organisateur: nomClient.trim() || undefined,
        pax: parseInt(pax),
        type_evenement_id: typeEvenementId,
        reference_affaire: referenceAffaire || undefined,
        lieu_id: lieu!.id,
        lieu_overrides:
          Object.keys(lieuOverrides).length > 0 ? lieuOverrides : undefined,
        controle_acces_requis: controleAcces,
        contact_principal_nom:
          `${contactPrincipal!.prenom} ${contactPrincipal!.nom}`.trim(),
        contact_principal_telephone: contactPrincipal!.telephone,
        contact_secours_nom: contactSecours
          ? `${contactSecours.prenom} ${contactSecours.nom}`.trim()
          : undefined,
        contact_secours_telephone: contactSecours?.telephone,
        collectes: collectes.map((c) => ({
          type: c.type,
          date_collecte: c.date_collecte,
          heure_collecte: c.heure_collecte,
          informations_supplementaires:
            c.informations_supplementaires || undefined,
        })),
        confirmer,
        // Admin support : la valeur du sélecteur est l'organisation CIBLE
        // (organisation_id) ; le serveur en dérive le traiteur opérationnel.
        // Agence / gestionnaire : c'est le traiteur OPÉRANT (leur propre org
        // reste l'organisation_id, résolu côté serveur depuis le JWT).
        ...(isAdmin && traiteurOperationnelId
          ? { organisation_id: traiteurOperationnelId }
          : needsTraiteurSelector && traiteurOperationnelId
            ? { traiteur_operationnel_organisation_id: traiteurOperationnelId }
            : {}),
      };

      const res = await fetch('/api/v1/programmation/evenements', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = (await res.json()) as {
        evenement_id?: string;
        error?: string;
      };

      if (!res.ok) {
        setError(data.error ?? 'Erreur lors de la programmation');
        return;
      }

      // Confirmée → liste des collectes du rôle (la nouvelle collecte y figure).
      // Brouillon → liste des brouillons.
      const collectesPath =
        COLLECTES_PATH_BY_ROLE[role] ?? '/traiteur/collectes';
      router.push(confirmer ? collectesPath : '/brouillons');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <FormStepIndicator steps={STEPS} current={step} />

      {/* ── Étape 1 : Événement ── */}
      {step === 0 && (
        <Card className="p-6 space-y-5">
          <h2 className="text-lg font-semibold text-savr-neutral-900">
            Informations sur l'événement
          </h2>

          <FormField label="Nom du client final" htmlFor="nom-client" required>
            <Input
              id="nom-client"
              value={nomClient}
              onChange={(e) => setNomClient(e.target.value)}
              placeholder="Ex : Entreprise Dupont"
            />
          </FormField>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Nombre de convives" htmlFor="pax" required>
              <Input
                id="pax"
                type="number"
                min="1"
                value={pax}
                onChange={(e) => setPax(e.target.value)}
                placeholder="Ex : 80"
              />
            </FormField>

            <FormField
              label="Type d'événement"
              htmlFor="type-evenement"
              required
            >
              <Select
                id="type-evenement"
                value={typeEvenementId}
                onChange={(e) => setTypeEvenementId(e.target.value)}
              >
                <option value="">Choisir…</option>
                {typesEvenements.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.libelle}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>

          <div className="space-y-2">
            <Label required>Type(s) de collecte</Label>
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <Checkbox
                  id="type-zd"
                  checked={typesCollecte.zd}
                  onCheckedChange={(c) =>
                    setTypesCollecte((p) => ({ ...p, zd: c === true }))
                  }
                />
                <label htmlFor="type-zd" className="text-sm cursor-pointer">
                  <span className="font-medium">Zéro Déchet (ZD)</span>
                  <span className="text-savr-neutral-500 ml-1">
                    — compostage / méthanisation
                  </span>
                </label>
              </div>

              <div className="flex items-start gap-3">
                <Checkbox
                  id="type-ag"
                  className="mt-0.5"
                  checked={typesCollecte.ag}
                  onCheckedChange={(c) => void handleAgCheck(c === true)}
                />
                <label htmlFor="type-ag" className="text-sm cursor-pointer">
                  <span className="font-medium">Anti-Gaspi (AG)</span>
                  <span className="text-savr-neutral-500 ml-1">
                    — don à association
                  </span>
                  {agBloque && (
                    <FormError className="mt-0.5">
                      Aucun pack AG actif — décochez cette option pour
                      continuer.
                    </FormError>
                  )}
                </label>
              </div>
            </div>
          </div>

          <FormField label="Référence client (optionnel)" htmlFor="ref-client">
            <Input
              id="ref-client"
              value={referenceAffaire}
              onChange={(e) => setReferenceAffaire(e.target.value)}
              placeholder="Ex : CMD-2026-042"
            />
          </FormField>

          {needsTraiteurSelector && (
            <FormField
              label={
                isAdmin ? 'Traiteur (pour le compte de)' : 'Traiteur opérant'
              }
              htmlFor="traiteur-select"
              required
              hint={
                isAdmin
                  ? 'Programmation de support — la collecte sera créée au nom de ce traiteur.'
                  : undefined
              }
            >
              <Select
                id="traiteur-select"
                value={traiteurOperationnelId}
                onChange={(e) => setTraiteurOperationnelId(e.target.value)}
              >
                <option value="">Choisir un traiteur…</option>
                {traiteurs.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nom || t.raison_sociale}
                  </option>
                ))}
              </Select>
              {/* PROG-02 : option « hors référentiel » — agence uniquement (CDC
                  §06.01 l.280 : le gestionnaire de lieux n'a PAS cette option). */}
              {role === 'agence' && (
                <button
                  type="button"
                  onClick={() => setShowShadowModal(true)}
                  className="mt-2 flex items-center gap-1 text-sm font-medium text-savr-primary-700 hover:underline"
                >
                  <PlusCircle className="h-4 w-4" />
                  Ajouter un traiteur hors référentiel
                </button>
              )}
            </FormField>
          )}

          {/* PROG-02 : modal création traiteur shadow (hors référentiel) */}
          <Modal
            open={showShadowModal}
            title="Traiteur hors référentiel"
            onClose={() => setShowShadowModal(false)}
            footer={
              <>
                <Button
                  variant="secondary"
                  onClick={() => setShowShadowModal(false)}
                >
                  Annuler
                </Button>
                <Button
                  onClick={() => void handleCreateShadow()}
                  disabled={
                    !shadowForm.raison_sociale.trim() ||
                    shadowForm.nom_commercial.trim().length < 2
                  }
                >
                  Créer le traiteur
                </Button>
              </>
            }
          >
            <div className="space-y-4">
              <p className="text-xs text-savr-neutral-500">
                Une fiche traiteur provisoire sera créée et signalée à Savr pour
                vérification.
              </p>
              <FormField label="Nom commercial" htmlFor="shadow-nom" required>
                <Input
                  id="shadow-nom"
                  value={shadowForm.nom_commercial}
                  onChange={(e) =>
                    setShadowForm((p) => ({
                      ...p,
                      nom_commercial: e.target.value,
                    }))
                  }
                  placeholder="Nom commercial"
                />
              </FormField>
              <FormField label="Raison sociale" htmlFor="shadow-rs" required>
                <Input
                  id="shadow-rs"
                  value={shadowForm.raison_sociale}
                  onChange={(e) =>
                    setShadowForm((p) => ({
                      ...p,
                      raison_sociale: e.target.value,
                    }))
                  }
                  placeholder="Raison sociale"
                />
              </FormField>
              <FormField
                label="SIRET"
                htmlFor="shadow-siret"
                hint="Fortement recommandé"
              >
                <Input
                  id="shadow-siret"
                  value={shadowForm.siret}
                  onChange={(e) =>
                    setShadowForm((p) => ({ ...p, siret: e.target.value }))
                  }
                  placeholder="123 456 789 00012"
                />
              </FormField>
              {!shadowForm.siret.trim() && (
                <p className="text-xs text-savr-error-strong">
                  Sans SIRET, le bordereau réglementaire ne pourra pas être
                  généré et le traiteur opérationnel ne sera pas conforme aux
                  obligations de traçabilité déchets.
                </p>
              )}
              {shadowError && <FormError>{shadowError}</FormError>}
            </div>
          </Modal>

          <div className="flex justify-end pt-1">
            <Button onClick={() => setStep(1)} disabled={!step1Valid}>
              Continuer
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </Card>
      )}

      {/* ── Étape 2 : Lieu & contacts ── */}
      {step === 1 && (
        <Card className="p-6 space-y-5">
          <h2 className="text-lg font-semibold text-savr-neutral-900">
            Lieu et contacts
          </h2>

          <FormField label="Lieu de collecte" htmlFor="lieu-combobox" required>
            <LieuCombobox
              value={lieu}
              onChange={applyLieu}
              onAddManuel={() => setShowLieuManuel(true)}
              organisationId={adminTargetOrgId}
            />
          </FormField>

          {/* PROG-01 : champs du lieu pré-remplis et éditables (override per-collecte) */}
          {lieu && lieuEdits && (
            <LieuChampsEditables edits={lieuEdits} onChange={setLieuEdits} />
          )}

          {/* Lieu manuel — modal DS */}
          <Modal
            open={showLieuManuel}
            title="Ajouter un lieu manuellement"
            onClose={() => setShowLieuManuel(false)}
          >
            <LieuManuelForm
              onSave={(l) => {
                applyLieu(l);
                setShowLieuManuel(false);
              }}
              onCancel={() => setShowLieuManuel(false)}
              organisationId={adminTargetOrgId}
            />
          </Modal>

          <div className="space-y-2">
            <Label>Contrôle d'accès</Label>
            <div className="flex items-start gap-3">
              <Checkbox
                id="controle-acces"
                className="mt-0.5"
                checked={controleAcces}
                onCheckedChange={(c) => setControleAcces(c === true)}
              />
              <label
                htmlFor="controle-acces"
                className="text-sm cursor-pointer text-savr-neutral-700"
              >
                Plaque d'immatriculation et nom du chauffeur requis pour ce lieu
              </label>
            </div>
          </div>

          <FormField
            label="Contact principal sur place"
            htmlFor="contact-principal"
            required
          >
            <ContactCombobox
              value={contactPrincipal}
              onChange={setContactPrincipal}
              onAddInline={() => setShowContactForm('principal')}
              organisationId={adminTargetOrgId}
            />
          </FormField>

          <FormField
            label="Contact secours (optionnel)"
            htmlFor="contact-secours"
          >
            <ContactCombobox
              value={contactSecours}
              onChange={setContactSecours}
              onAddInline={() => setShowContactForm('secours')}
              label="Ajouter un contact secours…"
              organisationId={adminTargetOrgId}
            />
          </FormField>

          {/* Contact inline form — modal DS */}
          <Modal
            open={showContactForm !== null}
            title="Nouveau contact"
            onClose={() => setShowContactForm(null)}
            footer={
              <>
                <Button
                  variant="secondary"
                  onClick={() => setShowContactForm(null)}
                >
                  Annuler
                </Button>
                <Button
                  onClick={() =>
                    showContactForm &&
                    void handleAddContactInline(showContactForm)
                  }
                  disabled={
                    !newContact.prenom ||
                    !newContact.nom ||
                    !newContact.telephone
                  }
                >
                  Ajouter
                </Button>
              </>
            }
          >
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField label="Prénom" htmlFor="contact-prenom" required>
                  <Input
                    id="contact-prenom"
                    value={newContact.prenom}
                    onChange={(e) =>
                      setNewContact((p) => ({ ...p, prenom: e.target.value }))
                    }
                    placeholder="Prénom"
                  />
                </FormField>
                <FormField label="Nom" htmlFor="contact-nom" required>
                  <Input
                    id="contact-nom"
                    value={newContact.nom}
                    onChange={(e) =>
                      setNewContact((p) => ({ ...p, nom: e.target.value }))
                    }
                    placeholder="Nom"
                  />
                </FormField>
              </div>
              <FormField label="Téléphone" htmlFor="contact-tel" required>
                <Input
                  id="contact-tel"
                  type="tel"
                  value={newContact.telephone}
                  onChange={(e) =>
                    setNewContact((p) => ({ ...p, telephone: e.target.value }))
                  }
                  placeholder="06 12 34 56 78"
                />
              </FormField>
              <FormField
                label="Fonction (optionnel)"
                htmlFor="contact-fonction"
              >
                <Input
                  id="contact-fonction"
                  value={newContact.fonction}
                  onChange={(e) =>
                    setNewContact((p) => ({ ...p, fonction: e.target.value }))
                  }
                  placeholder="Ex : Responsable salle"
                />
              </FormField>
            </div>
          </Modal>

          <div className="flex justify-between pt-1">
            <Button variant="ghost" onClick={() => setStep(0)}>
              <ChevronLeft className="h-4 w-4" />
              Retour
            </Button>
            <Button onClick={() => setStep(2)} disabled={!step2Valid}>
              Continuer
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </Card>
      )}

      {/* ── Étape 3 : Collectes + récapitulatif ── */}
      {step === 2 && (
        <Card className="p-6 space-y-5">
          <h2 className="text-lg font-semibold text-savr-neutral-900">
            Détails de la collecte
          </h2>

          {collectes.map((c, i) => (
            <SousBlocCollecte
              key={c.type}
              type={c.type}
              data={c}
              onChange={(updated) =>
                setCollectes((prev) =>
                  prev.map((item, idx) => (idx === i ? updated : item)),
                )
              }
              pack={c.type === 'ag' ? packAg : undefined}
            />
          ))}

          {/* Récapitulatif */}
          <div className="rounded-savr-md border border-savr-neutral-200 bg-savr-neutral-50 p-4 space-y-2 text-sm">
            <h3 className="font-semibold text-savr-neutral-900">
              Récapitulatif
            </h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-savr-neutral-700">
              <dt className="text-savr-neutral-500">Client</dt>
              <dd>{nomClient}</dd>
              <dt className="text-savr-neutral-500">Convives</dt>
              <dd>{pax}</dd>
              <dt className="text-savr-neutral-500">Lieu</dt>
              <dd>
                {lieu?.nom} — {lieu?.ville}
              </dd>
              <dt className="text-savr-neutral-500">Contact principal</dt>
              <dd>
                {contactPrincipal?.prenom} {contactPrincipal?.nom}
              </dd>
            </dl>
          </div>

          <p className="text-xs text-savr-neutral-500">
            Toute collecte annulée à moins de 12h de l'heure de collecte donne
            lieu à facturation plein tarif — pour une collecte Anti-Gaspi sous
            pack, un crédit est décompté (cf. CGV).
          </p>

          {error && <AlertBar variant="err">{error}</AlertBar>}

          <div className="flex flex-col sm:flex-row justify-between gap-3 pt-1">
            <Button variant="ghost" onClick={() => setStep(1)}>
              <ChevronLeft className="h-4 w-4" />
              Retour
            </Button>
            <div className="flex gap-3">
              <Button
                variant="secondary"
                onClick={() => void handleSubmit(false)}
                disabled={!step3Valid || submitting}
              >
                <Save className="h-4 w-4" />
                Enregistrer en brouillon
              </Button>
              <Button
                onClick={() => void handleSubmit(true)}
                disabled={!step3Valid || submitting}
              >
                <CheckCircle className="h-4 w-4" />
                Confirmer la programmation
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
