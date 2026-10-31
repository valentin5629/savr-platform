'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useUserRole } from '@/lib/use-user-role';
import { isStaff } from '@/lib/roles';
import { ROUTES } from '@/lib/routes';
import {
  CaretLeftIcon,
  CaretRightIcon,
  CheckCircleIcon,
  FloppyDiskIcon,
  InfoIcon,
  MinusIcon,
  PlusCircleIcon,
  PlusIcon,
} from '@/components/ui/icones';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { IconButton } from '@/components/ui/icon-button';
import { Combobox } from '@/components/ui/combobox';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { FormField } from '@/components/ui/form-field';
import { FormError } from '@/components/ui/form-error';
import { FormGrid } from '@/components/ui/form-grid';
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
import type { ContactOption } from '@/components/programmation/contact-combobox';
import {
  CarteCollecte,
  type TypeEvenementOption,
} from '@/components/programmation/carte-collecte';
import {
  usePackAg,
  factureeAlUnite,
  PACK_PROPRE,
} from '@/components/programmation/use-pack-ag';
import { useSignalZdSelection } from '@/components/layout/logo-context';
import { Heading } from '@/components/ui/heading';
import { Text } from '@/components/ui/text';
import { TextLink } from '@/components/ui/text-link';
import { FormActions } from '@/components/ui/form-actions';
import {
  libelleCompletTypeCollecte,
  libelleTypeCollecte,
} from '@/lib/libelles/type-collecte';
import {
  PLAFOND_PAR_TYPE,
  ajouterCarte,
  ajusterNombre,
  carteComplete,
  carteVersCorps,
  cartesDepuis,
  clesEnDoublon,
  contactDepuis,
  indexModele,
  libelleCarte,
  modifierCarte,
  nombreParType,
  valeursEffectives,
  type CarteSaisie,
} from '@/lib/programmation/cartes-saisie';

// Formulaire en deux écrans, puis une page de confirmation (§06.01, refonte
// Val 2026-10-22).
export const ECRAN_EVENEMENT = "Informations sur l'événement";
export const ECRAN_COLLECTES = 'Informations sur les collectes';
const STEPS = [{ label: ECRAN_EVENEMENT }, { label: ECRAN_COLLECTES }];

interface TraiteurOption {
  id: string;
  // Libellé unique côté rôles clients (nom commercial, ou raison sociale à défaut) ;
  // la route ne rend raison_sociale / siret qu'au staff (§06.05).
  nom: string;
  raison_sociale?: string;
  siret?: string | null;
}

// Source de pré-remplissage « Dupliquer » (?from=) — sous-ensemble du GET
// /api/v1/traiteur/collectes/:id ou /api/v1/agence/collectes/:id (même chargeur
// de fiche client ; l'agence y lit en plus le traiteur opérationnel).
interface SourceLieu {
  id: string;
  nom: string | null;
  adresse_acces: string | null;
  code_postal: string | null;
  ville: string | null;
}
interface SourceEvenement {
  nom_evenement: string | null;
  nom_client_organisateur: string | null;
  reference_affaire: string | null;
  lieu: SourceLieu | SourceLieu[] | null;
}
interface SourceCollecte {
  type: string;
  type_evenement_id?: string | null;
  contact_principal_nom?: string | null;
  contact_principal_telephone?: string | null;
  contact_secours_nom?: string | null;
  contact_secours_telephone?: string | null;
  heure_collecte: string | null;
  pax?: number | null;
  controle_acces_requis: boolean;
  informations_supplementaires: string | null;
  evenement: SourceEvenement | SourceEvenement[] | null;
  /** GET agence seulement (§06.11 différence #3). */
  traiteur_operationnel?: { id: string; nom: string | null } | null;
}

// Brouillon repris (GET /api/v1/programmation/evenements/:id).
interface BrouillonLieu {
  nom: string | null;
  adresse_acces: string | null;
  code_postal: string | null;
  ville: string | null;
  acces_details?: string | null;
  controle_acces_requis_default?: boolean | null;
}
interface BrouillonCollecte {
  type: string;
  statut: string;
  date_collecte: string | null;
  heure_collecte: string | null;
  pax: number | null;
  type_evenement_id: string | null;
  informations_supplementaires: string | null;
  lieu_overrides: Record<string, unknown> | null;
  contacts: {
    contact_principal_nom: string | null;
    contact_principal_telephone: string | null;
    contact_secours_nom: string | null;
    contact_secours_telephone: string | null;
  } | null;
}
interface Brouillon {
  organisation_id: string;
  lieu_id: string;
  nom_evenement: string | null;
  nom_client_organisateur: string | null;
  reference_affaire: string | null;
  controle_acces_requis: boolean;
  traiteur_operationnel: { id: string; nom: string } | null;
  organisation?: { id: string; nom: string } | null;
  lieux: BrouillonLieu | BrouillonLieu[] | null;
  collectes: BrouillonCollecte[];
}

const LIEU_EDITABLE = [
  'adresse_acces',
  'code_postal',
  'ville',
  'acces_details',
];

/**
 * Formulaire de programmation (refonte, lot B2 ; décisions Val 2026-10-22 et
 * 2026-10-24) :
 *   · écran 1 — événement, lieu, contrôle d'accès, nombre de collectes par type
 *     (au plus 10 de chaque) ;
 *   · écran 2 — une carte par collecte (date, heure, convives, type
 *     d'événement, contacts, informations), qui reprend la collecte n°1 champ
 *     par champ tant qu'on ne la modifie pas ; « Ajouter une collecte » ;
 *     « Enregistrer en brouillon » (écran 2 seulement, B2-Q1) et « Confirmer ».
 * Avec `brouillonId`, rouvre un brouillon dans son état complet, modifiable
 * (B2-Q2) : l'enregistrement remplace ses collectes.
 */
export function FormulaireProgrammation({
  brouillonId,
}: {
  brouillonId?: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Rôle courant (nécessaire pour UI agence/gestionnaire/admin), décodé côté
  // navigateur (useUserRole).
  const role = useUserRole() ?? '';
  // Admin support : programmation « pour le compte d'un traiteur » (§06.01).
  const isAdmin = isStaff(role);
  const needsTraiteurSelector =
    role === 'agence' || role === 'gestionnaire_lieux' || isAdmin;

  // Traiteur cible du sélecteur : traiteur opérant (agence / gestionnaire_lieux)
  // ou organisation cible (admin support). C'est le submit qui route la valeur
  // vers le bon champ du corps.
  const [traiteurOperationnelId, setTraiteurOperationnelId] = useState('');
  const [traiteurs, setTraiteurs] = useState<TraiteurOption[]>([]);
  // Traiteur déjà choisi (duplication, brouillon) : la liste du sélecteur est
  // plafonnée et exclut les fiches shadow, on l'y ajoute au rendu.
  const [traiteurSource, setTraiteurSource] = useState<TraiteurOption | null>(
    null,
  );
  const optionsTraiteurs =
    traiteurSource && !traiteurs.some((t) => t.id === traiteurSource.id)
      ? [traiteurSource, ...traiteurs]
      : traiteurs;
  // Org cible à propager aux sous-requêtes lieux/contacts — admin support seulement.
  const adminTargetOrgId =
    isAdmin && traiteurOperationnelId ? traiteurOperationnelId : undefined;

  // Écran 1
  const [nomEvenement, setNomEvenement] = useState('');
  const [nomClient, setNomClient] = useState('');
  const [referenceAffaire, setReferenceAffaire] = useState('');
  const [lieu, setLieu] = useState<LieuOption | null>(null);
  // Champs du lieu éditables (override de la programmation) : `lieuBase` =
  // valeurs du référentiel ; `lieuEdits` = valeurs courantes ; le diff =
  // lieu_overrides.
  const [lieuBase, setLieuBase] = useState<LieuEdits | null>(null);
  const [lieuEdits, setLieuEdits] = useState<LieuEdits | null>(null);
  const [controleAcces, setControleAcces] = useState(false);
  const [showLieuManuel, setShowLieuManuel] = useState(false);
  const [showShadowModal, setShowShadowModal] = useState(false);
  const [shadowForm, setShadowForm] = useState({
    raison_sociale: '',
    nom_commercial: '',
    siret: '',
  });
  const [shadowError, setShadowError] = useState<string | null>(null);

  // Écran 2 : cartes saisies (valeurs propres) ; affichées = reprise de la
  // collecte n°1 comprise.
  const [cartes, setCartes] = useState<CarteSaisie[]>([]);
  const affichees = valeursEffectives(cartes);
  const nbZd = nombreParType(cartes, 'zd');
  const nbAg = nombreParType(cartes, 'ag');
  // Nombre de collectes par type : compteur − / + de 0 à 10 (retour Val du
  // 2026-10-26, remplace le champ de saisie). Diminuer retire la dernière
  // carte du type ; les autres gardent ce qui y a été saisi.
  const changerNombre = (type: 'zd' | 'ag', n: number) =>
    setCartes((prev) => ajusterNombre(prev, type, n));
  const [typesEvenements, setTypesEvenements] = useState<TypeEvenementOption[]>(
    [],
  );
  const [ajoutOuvert, setAjoutOuvert] = useState(false);
  const [contactCible, setContactCible] = useState<{
    cle: string;
    role: 'principal' | 'secours';
  } | null>(null);
  const [newContact, setNewContact] = useState({
    prenom: '',
    nom: '',
    telephone: '',
    fonction: '',
  });
  const [brouillonIllisible, setBrouillonIllisible] = useState<string | null>(
    null,
  );
  // Traiteurs d'un brouillon repris : l'organisation programmatrice (choix de
  // l'équipe Savr, figé) et le traiteur opérant (agence, gestionnaire).
  const [traiteursBrouillon, setTraiteursBrouillon] = useState<{
    organisation: TraiteurOption;
    operant: TraiteurOption | null;
  } | null>(null);

  // Logo Savr vert dès qu'une collecte Zéro Déchet est demandée.
  useSignalZdSelection(nbZd > 0);

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

  useEffect(() => {
    void fetch('/api/v1/programmation/types-evenements')
      .then((r) => r.json() as Promise<TypeEvenementOption[]>)
      .then(setTypesEvenements)
      .catch(() => {});
  }, []);

  // Traiteurs des rôles qui programment pour le compte d'un tiers (agence /
  // gestionnaire_lieux) ou en support (admin_savr / ops_savr).
  useEffect(() => {
    if (role === 'agence' || role === 'gestionnaire_lieux' || isStaff(role)) {
      void fetch('/api/v1/programmation/organisations/traiteurs')
        .then((res) => res.json() as Promise<TraiteurOption[]>)
        .then(setTraiteurs)
        .catch(() => {});
    }
  }, [role]);

  // Pré-cocher le contrôle d'accès si le lieu l'impose.
  useEffect(() => {
    if (lieu?.controle_acces_requis_default) setControleAcces(true);
  }, [lieu]);

  // Pré-remplissage « Dupliquer » (?from=<collecteId>) — décision Val 2026-07-05.
  // Une carte du type de la collecte source, avec son type d'événement et ses
  // contacts ; la date reste vide. `from` vient de l'URL : encodé avant d'être
  // injecté comme segment de chemin (revue rls-securite #285). La route source
  // dépend du rôle : on attend que le rôle soit lu, puis on charge UNE fois.
  const prefillCharge = useRef(false);
  useEffect(() => {
    if (brouillonId) return;
    const from =
      typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('from')
        : null;
    if (!from || !role || prefillCharge.current) return;
    prefillCharge.current = true;
    const source =
      role === 'agence'
        ? `/api/v1/agence/collectes/${encodeURIComponent(from)}`
        : `/api/v1/traiteur/collectes/${encodeURIComponent(from)}`;
    void fetch(source)
      .then((r) =>
        r.ok ? (r.json() as Promise<{ data?: SourceCollecte }>) : null,
      )
      .then((j) => {
        const d = j?.data;
        if (!d) return;
        const evt = Array.isArray(d.evenement) ? d.evenement[0] : d.evenement;
        if (!evt) return;
        const traiteurOp = d.traiteur_operationnel;
        if (traiteurOp) {
          setTraiteurSource({ id: traiteurOp.id, nom: traiteurOp.nom ?? '' });
          setTraiteurOperationnelId(traiteurOp.id);
        }
        const lieuSrc = Array.isArray(evt.lieu) ? evt.lieu[0] : evt.lieu;
        setNomEvenement(evt.nom_evenement ?? '');
        setNomClient(evt.nom_client_organisateur ?? '');
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
        setCartes(
          cartesDepuis([
            {
              type: d.type === 'zero_dechet' ? 'zd' : 'ag',
              date_collecte: '',
              heure_collecte: (d.heure_collecte ?? '').slice(0, 5),
              // Pax de la collecte dupliquée ; inconnu (0) : champ vide.
              pax: d.pax != null && d.pax > 0 ? String(d.pax) : '',
              type_evenement_id: d.type_evenement_id ?? '',
              contact_principal: contactDepuis(
                d.contact_principal_nom,
                d.contact_principal_telephone,
              ),
              contact_secours: contactDepuis(
                d.contact_secours_nom,
                d.contact_secours_telephone,
              ),
              informations_supplementaires:
                d.informations_supplementaires ?? '',
            },
          ]),
        );
      })
      .catch(() => {});
  }, [applyLieu, role, brouillonId]);

  // Reprise d'un brouillon (B2-Q2) : l'événement et toutes ses cartes.
  useEffect(() => {
    if (!brouillonId || prefillCharge.current) return;
    prefillCharge.current = true;
    void fetch(
      `/api/v1/programmation/evenements/${encodeURIComponent(brouillonId)}`,
    )
      .then((r) => (r.ok ? (r.json() as Promise<Brouillon>) : null))
      .then((b) => {
        if (!b) {
          setBrouillonIllisible('Brouillon introuvable.');
          return;
        }
        if (
          b.collectes.length === 0 ||
          b.collectes.some((c) => c.statut !== 'brouillon')
        ) {
          setBrouillonIllisible(
            "Cet événement n'est plus un brouillon : il a déjà été confirmé.",
          );
          return;
        }
        setNomEvenement(b.nom_evenement ?? '');
        setNomClient(b.nom_client_organisateur ?? '');
        setReferenceAffaire(b.reference_affaire ?? '');
        setControleAcces(Boolean(b.controle_acces_requis));
        setTraiteursBrouillon({
          organisation: b.organisation ?? { id: b.organisation_id, nom: '' },
          operant: b.traiteur_operationnel,
        });
        const lieuSrc = Array.isArray(b.lieux) ? b.lieux[0] : b.lieux;
        if (lieuSrc) {
          const option: LieuOption = {
            id: b.lieu_id,
            nom: lieuSrc.nom ?? '',
            adresse_acces: lieuSrc.adresse_acces ?? '',
            ville: lieuSrc.ville ?? '',
            code_postal: lieuSrc.code_postal ?? '',
            acces_details: lieuSrc.acces_details ?? null,
            controle_acces_requis_default: Boolean(
              lieuSrc.controle_acces_requis_default,
            ),
          };
          const base = lieuToEdits(option);
          const overrides = b.collectes[0]?.lieu_overrides ?? {};
          const edits = { ...base };
          for (const k of LIEU_EDITABLE) {
            const v = overrides[k];
            if (typeof v === 'string') (edits as Record<string, string>)[k] = v;
          }
          setLieu(option);
          setLieuBase(base);
          setLieuEdits(edits);
        }
        setCartes(
          cartesDepuis(
            b.collectes.map((c) => ({
              type:
                c.type === 'zero_dechet' ? ('zd' as const) : ('ag' as const),
              date_collecte: c.date_collecte ?? '',
              heure_collecte: (c.heure_collecte ?? '').slice(0, 5),
              pax: c.pax != null && c.pax > 0 ? String(c.pax) : '',
              type_evenement_id: c.type_evenement_id ?? '',
              contact_principal: contactDepuis(
                c.contacts?.contact_principal_nom,
                c.contacts?.contact_principal_telephone,
              ),
              contact_secours: contactDepuis(
                c.contacts?.contact_secours_nom,
                c.contacts?.contact_secours_telephone,
              ),
              informations_supplementaires:
                c.informations_supplementaires ?? '',
            })),
          ),
        );
      })
      .catch(() => setBrouillonIllisible('Brouillon illisible.'));
  }, [brouillonId]);

  // Sélecteur de traiteur d'un brouillon repris, une fois le rôle lu : pour
  // l'équipe Savr, l'organisation pour le compte de laquelle elle programme
  // (figée) ; pour l'agence et le gestionnaire, le traiteur opérant.
  useEffect(() => {
    if (!traiteursBrouillon || role === '') return;
    const choix = isStaff(role)
      ? traiteursBrouillon.organisation
      : traiteursBrouillon.operant;
    if (!choix) return;
    setTraiteurSource(choix);
    setTraiteurOperationnelId(choix.id);
  }, [traiteursBrouillon, role]);

  // Pack AG de l'organisation programmatrice : informatif, jamais bloquant —
  // sans pack actif, la collecte AG est facturée à l'unité (décision Val
  // 2026-10-16). Programmation de support : le pack est celui du traiteur choisi.
  const packAg = usePackAg(
    nbAg === 0 || role === ''
      ? null
      : isAdmin
        ? traiteurOperationnelId || null
        : PACK_PROPRE,
  );
  const agSansPack = nbAg > 0 && packAg !== null && factureeAlUnite(packAg);

  const ecran1Valide =
    nomEvenement.trim() !== '' &&
    nomClient.trim() !== '' &&
    lieu !== null &&
    nbZd + nbAg >= 1 &&
    (!needsTraiteurSelector || traiteurOperationnelId !== '');
  const ecran2Valide =
    affichees.length >= 1 && affichees.every((c) => carteComplete(c));
  const doublons = clesEnDoublon(affichees);
  const iModele = indexModele(cartes);

  const changerCarte =
    (cle: string) =>
    <K extends keyof CarteSaisie>(champ: K, valeur: CarteSaisie[K]) =>
      setCartes((prev) => modifierCarte(prev, cle, champ, valeur));

  const handleAddContactInline = async () => {
    if (!contactCible) return;
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
    setCartes((prev) =>
      modifierCarte(
        prev,
        contactCible.cle,
        contactCible.role === 'principal'
          ? 'contact_principal'
          : 'contact_secours',
        created,
      ),
    );
    setContactCible(null);
    setNewContact({ prenom: '', nom: '', telephone: '', fonction: '' });
  };

  // Création d'un traiteur « hors référentiel » (shadow) — agence uniquement.
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
      const lieuOverrides =
        lieuBase && lieuEdits ? computeLieuOverrides(lieuBase, lieuEdits) : {};
      const body = {
        nom_evenement: nomEvenement.trim() || undefined,
        nom_client_organisateur: nomClient.trim() || undefined,
        reference_affaire: referenceAffaire || undefined,
        lieu_id: lieu!.id,
        lieu_overrides:
          Object.keys(lieuOverrides).length > 0 ? lieuOverrides : undefined,
        controle_acces_requis: controleAcces,
        collectes: affichees.map(carteVersCorps),
        confirmer,
        // Admin support : la valeur du sélecteur est l'organisation CIBLE
        // (organisation_id ; figée sur un brouillon repris). Agence /
        // gestionnaire : c'est le traiteur OPÉRANT.
        ...(isAdmin && traiteurOperationnelId
          ? brouillonId
            ? {}
            : { organisation_id: traiteurOperationnelId }
          : needsTraiteurSelector && traiteurOperationnelId
            ? { traiteur_operationnel_organisation_id: traiteurOperationnelId }
            : {}),
      };

      const res = await fetch(
        brouillonId
          ? `/api/v1/programmation/evenements/${encodeURIComponent(brouillonId)}/brouillon`
          : '/api/v1/programmation/evenements',
        {
          method: brouillonId ? 'PUT' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
      );

      const data = (await res.json()) as {
        evenement_id?: string;
        error?: string;
      };

      if (!res.ok) {
        setError(data.error ?? 'Erreur lors de la programmation');
        return;
      }

      // Confirmée → écran de confirmation dédié (§06.01 point 13).
      // Brouillon → liste des brouillons.
      if (confirmer) {
        router.push(
          `${ROUTES.programmer.confirmation}?id=${encodeURIComponent(data.evenement_id ?? '')}`,
        );
      } else {
        router.push(ROUTES.brouillons);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (brouillonIllisible) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <AlertBar variant="err">{brouillonIllisible}</AlertBar>
        <TextLink href={ROUTES.brouillons}>Retour aux brouillons</TextLink>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <FormStepIndicator steps={STEPS} current={step} />

      {/* ── Écran 1 : Informations sur l'événement ── */}
      {step === 0 && (
        <Card padding="lg" className={CARTE_FORMULAIRE}>
          <Heading level={2}>{ECRAN_EVENEMENT}</Heading>

          <FormField
            label="Nom de l'événement"
            htmlFor="nom-evenement"
            required
          >
            <Input
              id="nom-evenement"
              required
              value={nomEvenement}
              onChange={(e) => setNomEvenement(e.target.value)}
              placeholder="Ex : Séminaire annuel"
            />
          </FormField>

          <FormGrid>
            <FormField label="Client final" htmlFor="nom-client" required>
              <Input
                id="nom-client"
                required
                value={nomClient}
                onChange={(e) => setNomClient(e.target.value)}
                placeholder="Ex : Entreprise Dupont"
              />
            </FormField>

            {/* « Référence interne » (décision Val 2026-10-22) : même donnée,
                evenements.reference_affaire. */}
            <FormField
              label="Référence interne (optionnel)"
              htmlFor="ref-client"
            >
              <Input
                id="ref-client"
                value={referenceAffaire}
                onChange={(e) => setReferenceAffaire(e.target.value)}
                placeholder="Ex : CMD-2026-042"
              />
            </FormField>
          </FormGrid>

          {needsTraiteurSelector && (
            <FormField
              label={
                isAdmin ? 'Traiteur (pour le compte de)' : 'Traiteur opérant'
              }
              htmlFor="traiteur-select"
              required
              hint={
                isAdmin
                  ? brouillonId
                    ? 'Programmation de support — le traiteur d’un brouillon ne change pas.'
                    : 'Programmation de support — la collecte sera créée au nom de ce traiteur.'
                  : undefined
              }
            >
              <Combobox
                id="traiteur-select"
                icon={null}
                required
                disabled={isAdmin && Boolean(brouillonId)}
                placeholder="Choisir un traiteur…"
                searchPlaceholder="Rechercher un traiteur…"
                options={optionsTraiteurs.map((t) => ({
                  value: t.id,
                  label: t.nom || t.raison_sociale || '',
                }))}
                value={traiteurOperationnelId}
                onChange={setTraiteurOperationnelId}
              />
              {/* Option « hors référentiel » — agence uniquement (§06.01 :
                  le gestionnaire de lieux ne l'a PAS). */}
              {role === 'agence' && (
                <TextLink
                  onClick={() => setShowShadowModal(true)}
                  className="mt-2 flex text-sm font-medium"
                >
                  <PlusCircleIcon className="h-4 w-4" />
                  Ajouter un traiteur hors référentiel
                </TextLink>
              )}
            </FormField>
          )}

          <Modal
            open={showShadowModal}
            title="Traiteur hors référentiel"
            onClose={() => setShowShadowModal(false)}
            footer={
              <FormActions
                cancel={{
                  label: 'Annuler',
                  onClick: () => setShowShadowModal(false),
                }}
                submit={{
                  label: 'Créer le traiteur',
                  onClick: () => void handleCreateShadow(),
                  disabled:
                    !shadowForm.raison_sociale.trim() ||
                    shadowForm.nom_commercial.trim().length < 2,
                }}
              />
            }
          >
            <div className="space-y-4">
              <Text variant="hint">
                Une fiche traiteur provisoire sera créée et signalée à Savr pour
                vérification.
              </Text>
              <FormField label="Nom commercial" htmlFor="shadow-nom" required>
                <Input
                  id="shadow-nom"
                  required
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
                  required
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

          <FormField label="Lieu de collecte" htmlFor="lieu-combobox" required>
            <LieuCombobox
              value={lieu}
              onChange={applyLieu}
              onAddManuel={() => setShowLieuManuel(true)}
              organisationId={adminTargetOrgId}
            />
          </FormField>

          {/* Champs du lieu pré-remplis et éditables (override de la programmation). */}
          {lieu && lieuEdits && (
            <LieuChampsEditables edits={lieuEdits} onChange={setLieuEdits} />
          )}

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
            <div className="flex items-center gap-3">
              <Checkbox
                id="controle-acces"
                checked={controleAcces}
                onCheckedChange={(c) => setControleAcces(c === true)}
              />
              <Label variant="choice" htmlFor="controle-acces">
                Plaque d'immatriculation et nom du chauffeur requis pour ce lieu
              </Label>
            </div>
          </div>

          {/* Nombre de collectes souhaitées par type (décision Val 2026-10-22),
              au moins une au total, au plus 10 de chaque (B2-Q4). */}
          {/* Espace de 48 px (au lieu de 20) avant le nombre de collectes,
              pour le détacher du contrôle d'accès (retours Val du
              2026-10-26). Marge et non padding : le padding d'un fieldset
              passe sous sa légende. */}
          <fieldset className="mt-12 space-y-2">
            <legend>
              <Label required>Nombre de collectes souhaitées</Label>
            </legend>
            <FormGrid>
              <FormField
                label={libelleTypeCollecte('zero_dechet')}
                htmlFor="nombre-zd"
                className="text-center"
              >
                <CompteurCollectes
                  id="nombre-zd"
                  libelle={libelleTypeCollecte('zero_dechet')}
                  valeur={nbZd}
                  onChange={(n) => changerNombre('zd', n)}
                />
              </FormField>
              <FormField
                label={libelleTypeCollecte('anti_gaspi')}
                htmlFor="nombre-ag"
                className="text-center"
              >
                <CompteurCollectes
                  id="nombre-ag"
                  libelle={libelleTypeCollecte('anti_gaspi')}
                  valeur={nbAg}
                  describedBy={agSansPack ? 'nombre-ag-info' : undefined}
                  onChange={(n) => changerNombre('ag', n)}
                />
              </FormField>
            </FormGrid>
            {agSansPack && (
              <Text
                id="nombre-ag-info"
                variant="hint"
                tone="inherit"
                role="status"
                className="flex items-center gap-1 text-savr-info-strong"
              >
                <InfoIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Pas de pack Anti-Gaspi actif : les collectes Anti-Gaspi seront
                facturées à l&apos;unité.
              </Text>
            )}
          </fieldset>

          <div className="flex justify-end pt-1">
            <Button onClick={() => setStep(1)} disabled={!ecran1Valide}>
              Continuer
              <CaretRightIcon />
            </Button>
          </div>
        </Card>
      )}

      {/* ── Écran 2 : Informations sur les collectes (sans récapitulatif,
          décision Val 2026-10-16 : il est montré après confirmation) ── */}
      {step === 1 && (
        <Card padding="lg" className={CARTE_FORMULAIRE}>
          <Heading level={2}>{ECRAN_COLLECTES}</Heading>

          {affichees.map((c, i) => {
            const libelle = libelleCarte(affichees, c.cle);
            const rang = libelle.split('#')[1] ?? String(i + 1);
            return (
              <CarteCollecte
                key={c.cle}
                carte={c}
                libelle={libelle}
                suffixe={`${c.type}-${rang}`}
                estModele={i === iModele}
                typesEvenements={typesEvenements}
                pack={c.type === 'ag' ? packAg : undefined}
                doublon={doublons.has(c.cle)}
                organisationId={adminTargetOrgId}
                onChange={changerCarte(c.cle)}
                onAjouterContact={(r) =>
                  setContactCible({ cle: c.cle, role: r })
                }
              />
            );
          })}

          <div className="space-y-2">
            {!ajoutOuvert ? (
              <Button variant="secondary" onClick={() => setAjoutOuvert(true)}>
                <PlusCircleIcon />
                Ajouter une collecte
              </Button>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Text tone="soft">Type de la collecte à ajouter :</Text>
                {(['zd', 'ag'] as const).map((type) => (
                  <Button
                    key={type}
                    variant="secondary"
                    disabled={nombreParType(cartes, type) >= PLAFOND_PAR_TYPE}
                    onClick={() => {
                      setCartes((prev) => ajouterCarte(prev, type));
                      setAjoutOuvert(false);
                    }}
                  >
                    {libelleCompletTypeCollecte(
                      type === 'zd' ? 'zero_dechet' : 'anti_gaspi',
                    )}
                  </Button>
                ))}
                <Button variant="ghost" onClick={() => setAjoutOuvert(false)}>
                  Annuler
                </Button>
              </div>
            )}
          </div>

          <Modal
            open={contactCible !== null}
            title="Nouveau contact"
            onClose={() => setContactCible(null)}
            footer={
              <FormActions
                cancel={{
                  label: 'Annuler',
                  onClick: () => setContactCible(null),
                }}
                submit={{
                  label: 'Ajouter',
                  onClick: () => void handleAddContactInline(),
                  disabled:
                    !newContact.prenom ||
                    !newContact.nom ||
                    !newContact.telephone,
                }}
              />
            }
          >
            <div className="space-y-4">
              <FormGrid>
                <FormField label="Prénom" htmlFor="contact-prenom" required>
                  <Input
                    id="contact-prenom"
                    required
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
                    required
                    value={newContact.nom}
                    onChange={(e) =>
                      setNewContact((p) => ({ ...p, nom: e.target.value }))
                    }
                    placeholder="Nom"
                  />
                </FormField>
              </FormGrid>
              <FormField label="Téléphone" htmlFor="contact-tel" required>
                <Input
                  id="contact-tel"
                  type="tel"
                  required
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

          <Text variant="hint">
            Toute collecte annulée à moins de 4h de l'heure de collecte donne
            lieu à facturation plein tarif — pour une collecte Anti-Gaspi sous
            pack, un crédit est décompté (cf. CGV).
          </Text>

          {error && <AlertBar variant="err">{error}</AlertBar>}

          <div className="flex flex-col sm:flex-row justify-between gap-3 pt-1">
            <Button variant="ghost" onClick={() => setStep(0)}>
              <CaretLeftIcon />
              Retour
            </Button>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                variant="secondary"
                onClick={() => void handleSubmit(false)}
                disabled={!ecran2Valide || submitting}
              >
                <FloppyDiskIcon />
                Enregistrer en brouillon
              </Button>
              <Button
                onClick={() => void handleSubmit(true)}
                disabled={!ecran2Valide || submitting}
              >
                <CheckCircleIcon />
                {affichees.length > 1
                  ? 'Confirmer les programmations'
                  : 'Confirmer la programmation'}
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

// Cartes des deux écrans : libellés des champs en gras et plus foncés que la
// recette DS, pour mieux les distinguer des valeurs saisies (retour Val du
// 2026-10-26, limité à ce formulaire). Seuls les libellés au-dessus d'un champ
// (recette `field`, classe `block`) sont visés, pas ceux des cases à cocher.
const CARTE_FORMULAIRE =
  'space-y-5 [&_label.block]:font-bold [&_label.block]:text-savr-neutral-900';

/**
 * Compteur − valeur + du nombre de collectes d'un type (retour Val du
 * 2026-10-26, modèle du sélecteur de voyageurs d'Expedia) : boutons ronds,
 * − grisé à 0, + grisé au plafond. La valeur ne se tape pas.
 */
function CompteurCollectes({
  id,
  libelle,
  valeur,
  describedBy,
  onChange,
}: {
  id: string;
  libelle: string;
  valeur: number;
  describedBy?: string;
  onChange: (n: number) => void;
}) {
  const bouton =
    'rounded-savr-full border border-savr-neutral-300 bg-savr-white text-savr-neutral-700 hover:border-savr-primary-500 hover:bg-savr-white hover:text-savr-primary-700';
  return (
    <div className="flex items-center justify-center gap-4">
      <IconButton
        aria-label={`Retirer une collecte ${libelle}`}
        className={bouton}
        disabled={valeur <= 0}
        onClick={() => onChange(valeur - 1)}
      >
        <MinusIcon aria-hidden="true" />
      </IconButton>
      <output
        id={id}
        aria-live="polite"
        aria-describedby={describedBy}
        className="min-w-6 text-center text-base font-semibold tabular-nums text-savr-neutral-900"
      >
        {valeur}
      </output>
      <IconButton
        aria-label={`Ajouter une collecte ${libelle}`}
        className={bouton}
        disabled={valeur >= PLAFOND_PAR_TYPE}
        onClick={() => onChange(valeur + 1)}
      >
        <PlusIcon aria-hidden="true" />
      </IconButton>
    </div>
  );
}
