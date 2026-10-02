'use client';

import { fmtEuro, fmtPax, fmtKgAuto } from '@/lib/format';
import { libelleStatutFacture } from '@/lib/libelles/facture';
import { libelleStatutTournee } from '@/lib/libelles/tournee';
import { useCallback, useEffect, useState, type MutableRefObject } from 'react';
import {
  Truck,
  Send,
  KeyRound,
  AlertTriangle,
  Settings2,
  FileText,
  Download,
  RotateCw,
  Upload,
  History,
  PhoneCall,
  MapPin,
  Scale,
  HeartHandshake,
  CalendarDays,
  DoorOpen,
  Users,
  Building2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Combobox } from '@/components/ui/combobox';
import { FormField } from '@/components/ui/form-field';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertBar } from '@/components/ui/alert-bar';
import { Modal } from '@/components/ui/modal';
import { Timeline, TimelineItem } from '@/components/ui/timeline';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { CollecteStatutFrise } from './collecte-statut-frise';
import { AttributionAgForm } from './attribution-ag-form';
import {
  DIFFICULTE_LABEL,
  DIFFICULTE_VARIANT,
  VEHICULE_LABEL,
} from '@/lib/lieux-labels';
import {
  applyLieuOverrides,
  lieuChampSurcharge,
  CHAMPS_LIEU_SURCHARGEABLES,
} from '@savr/adapters/src/lieu-overrides.js';
import {
  statutCollecteDisplay,
  type StatutCollecteDb,
} from '@/lib/statut-collecte-labels';
import { statutTmsDisplay } from '@/lib/statut-tms-labels';
import {
  envoiAutomatique,
  libelleCanalEnvoi,
  libelleDispatch,
  libelleTypeTms,
} from '@/lib/type-tms-labels';
import { PlaqueTmsPicto } from '@/components/collectes/plaque-tms-picto';
import {
  BadgeTypeCollecte,
  BlocHeader,
  ContactLigne,
  dateLongueCapitalisee,
  EnTeteMention,
  FicheEnTete,
  InfoItem,
  typeCollecteLabel,
} from '@/components/collecte/fiche-blocs';
import { refCourteCollecte } from '@/lib/collecte-ref';
import type { FicheCollecteMeta } from '@/components/collecte/fiche-collecte-modal-cadre';
import { Text } from '@/components/ui/text';

// Transporteurs (référentiel) — le sélecteur prestataire Bloc 0 liste les
// transporteurs actifs ; `type_tms` pilote le fork du bouton d'envoi (§06.06 §3
// « Spec V1 fork ») et `prestataire_logistique_id` (pont R5 → shared.prestataires)
// est la valeur envoyée à l'endpoint dispatch.
interface Transporteur {
  id: string;
  nom: string;
  type_tms: string;
  prestataire_logistique_id: string | null;
  actif: boolean;
}

// Recommandation de l'algo d'attribution AG (§06.09) — sous-ensemble consommé par
// Bloc 0 sur une AG déjà attribuée : transporteur top-1 (baseline « ≠ top-1 →
// motif obligatoire » au renvoi / changement de prestataire). L'attribution
// elle-même passe par le formulaire intégré (AttributionAgForm), qui charge sa
// propre recommandation.
interface RecoAlgo {
  associations: {
    id: string;
    nom: string;
    distance_km?: number;
    capacite_max_beneficiaires?: number;
  }[];
  transporteur: { id: string; nom: string; type_tms: string } | null;
  no_asso: boolean;
  no_prestataire: boolean;
}

// Les 9 valeurs de l'enum collectes.statut (forçage manuel RM-08).
const STATUTS_FORCABLES: StatutCollecteDb[] = [
  'brouillon',
  'programmee',
  'validee',
  'en_cours',
  'realisee',
  'realisee_sans_collecte',
  'cloturee',
  'annulation_demandee',
  'annulee',
  'rejetee_par_prestataire',
];

// Lieu tel que servi par GET /admin/collectes/[id] (`lieux!lieu_id(*)`) — seuls
// les champs affichés dans l'onglet Informations sont typés.
interface LieuDetail {
  nom: string;
  ville: string;
  adresse_acces: string;
  code_postal?: string | null;
  acces_details?: string | null;
  acces_office?: string | null;
  stationnement?: string | null;
  type_vehicule_max?: string | null;
  contraintes_horaires?: string | null;
}

interface CollecteDetail {
  id: string;
  type: 'zero_dechet' | 'anti_gaspi';
  statut: string;
  statut_tms: string;
  dirty_tms: boolean;
  statut_tms_at: string | null;
  date_collecte: string;
  heure_collecte: string;
  nb_camions_demande: number;
  tms_reference: string | null;
  volume_estime_repas: number | null;
  // Besoin véhicule saisi à l'attribution (décision Val 2026-10-01), nullable.
  type_vehicule_souhaite?: string | null;
  controle_acces_requis: boolean;
  infos_acces_email_envoye_at: string | null;
  notes_internes: string | null;
  informations_supplementaires: string | null;
  motif_override_prestataire: string | null;
  annulee_cote_savr: boolean;
  pack_antgaspi_id: string | null;
  packs_antgaspi: {
    id: string;
    type_pack: string;
    credits_restants: number;
    statut: string;
  } | null;
  // Attribution AG (Bloc 5) — asso/transporteur retenus + volume réalisé (§06.06 l.249).
  attributions_antgaspi: {
    id: string;
    mode_validation: string;
    valide_at: string | null;
    volume_repas_realise: number | null;
    associations: { nom: string } | null;
    transporteurs: { nom: string } | null;
  } | null;
  prestataire_logistique_id: string | null;
  // Prestataire actuel, résolu par la route détail : depuis `prestataire_logistique_id`
  // (transporteur actif OU désactivé), sinon transporteur de l'attribution AG validée
  // (transporteur sans pont prestataire). `transporteur_id` / `type_tms` sont null
  // quand le prestataire n'a pas de fiche transporteur.
  prestataire_actuel?: {
    transporteur_id: string | null;
    nom: string;
    type_tms: string | null;
  } | null;
  // Surcharge per-collecte du lieu (§04 `collectes.lieu_overrides`) : prime sur
  // la référence `lieux` pour cette collecte seulement.
  lieu_overrides?: Record<string, unknown> | null;
  evenements: {
    nom_evenement: string | null;
    pax: number;
    nom_client_organisateur: string | null;
    contact_principal_nom?: string | null;
    contact_principal_telephone?: string | null;
    contact_secours_nom?: string | null;
    contact_secours_telephone?: string | null;
    organisations: { raison_sociale: string };
    client_organisateur: { raison_sociale: string } | null;
    lieux: LieuDetail;
    types_evenements: { libelle: string } | null;
  };
  collecte_flux: {
    flux_id: string;
    poids_reel_kg: number | null;
    flux_dechets: { code: string; nom: string } | null;
  }[];
  collecte_tournees: {
    rang: number;
    tournees: {
      id: string;
      statut: string;
      tms_reference: string | null;
      external_ref_commande: string | null;
      plaque_immatriculation: string | null;
      chauffeur_nom: string | null;
      chauffeur_telephone: string | null;
      accompagnant_nom: string | null;
      accompagnant_telephone: string | null;
    };
  }[];
  // factures_collectes = lignes de facture ; le statut vit sur la facture parente
  // (jointure facture_id → factures). La ligne elle-même n'a pas de statut.
  factures_collectes: {
    id: string;
    montant_ht: number;
    factures: { statut: string } | null;
  }[];
}

// Référentiel des 5 flux ZD V1 (figé — seed flux_dechets). Sert à afficher tous
// les flux dans Bloc 3 même quand collecte_flux n'a pas encore de ligne (pesées
// dérivées de pesees_tournees à l'agrégation, ou saisie manuelle Admin).
const ZD_FLUX = [
  { code: 'biodechet', nom: 'Biodéchets' },
  { code: 'emballage', nom: 'Emballages' },
  { code: 'carton', nom: 'Cartons' },
  { code: 'verre', nom: 'Verre' },
  { code: 'dechet_residuel', nom: 'Déchet résiduel' },
] as const;

// Bloc 3 — Documents (GET /[id]/documents).
interface RapportDoc {
  id: string;
  version: number;
  disponible_a: string | null;
  genere_at: string | null;
  regenere_at: string | null;
  consulte_par_user_at: string | null;
  pdf_url: string | null;
}
interface BordereauDoc {
  id: string;
  statut: string;
  numero: string | null;
  genere_at: string | null;
  pdf_fichier_id: string | null;
}
interface AttestationDoc {
  id: string;
  statut: string;
  numero: string | null;
  genere_at: string | null;
  pdf_url: string | null;
  version: number;
}
interface PhotoItem {
  id: string;
  content_type: string;
  created_at: string;
  url: string | null;
}
interface DocumentsData {
  rapport: RapportDoc | null;
  bordereau: BordereauDoc | null;
  attestation: AttestationDoc | null;
  photos: PhotoItem[];
}

// Bloc 7 — Historique + audit log (GET /[id]/audit).
interface AuditEntry {
  id: string;
  created_at: string;
  role: string | null;
  action: string;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  motif: string | null;
  impersonator_id: string | null;
}

// Types de document PDF régénérables (aligné @savr/shared PDF_DOCUMENT_TYPES).
type PdfType = 'rapport-recyclage-zd' | 'bordereau-zd' | 'attestation-don';

function DifficulteBadge({ valeur }: { valeur?: string | null }) {
  if (!valeur) return <>—</>;
  return (
    <Badge
      variant={DIFFICULTE_VARIANT[valeur] ?? 'neutral'}
      className="text-xs"
    >
      {DIFFICULTE_LABEL[valeur] ?? valeur}
    </Badge>
  );
}

// Groupe de cartes radio (motif APG radiogroup) : les flèches déplacent le
// focus ET la sélection d'une carte à l'autre, en boucle.
function naviguerRadios(e: React.KeyboardEvent<HTMLElement>): void {
  const delta =
    e.key === 'ArrowDown' || e.key === 'ArrowRight'
      ? 1
      : e.key === 'ArrowUp' || e.key === 'ArrowLeft'
        ? -1
        : 0;
  if (delta === 0) return;
  const radios = Array.from(
    e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]'),
  );
  const courant = radios.indexOf(document.activeElement as HTMLElement);
  if (courant === -1) return;
  e.preventDefault();
  const suivant = radios[(courant + delta + radios.length) % radios.length];
  suivant?.focus();
  suivant?.click();
}

// Carte cochable (choix d'un prestataire) — radio accessible, cible ≥ 44 px.
function CarteChoix({
  coche,
  focusable,
  onSelect,
  titre,
  detail,
  badges,
}: {
  coche: boolean;
  focusable: boolean;
  onSelect: () => void;
  titre: string;
  detail: string;
  badges?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={coche}
      tabIndex={focusable ? 0 : -1}
      onClick={onSelect}
      className={cn(
        'flex min-h-11 items-start gap-3 rounded-savr-md border p-3 text-left text-sm transition-colors',
        coche
          ? 'border-savr-primary-600 bg-savr-primary-50'
          : 'border-savr-neutral-200 bg-savr-white hover:border-savr-neutral-300',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2',
          coche ? 'border-savr-primary-600' : 'border-savr-neutral-300',
        )}
      >
        {coche && (
          <span className="h-1.5 w-1.5 rounded-full bg-savr-primary-600" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5 font-semibold text-savr-neutral-900">
          {titre}
          {badges}
        </span>
        <Text as="span" variant="hint" className="block">
          {detail}
        </Text>
      </span>
    </button>
  );
}

interface CollecteDetailPanelProps {
  // Fiche collecte affichée dans le panneau latéral (Sheet) de la liste
  // /admin/collectes — reprend l'intégralité de l'ex-page [id] (hub opérationnel :
  // dispatch, envoi TMS, infos accès/chauffeur, pesées ZD, documents, forçage
  // statut). L'id vient d'une prop (plus de route [id], plus de useParams).
  collecteId: string;
  // Le panneau remonte au cadre modale le titre accessible de la collecte une
  // fois chargée. Optionnel : absent en test unitaire du panneau seul.
  onLoaded?: (info: FicheCollecteMeta) => void;
  // Miroir « une sous-modale (forçage/nb camions/annuler crédit) est ouverte » :
  // le wrapper modale le lit pour ne PAS fermer la fiche sur Escape tant qu'une
  // sous-modale est ouverte (modale externe + sous-modale écoutent toutes deux
  // Escape au niveau document — sans cette garde, Escape fermerait les deux).
  // Optionnel : absent en test unitaire (rendu direct du panneau, hors modale).
  blockCloseRef?: MutableRefObject<boolean>;
}

export function CollecteDetailPanel({
  collecteId,
  onLoaded,
  blockCloseRef,
}: CollecteDetailPanelProps) {
  const [collecte, setCollecte] = useState<CollecteDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [dispatching, setDispatching] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [annulerCreditModal, setAnnulerCreditModal] = useState(false);
  const [annulerCreditMotif, setAnnulerCreditMotif] = useState('');
  const [annulerCreditSubmitting, setAnnulerCreditSubmitting] = useState(false);
  const [annulerCreditError, setAnnulerCreditError] = useState<string | null>(
    null,
  );
  // Édition manuelle des pesées ZD (Bloc 3)
  const [editPesees, setEditPesees] = useState(false);
  const [peseesInput, setPeseesInput] = useState<Record<string, string>>({});
  const [peseesMotif, setPeseesMotif] = useState('');
  const [peseesSaving, setPeseesSaving] = useState(false);
  const [peseesError, setPeseesError] = useState<string | null>(null);
  // Infos accès / chauffeur (contrôle d'accès) — saisie manuelle Admin par tournée.
  const [editInfosAcces, setEditInfosAcces] = useState(false);
  const [infosAccesInput, setInfosAccesInput] = useState<
    Record<
      string,
      {
        plaque_immatriculation: string;
        chauffeur_nom: string;
        chauffeur_telephone: string;
        accompagnant_nom: string;
        accompagnant_telephone: string;
      }
    >
  >({});
  const [infosAccesSaving, setInfosAccesSaving] = useState(false);
  const [infosAccesError, setInfosAccesError] = useState<string | null>(null);
  const [infosAccesFeedback, setInfosAccesFeedback] = useState<string | null>(
    null,
  );
  // Bloc 0 — dispatch prestataire (BOA-06)
  const [transporteurs, setTransporteurs] = useState<Transporteur[]>([]);
  const [selectedTransporteurId, setSelectedTransporteurId] = useState('');
  // Ordre en file d'envoi : les cartes prestataire et le bouton d'envoi ne
  // reviennent que sur demande explicite (« Changer de prestataire »).
  const [changerPrestataire, setChangerPrestataire] = useState(false);
  const [motifOverride, setMotifOverride] = useState('');
  const [reco, setReco] = useState<RecoAlgo | null>(null);
  // RM-08 — forçage manuel du statut
  const [forceStatutModal, setForceStatutModal] = useState(false);
  const [forceStatutValue, setForceStatutValue] = useState('');
  const [forceStatutMotif, setForceStatutMotif] = useState('');
  const [forceStatutSubmitting, setForceStatutSubmitting] = useState(false);
  const [forceStatutError, setForceStatutError] = useState<string | null>(null);
  // RM-02 — modification du nombre de camions (multi-camions MTS-1)
  const [nbCamionsModal, setNbCamionsModal] = useState(false);
  const [nbCamionsValue, setNbCamionsValue] = useState('1');
  const [nbCamionsSubmitting, setNbCamionsSubmitting] = useState(false);
  const [nbCamionsError, setNbCamionsError] = useState<string | null>(null);
  // §06.06 §3 Bloc 0 — acceptation manuelle Everest (A Toutes! indisponible).
  const [acceptationModal, setAcceptationModal] = useState(false);
  const [acceptationSaisie, setAcceptationSaisie] = useState({
    reference_mission: '',
    contact_joint: '',
    heure_appel: '',
    commentaire: '',
  });
  const [acceptationSubmitting, setAcceptationSubmitting] = useState(false);
  const [acceptationError, setAcceptationError] = useState<string | null>(null);
  // Bloc 3 — Documents / Bloc 7 — Historique (BOA-07)
  const [documents, setDocuments] = useState<DocumentsData | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [regenerating, setRegenerating] = useState<PdfType | null>(null);
  const [docError, setDocError] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);

  const STATUTS_TERMINAUX = [
    'realisee',
    'cloturee',
    'annulee',
    'realisee_sans_collecte',
  ];

  const refetch = useCallback(async () => {
    const updated = await fetch(
      `/api/v1/admin/collectes/${encodeURIComponent(collecteId)}`,
    );
    if (updated.ok) setCollecte((await updated.json()) as CollecteDetail);
  }, [collecteId]);

  // Bloc 3 — Documents (rapport / bordereau / attestation / photos).
  const refetchDocuments = useCallback(async () => {
    const r = await fetch(
      `/api/v1/admin/collectes/${encodeURIComponent(collecteId)}/documents`,
    );
    if (r.ok) setDocuments((await r.json()) as DocumentsData);
  }, [collecteId]);

  // Bloc 7 — Historique + audit log.
  const refetchAudit = useCallback(async () => {
    const r = await fetch(
      `/api/v1/admin/collectes/${encodeURIComponent(collecteId)}/audit`,
    );
    if (r.ok) {
      const j = (await r.json()) as { data: AuditEntry[] };
      setAudit(j.data);
    }
  }, [collecteId]);

  useEffect(() => {
    void refetchDocuments();
    void refetchAudit();
  }, [refetchDocuments, refetchAudit]);

  // Régénération d'un PDF (§06.06 l.283-284) — ré-enqueue jobs_pdf côté serveur.
  const handleRegenerate = async (type: PdfType) => {
    setRegenerating(type);
    setDocError(null);
    const res = await fetch(
      `/api/v1/admin/collectes/${encodeURIComponent(collecteId)}/documents/${encodeURIComponent(type)}/regenerate`,
      { method: 'POST' },
    );
    if (res.ok) {
      await refetchDocuments();
      await refetchAudit();
    } else {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setDocError(body.error ?? 'Échec de la régénération');
    }
    setRegenerating(null);
  };

  // Téléchargement PDF via la route /download dédiée (URL R2 pré-signée).
  const handleDownload = async (path: string) => {
    setDocError(null);
    const res = await fetch(path);
    if (res.ok) {
      const { url } = (await res.json()) as { url: string };
      window.open(url, '_blank', 'noopener');
    } else {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setDocError(body.error ?? 'Téléchargement indisponible');
    }
  };

  // Import manuel d'une photo (§06.06 Bloc 3 « Importer des photos »).
  const handleImportPhoto = async (file: File) => {
    setPhotoUploading(true);
    setDocError(null);
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(
      `/api/v1/admin/collectes/${encodeURIComponent(collecteId)}/photos`,
      {
        method: 'POST',
        body: fd,
      },
    );
    if (res.ok) {
      await refetchDocuments();
    } else {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setDocError(body.error ?? 'Import de photo indisponible');
    }
    setPhotoUploading(false);
  };

  useEffect(() => {
    // On vérifie res.ok AVANT de désérialiser : une réponse d'erreur (404/500)
    // renvoie un corps { error } — le poser dans `collecte` faisait crasher le
    // rendu (collecte.type.toUpperCase() sur undefined = exception client).
    fetch(`/api/v1/admin/collectes/${encodeURIComponent(collecteId)}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = (await r.json().catch(() => ({}))) as {
            error?: string;
          };
          setError(body.error ?? 'Collecte introuvable');
          return;
        }
        setCollecte((await r.json()) as CollecteDetail);
      })
      .catch(() => setError('Erreur chargement'))
      .finally(() => setLoading(false));
  }, [collecteId]);

  // Référentiel transporteurs actifs — sélecteur prestataire Bloc 0.
  useEffect(() => {
    fetch('/api/v1/admin/transporteurs?actif=true')
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((json: { data: Transporteur[] }) => setTransporteurs(json.data))
      .catch(() => setTransporteurs([]));
  }, []);

  // Recommandation algo (§06.09) — uniquement AG non terminale (dispatch pertinent).
  // Sert à afficher le prestataire/asso recommandés et à décider si un motif override
  // est requis (choix ≠ top-1). Le top-1 pré-sélectionne le sélecteur (validation
  // de la reco = 0 motif). Erreur/aucune reco = dégradation gracieuse (pas de baseline).
  const collecteType = collecte?.type;
  const collecteStatut = collecte?.statut;
  // AG sans attribution : le formulaire intégré charge sa propre recommandation
  // et le bloc dispatch n'est pas rendu — ne rien présélectionner ici (sinon le
  // top-1 resterait coché après une validation sur un autre transporteur).
  const attributionAbsente =
    collecte?.type === 'anti_gaspi' &&
    collecte?.attributions_antgaspi?.associations == null;
  // Déjà attribuée = prestataire posé sur la collecte OU servi par la route
  // (transporteur sans pont : `prestataire_logistique_id` reste NULL).
  const dejaAttribuee =
    collecte?.prestataire_logistique_id != null ||
    collecte?.prestataire_actuel != null;
  useEffect(() => {
    if (collecteType !== 'anti_gaspi' || attributionAbsente) return;
    if (
      collecteStatut != null &&
      ['realisee', 'cloturee', 'annulee', 'realisee_sans_collecte'].includes(
        collecteStatut,
      )
    ) {
      return;
    }
    let active = true;
    fetch(
      `/api/v1/admin/attributions-ag/${encodeURIComponent(collecteId)}/recommandation`,
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { data: RecoAlgo } | null) => {
        if (!active) return;
        const r = j?.data ?? null;
        setReco(r);
        // Pré-sélection du top-1 recommandé si aucune sélection ni prestataire courant.
        if (r?.transporteur && !dejaAttribuee) {
          setSelectedTransporteurId((prev) => prev || r.transporteur!.id);
        }
      })
      .catch(() => {
        if (active) setReco(null);
      });
    return () => {
      active = false;
    };
  }, [
    collecteId,
    collecteType,
    collecteStatut,
    dejaAttribuee,
    attributionAbsente,
  ]);

  const handleAnnulerCredit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAnnulerCreditSubmitting(true);
    setAnnulerCreditError(null);
    const res = await fetch(
      `/api/v1/admin/collectes/${encodeURIComponent(collecteId)}/annuler-credit`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ motif: annulerCreditMotif }),
      },
    );
    if (res.ok) {
      const updated = await fetch(
        `/api/v1/admin/collectes/${encodeURIComponent(collecteId)}`,
      );
      if (updated.ok) setCollecte((await updated.json()) as CollecteDetail);
      setAnnulerCreditModal(false);
    } else {
      const body = (await res.json()) as { error: string };
      setAnnulerCreditError(body.error);
    }
    setAnnulerCreditSubmitting(false);
  };

  const handleDispatch = async () => {
    setDispatching(true);
    setDispatchError(null);
    // Prestataire choisi (AG) → on envoie son prestataire_logistique_id (pont R5).
    // Sans changement (ZD / re-send) → body vide = réémission dispatch idempotente.
    const selected = transporteurs.find((t) => t.id === selectedTransporteurId);
    const body: Record<string, unknown> = {};
    if (selected?.prestataire_logistique_id) {
      body.prestataire_logistique_id = selected.prestataire_logistique_id;
      if (motifOverride.trim()) {
        body.motif_override_prestataire = motifOverride.trim();
      }
    }
    const res = await fetch(
      `/api/v1/admin/collectes/${encodeURIComponent(collecteId)}/dispatch`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    if (res.ok) {
      await refetch();
      setSelectedTransporteurId('');
      setMotifOverride('');
      setChangerPrestataire(false);
    } else {
      const errBody = (await res.json()) as { error: string };
      setDispatchError(errBody.error);
    }
    setDispatching(false);
  };

  const handleForceStatut = async (e: React.FormEvent) => {
    e.preventDefault();
    setForceStatutSubmitting(true);
    setForceStatutError(null);
    // L'API PATCH valide déjà motif ≥ 10 car. + audite `collecte_statut_force`.
    const res = await fetch(
      `/api/v1/admin/collectes/${encodeURIComponent(collecteId)}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          statut: forceStatutValue,
          motif: forceStatutMotif,
        }),
      },
    );
    if (res.ok) {
      await refetch();
      setForceStatutModal(false);
    } else {
      const body = (await res.json()) as { error: string };
      setForceStatutError(body.error);
    }
    setForceStatutSubmitting(false);
  };

  // RM-02 — modification du nombre de camions (multi-camions MTS-1). Le PATCH
  // route valide déjà les gardes RM-02 (statut terminal → 409) et RM-05
  // (réduction < 1h avant mission → 409 + alerte Ops).
  const handleModifierNbCamions = async (e: React.FormEvent) => {
    e.preventDefault();
    setNbCamionsSubmitting(true);
    setNbCamionsError(null);
    const res = await fetch(
      `/api/v1/admin/collectes/${encodeURIComponent(collecteId)}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nb_camions_demande: Number(nbCamionsValue) }),
      },
    );
    if (res.ok) {
      await refetch();
      setNbCamionsModal(false);
    } else {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setNbCamionsError(body.error ?? 'Modification impossible');
    }
    setNbCamionsSubmitting(false);
  };

  // §06.06 §3 Bloc 0 — la référence de mission est OBLIGATOIRE : elle est écrite
  // comme au dispatch normal (tournée + référence TMS), ce qui sort la collecte
  // des « non transmises » et rend l'annulation possible.
  const handleAcceptationManuelle = async (e: React.FormEvent) => {
    e.preventDefault();
    setAcceptationSubmitting(true);
    setAcceptationError(null);
    const res = await fetch('/api/v1/admin/everest/missions/manual-accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ collecte_id: collecteId, ...acceptationSaisie }),
    });
    if (res.ok) {
      await refetch();
      setAcceptationModal(false);
    } else {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setAcceptationError(body.error ?? 'Enregistrement impossible');
    }
    setAcceptationSubmitting(false);
  };

  const openEditPesees = () => {
    if (!collecte) return;
    const prefill: Record<string, string> = {};
    for (const flux of ZD_FLUX) {
      const ligne = collecte.collecte_flux.find(
        (f) => f.flux_dechets?.code === flux.code,
      );
      prefill[flux.code] =
        ligne?.poids_reel_kg != null ? String(ligne.poids_reel_kg) : '';
    }
    setPeseesInput(prefill);
    setPeseesMotif('');
    setPeseesError(null);
    setEditPesees(true);
  };

  const handleSavePesees = async (e: React.FormEvent) => {
    e.preventDefault();
    setPeseesSaving(true);
    setPeseesError(null);
    const pesees = ZD_FLUX.filter(
      (flux) => peseesInput[flux.code]?.trim() !== '',
    ).map((flux) => ({
      flux_code: flux.code,
      poids_reel_kg: Number(peseesInput[flux.code]),
    }));
    const res = await fetch(
      `/api/v1/admin/collectes/${encodeURIComponent(collecteId)}/flux`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pesees, motif: peseesMotif }),
      },
    );
    if (res.ok) {
      const updated = await fetch(
        `/api/v1/admin/collectes/${encodeURIComponent(collecteId)}`,
      );
      if (updated.ok) setCollecte((await updated.json()) as CollecteDetail);
      setEditPesees(false);
    } else {
      const body = (await res.json()) as { error: string };
      setPeseesError(body.error);
    }
    setPeseesSaving(false);
  };

  const openEditInfosAcces = () => {
    if (!collecte) return;
    const prefill: typeof infosAccesInput = {};
    for (const ct of collecte.collecte_tournees) {
      prefill[ct.tournees.id] = {
        plaque_immatriculation: ct.tournees.plaque_immatriculation ?? '',
        chauffeur_nom: ct.tournees.chauffeur_nom ?? '',
        chauffeur_telephone: ct.tournees.chauffeur_telephone ?? '',
        accompagnant_nom: ct.tournees.accompagnant_nom ?? '',
        accompagnant_telephone: ct.tournees.accompagnant_telephone ?? '',
      };
    }
    setInfosAccesInput(prefill);
    setInfosAccesError(null);
    setInfosAccesFeedback(null);
    setEditInfosAcces(true);
  };

  const handleSaveInfosAcces = async (e: React.FormEvent) => {
    e.preventDefault();
    setInfosAccesSaving(true);
    setInfosAccesError(null);
    const tournees = Object.entries(infosAccesInput).map(([tournee_id, v]) => ({
      tournee_id,
      plaque_immatriculation: v.plaque_immatriculation,
      chauffeur_nom: v.chauffeur_nom,
      chauffeur_telephone: v.chauffeur_telephone,
      accompagnant_nom: v.accompagnant_nom,
      accompagnant_telephone: v.accompagnant_telephone,
    }));
    const res = await fetch(
      `/api/v1/admin/collectes/${encodeURIComponent(collecteId)}/infos-acces`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tournees }),
      },
    );
    if (res.ok) {
      const body = (await res.json()) as { email_envoye: boolean };
      const updated = await fetch(
        `/api/v1/admin/collectes/${encodeURIComponent(collecteId)}`,
      );
      if (updated.ok) setCollecte((await updated.json()) as CollecteDetail);
      setInfosAccesFeedback(
        body.email_envoye
          ? 'Infos enregistrées — email récapitulatif envoyé au programmateur.'
          : 'Infos enregistrées.',
      );
      setEditInfosAcces(false);
    } else {
      const body = (await res.json()) as { error: string };
      setInfosAccesError(body.error);
    }
    setInfosAccesSaving(false);
  };

  // Remonte le titre accessible au cadre modale dès que la collecte est chargée
  // (« Collecte AG · … · jusqu'à N pax », lu par les lecteurs d'écran).
  useEffect(() => {
    if (!collecte) return;
    const d = new Date(collecte.date_collecte).toLocaleDateString('fr-FR', {
      timeZone: 'Europe/Paris',
    });
    const h = collecte.heure_collecte
      ? ` · ${collecte.heure_collecte.slice(0, 5)}`
      : '';
    const lieu = collecte.evenements.lieux;
    onLoaded?.({
      title: `Collecte ${typeCollecteLabel(collecte.type)} · ${d}${h} · ${collecte.evenements.organisations.raison_sociale} · ${lieu.nom} (${lieu.ville}) · jusqu'à ${fmtPax(collecte.evenements.pax)}`,
    });
  }, [collecte, onLoaded]);

  // Miroir de l'état « sous-modale ouverte » pour le wrapper modale (garde Escape).
  const anySubModalOpen =
    annulerCreditModal ||
    forceStatutModal ||
    nbCamionsModal ||
    acceptationModal;
  if (blockCloseRef) blockCloseRef.current = anySubModalOpen;

  if (loading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (error || !collecte) {
    return (
      <div className="p-6">
        <AlertBar variant="err">{error ?? 'Collecte introuvable'}</AlertBar>
      </div>
    );
  }

  const isTerminal = STATUTS_TERMINAUX.includes(collecte.statut);
  // AG sans attribution : le formulaire d'attribution (association, besoin
  // véhicule, prestataire — décision Val 2026-10-01) remplace le bloc dispatch,
  // dont il est l'unique point d'entrée : « Valider et envoyer » = la décision de
  // dispatch (§06.09 §3). Le bloc dispatch ne sert ensuite qu'au renvoi / au
  // changement de prestataire (garde serveur 422 sans association, inchangée).
  const attributionManquante =
    collecte.type === 'anti_gaspi' &&
    collecte.attributions_antgaspi?.associations == null;
  // RM-02 — N camions modifiable uniquement hors état terminal (garde serveur).
  const nbCamionsEditable = ['programmee', 'validee', 'en_cours'].includes(
    collecte.statut,
  );

  // Bloc 0 — prestataire actuel + fork type_tms. Il vient de la route détail, PAS
  // de `transporteurs` : cette liste ne porte que les ACTIFS et se charge à part —
  // transporteur désactivé depuis, liste pas encore arrivée ou en échec faisaient
  // dire « non attribué » d'une collecte attribuée. Servi aussi quand
  // `prestataire_logistique_id` est NULL : transporteur sans pont (par mail, par
  // téléphone, autre) de l'attribution AG validée.
  const currentTransporteur = collecte.prestataire_actuel ?? undefined;
  // « Non attribué » ne se dit que d'une collecte SANS prestataire : si elle en a
  // un dont le nom manque dans la réponse, on le dit tel quel.
  const libelleSansNom =
    collecte.prestataire_logistique_id == null
      ? null
      : 'Attribué — nom indisponible';
  const selectedTransporteur = transporteurs.find(
    (t) => t.id === selectedTransporteurId,
  );
  const forkTypeTms =
    selectedTransporteur?.type_tms ?? currentTransporteur?.type_tms;
  // Transporteur recommandé par l'algo (top-1) — baseline de l'override (§06.06 §3 :
  // motif obligatoire SI le choix ≠ top-1 algo). Pas de reco → pas de baseline → pas
  // de motif requis (cohérent avec la garde serveur du dispatch).
  const recommendedTransporteurId = reco?.transporteur?.id ?? null;
  const overrideActif =
    selectedTransporteur != null &&
    recommendedTransporteurId != null &&
    selectedTransporteur.id !== recommendedTransporteurId;
  const overrideMotifManquant =
    overrideActif && motifOverride.trim().length < 5;
  // Acceptation manuelle : collecte chez A Toutes!, non terminale, sans
  // référence de mission encore enregistrée (sinon elle est déjà « transmise »).
  const acceptationManuellePossible =
    !isTerminal &&
    currentTransporteur?.type_tms === 'a_toutes' &&
    !collecte.tms_reference;
  // Ordre en file d'envoi (décision Val 2026-10-02, C1) : prestataire posé chez
  // un adapter (MTS-1 / A Toutes!), commande pas encore partie (le worker outbox
  // tourne toutes les 15 min : `tms_reference` vide, `statut_tms` encore
  // « non envoyé » — §06.09 §3 pt 3). À ce stade la fiche DIT la collecte
  // envoyée et ne rouvre le choix du prestataire que sur demande : avant, elle
  // réaffichait « Prestataire à attribuer » + « Envoyer », comme si rien n'était
  // parti. Les transporteurs manuels (mail / téléphone / autre) gardent l'écran
  // d'attribution : rien ne part automatiquement pour eux.
  const ordreEnFileEnvoi =
    !isTerminal &&
    envoiAutomatique(currentTransporteur?.type_tms) &&
    !collecte.tms_reference &&
    collecte.statut_tms === 'non_envoye';
  const dispatchEnLecture = ordreEnFileEnvoi && !changerPrestataire;
  const canalEnvoi = libelleCanalEnvoi(currentTransporteur?.type_tms);
  const referenceSaisie = acceptationSaisie.reference_mission.trim();
  const acceptationIncomplete =
    referenceSaisie === '' ||
    /\s/.test(referenceSaisie) ||
    acceptationSaisie.contact_joint.trim() === '';

  // Cartes prestataire : recommandé d'abord, puis l'actuel, puis le reste.
  const rangCarte = (t: Transporteur): number =>
    t.id === recommendedTransporteurId
      ? 0
      : t.id === currentTransporteur?.transporteur_id
        ? 1
        : 2;
  const transporteursOrdonnes = [...transporteurs].sort(
    (a, b) => rangCarte(a) - rangCarte(b),
  );
  const aucuneCarteCochee = !transporteursOrdonnes.some(
    (t) =>
      (selectedTransporteurId || currentTransporteur?.transporteur_id) === t.id,
  );

  const dateCollecteLongue = new Date(
    collecte.date_collecte,
  ).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Paris',
  });
  const heureCollecte = collecte.heure_collecte?.slice(0, 5) ?? '';
  // Lieu effectif de CETTE collecte = EXACTEMENT ce que reçoit le transporteur :
  // même fusion que l'adapter (allowlist, garde de type, null ignoré).
  const overrides = collecte.lieu_overrides ?? null;
  const lieuSurcharge = CHAMPS_LIEU_SURCHARGEABLES.some((c) =>
    lieuChampSurcharge(overrides, c),
  );
  const lieu = applyLieuOverrides(collecte.evenements.lieux, overrides);

  // En file d'envoi, « Non envoyé » (valeur brute de l'enum) tromperait l'Ops :
  // l'ordre est parti côté Plateforme. Affichage dérivé, l'enum DB ne change pas.
  const statutTms = ordreEnFileEnvoi
    ? { label: 'Envoyée', variant: 'info' as const }
    : statutTmsDisplay(collecte.statut_tms);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Grand en-tête commun aux fiches (décision Val 2026-10-01) : il remplace
          le titre-résumé de la modale, la colonne résumé (C1) et la frise
          pleine largeur (C2) ; « dirty TMS » en sur-titre. */}
      <FicheEnTete
        surtitre={
          <>
            <BadgeTypeCollecte type={collecte.type} />
            <EnTeteMention>Réf. {refCourteCollecte(collecte)}</EnTeteMention>
            {collecte.dirty_tms && (
              <Badge
                variant="warning"
                className="flex items-center gap-1 text-xs"
              >
                <AlertTriangle className="h-3 w-3" />
                Modifiée — renvoi requis
              </Badge>
            )}
          </>
        }
        titre={lieu.nom}
        infosTestId="fiche-admin-sous-ligne"
        infos={[
          {
            icon: CalendarDays,
            texte: `${dateLongueCapitalisee(collecte.date_collecte)}${heureCollecte ? ` · ${heureCollecte}` : ''}`,
          },
          {
            icon: Users,
            texte: `jusqu'à ${fmtPax(collecte.evenements.pax)}`,
          },
          {
            icon: Building2,
            texte: collecte.evenements.organisations.raison_sociale,
          },
          { icon: MapPin, texte: lieu.ville },
          {
            icon: Truck,
            // Le badge garde la couleur du statut TMS (rejet, erreur) visible
            // sans ouvrir l'onglet Logistique.
            texte: (
              <span className="inline-flex flex-wrap items-center gap-2">
                {currentTransporteur?.nom ??
                  libelleSansNom ??
                  'Prestataire non attribué'}
                <Badge variant={statutTms.variant} className="text-xs">
                  {statutTms.label}
                </Badge>
              </span>
            ),
          },
          ...(collecte.type === 'anti_gaspi'
            ? [
                {
                  icon: HeartHandshake,
                  texte:
                    collecte.attributions_antgaspi?.associations?.nom ??
                    'Association en attente d’attribution',
                },
              ]
            : []),
        ]}
        statut={<CollecteStatutFrise statut={collecte.statut} />}
        statutLarge
      />

      {/* Onglets seuls, sans colonne : même barre horizontale que les autres
          fiches, fixe au défilement du corps. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 md:px-8">
        <Tabs defaultValue="informations">
          <TabsList
            aria-label="Sections de la fiche collecte"
            className="sticky top-0 z-10 w-full overflow-x-auto bg-savr-white"
          >
            <TabsTrigger value="informations" className="px-3 sm:px-4">
              Informations
            </TabsTrigger>
            <TabsTrigger value="logistique" className="px-3 sm:px-4">
              Logistique
            </TabsTrigger>
            <TabsTrigger value="documents" className="px-3 sm:px-4">
              Documents
            </TabsTrigger>
            <TabsTrigger value="historique" className="px-3 sm:px-4">
              Historique
            </TabsTrigger>
          </TabsList>

          <TabsContent value="informations" className="space-y-4">
            <Card padding="md" className="space-y-4">
              <BlocHeader icon={CalendarDays} title="Événement" />
              <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <InfoItem label="Date et heure de collecte">
                  {dateCollecteLongue}
                  {heureCollecte ? ` · ${heureCollecte}` : ''}
                </InfoItem>
                <InfoItem label="Traiteur">
                  {collecte.evenements.organisations.raison_sociale}
                </InfoItem>
                <InfoItem label="Nombre de pax">
                  jusqu&apos;à {collecte.evenements.pax}
                </InfoItem>
                {/* Client final = client organisateur, distinct du traiteur. */}
                <InfoItem label="Client final">
                  {collecte.evenements.client_organisateur?.raison_sociale ??
                    collecte.evenements.nom_client_organisateur ??
                    '—'}
                </InfoItem>
                <InfoItem label="Type d'événement">
                  {collecte.evenements.types_evenements?.libelle ?? '—'}
                </InfoItem>
                {collecte.evenements.nom_evenement && (
                  <InfoItem label="Nom de l'événement">
                    {collecte.evenements.nom_evenement}
                  </InfoItem>
                )}
                {collecte.type === 'anti_gaspi' && (
                  <InfoItem label="Volume repas estimé">
                    {collecte.volume_estime_repas ?? '—'}
                  </InfoItem>
                )}
              </dl>
            </Card>

            {/* Lieu effectif = référence `lieux` + surcharge de cette collecte
                (`lieu_overrides`, §04 : le lieu officiel n'est jamais modifié). */}
            <Card padding="md" className="space-y-4">
              <BlocHeader
                icon={MapPin}
                title="Lieu"
                action={
                  lieuSurcharge ? (
                    <Badge variant="info" className="text-xs">
                      Modifié pour cette collecte
                    </Badge>
                  ) : undefined
                }
              />
              <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <InfoItem label="Nom">{lieu.nom}</InfoItem>
                <InfoItem label="Adresse">
                  {lieu.adresse_acces}
                  <span className="block text-savr-neutral-600">
                    {[lieu.code_postal, lieu.ville].filter(Boolean).join(' ')}
                  </span>
                </InfoItem>
                <InfoItem label="Accès office">
                  <DifficulteBadge valeur={lieu.acces_office} />
                </InfoItem>
                <InfoItem label="Stationnement">
                  <DifficulteBadge valeur={lieu.stationnement} />
                </InfoItem>
                <InfoItem label="Véhicule max">
                  {lieu.type_vehicule_max
                    ? (VEHICULE_LABEL[lieu.type_vehicule_max] ??
                      lieu.type_vehicule_max)
                    : '—'}
                </InfoItem>
                <InfoItem label="Contrôle d'accès">
                  {collecte.controle_acces_requis ? 'Oui' : 'Non'}
                </InfoItem>
                {lieu.contraintes_horaires && (
                  <InfoItem label="Contraintes horaires" pleineLargeur>
                    {lieu.contraintes_horaires}
                  </InfoItem>
                )}
              </dl>
            </Card>

            <Card padding="md" className="space-y-4">
              <BlocHeader icon={DoorOpen} title="Instructions d'accès" />
              <dl className="space-y-3 text-sm">
                <InfoItem label="Accès au lieu (badge, code, interphone, gardien…)">
                  {lieu.acces_details ? (
                    <span className="whitespace-pre-line">
                      {lieu.acces_details}
                    </span>
                  ) : (
                    <span className="text-savr-neutral-400">
                      Aucune instruction renseignée
                    </span>
                  )}
                </InfoItem>
                {collecte.informations_supplementaires && (
                  <InfoItem label="Informations supplémentaires">
                    <span className="whitespace-pre-line">
                      {collecte.informations_supplementaires}
                    </span>
                  </InfoItem>
                )}
                {collecte.notes_internes && (
                  <InfoItem label="Notes internes Savr">
                    <span className="whitespace-pre-line">
                      {collecte.notes_internes}
                    </span>
                  </InfoItem>
                )}
              </dl>
            </Card>

            <Card padding="md" className="space-y-4">
              <BlocHeader icon={Users} title="Contacts" />
              <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <InfoItem label="Contact principal">
                  <ContactLigne
                    nom={collecte.evenements.contact_principal_nom}
                    telephone={collecte.evenements.contact_principal_telephone}
                  />
                </InfoItem>
                <InfoItem label="Contact de secours">
                  <ContactLigne
                    nom={collecte.evenements.contact_secours_nom}
                    telephone={collecte.evenements.contact_secours_telephone}
                  />
                </InfoItem>
              </dl>
            </Card>

            {/* Informations chauffeur demandées — saisie par tournée si le lieu
                exige un contrôle d'accès. */}
            {collecte.controle_acces_requis ? (
              <Card padding="md" className="space-y-4">
                <BlocHeader
                  icon={KeyRound}
                  title="Informations chauffeur"
                  action={
                    !editInfosAcces && collecte.collecte_tournees.length > 0 ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={openEditInfosAcces}
                      >
                        Éditer les infos
                      </Button>
                    ) : undefined
                  }
                />
                <Text>
                  Ce lieu exige un contrôle d’accès. Renseignez le nom et le
                  téléphone du chauffeur (et l’accompagnant s’il y en a un) pour
                  chaque camion : un email récapitulatif est envoyé au
                  programmateur dès que toutes les tournées sont complètes.
                </Text>

                {collecte.infos_acces_email_envoye_at ? (
                  <div className="flex items-center gap-2 text-sm font-medium text-savr-success-strong">
                    <Send className="h-4 w-4 shrink-0" />
                    Email envoyé au programmateur le{' '}
                    {new Date(
                      collecte.infos_acces_email_envoye_at,
                    ).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })}
                  </div>
                ) : (
                  <Text
                    as="div"
                    tone="soft"
                    className="flex items-center gap-2"
                  >
                    <AlertTriangle className="h-4 w-4 shrink-0 text-savr-warning-strong" />
                    En attente : infos à compléter avant envoi de l’email.
                  </Text>
                )}

                {infosAccesFeedback && (
                  <AlertBar variant="info">{infosAccesFeedback}</AlertBar>
                )}
                {infosAccesError && (
                  <AlertBar variant="err">{infosAccesError}</AlertBar>
                )}

                {collecte.collecte_tournees.length === 0 ? (
                  <Text>
                    Aucune tournée dispatchée pour le moment — les infos
                    pourront être saisies une fois le prestataire attribué.
                  </Text>
                ) : !editInfosAcces ? (
                  <div className="space-y-2">
                    {collecte.collecte_tournees.map((ct) => (
                      <div
                        key={ct.tournees.id}
                        className="rounded-savr-md border border-savr-neutral-100 bg-savr-neutral-50 px-3 py-2.5 text-sm"
                      >
                        <p className="mb-1.5 font-medium">Camion {ct.rang}</p>
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-savr-neutral-700">
                          <div>
                            <Text as="dt" variant="hint">
                              Plaque
                            </Text>
                            <dd>{ct.tournees.plaque_immatriculation ?? '—'}</dd>
                          </div>
                          <div>
                            <Text as="dt" variant="hint">
                              Chauffeur
                            </Text>
                            <dd>{ct.tournees.chauffeur_nom ?? '—'}</dd>
                          </div>
                          <div>
                            <Text as="dt" variant="hint">
                              Téléphone
                            </Text>
                            <dd>{ct.tournees.chauffeur_telephone ?? '—'}</dd>
                          </div>
                          {(ct.tournees.accompagnant_nom ||
                            ct.tournees.accompagnant_telephone) && (
                            <>
                              <div>
                                <Text as="dt" variant="hint">
                                  Accompagnant
                                </Text>
                                <dd>{ct.tournees.accompagnant_nom ?? '—'}</dd>
                              </div>
                              <div>
                                <Text as="dt" variant="hint">
                                  Tél. accompagnant
                                </Text>
                                <dd>
                                  {ct.tournees.accompagnant_telephone ?? '—'}
                                </dd>
                              </div>
                            </>
                          )}
                        </dl>
                      </div>
                    ))}
                  </div>
                ) : (
                  <form
                    onSubmit={(e) => void handleSaveInfosAcces(e)}
                    className="space-y-3"
                  >
                    {collecte.collecte_tournees.map((ct) => {
                      const v = infosAccesInput[ct.tournees.id] ?? {
                        plaque_immatriculation: '',
                        chauffeur_nom: '',
                        chauffeur_telephone: '',
                        accompagnant_nom: '',
                        accompagnant_telephone: '',
                      };
                      const setField = (
                        field: keyof typeof v,
                        val: string,
                      ): void =>
                        setInfosAccesInput((prev) => ({
                          ...prev,
                          [ct.tournees.id]: {
                            ...v,
                            ...prev[ct.tournees.id],
                            [field]: val,
                          },
                        }));
                      return (
                        <div
                          key={ct.tournees.id}
                          className="space-y-2.5 rounded-savr-md border border-savr-neutral-100 bg-savr-neutral-50 px-3 py-3"
                        >
                          <p className="text-sm font-medium">
                            Camion {ct.rang}
                          </p>
                          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                            <label className="space-y-1 text-xs text-savr-neutral-500">
                              <span>Plaque d’immatriculation</span>
                              <Input
                                value={v.plaque_immatriculation}
                                onChange={(e) =>
                                  setField(
                                    'plaque_immatriculation',
                                    e.target.value,
                                  )
                                }
                              />
                            </label>
                            <label className="space-y-1 text-xs text-savr-neutral-500">
                              <span>Nom du chauffeur</span>
                              <Input
                                value={v.chauffeur_nom}
                                onChange={(e) =>
                                  setField('chauffeur_nom', e.target.value)
                                }
                              />
                            </label>
                            <label className="space-y-1 text-xs text-savr-neutral-500">
                              <span>Téléphone du chauffeur</span>
                              <Input
                                type="tel"
                                value={v.chauffeur_telephone}
                                onChange={(e) =>
                                  setField(
                                    'chauffeur_telephone',
                                    e.target.value,
                                  )
                                }
                              />
                            </label>
                            <label className="space-y-1 text-xs text-savr-neutral-500">
                              <span>Nom de l’accompagnant (facultatif)</span>
                              <Input
                                value={v.accompagnant_nom}
                                onChange={(e) =>
                                  setField('accompagnant_nom', e.target.value)
                                }
                              />
                            </label>
                            <label className="space-y-1 text-xs text-savr-neutral-500">
                              <span>
                                Téléphone de l’accompagnant (facultatif)
                              </span>
                              <Input
                                type="tel"
                                value={v.accompagnant_telephone}
                                onChange={(e) =>
                                  setField(
                                    'accompagnant_telephone',
                                    e.target.value,
                                  )
                                }
                              />
                            </label>
                          </div>
                        </div>
                      );
                    })}
                    <div className="flex gap-2">
                      <Button
                        type="submit"
                        size="sm"
                        disabled={infosAccesSaving}
                      >
                        {infosAccesSaving ? 'Enregistrement…' : 'Enregistrer'}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => setEditInfosAcces(false)}
                      >
                        Annuler
                      </Button>
                    </div>
                  </form>
                )}
              </Card>
            ) : (
              <Card padding="md" className="space-y-4">
                <BlocHeader icon={KeyRound} title="Informations chauffeur" />
                <Text>
                  Ce lieu n&apos;exige pas de contrôle d&apos;accès : aucune
                  information chauffeur n&apos;est demandée.
                </Text>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="logistique" className="space-y-4">
            {/* AG sans attribution : formulaire intégré (décision Val 2026-10-01) —
            association d'abord (son adresse est le point de livraison), besoin
            véhicule, prestataire, un seul bouton « Valider et envoyer ». */}
            {attributionManquante && collecte.statut === 'programmee' && (
              <Card padding="md" className="space-y-4">
                <BlocHeader
                  icon={HeartHandshake}
                  title="Attribution & dispatch"
                />
                <AttributionAgForm
                  collecteId={collecte.id}
                  collecte={{
                    volume_estime_repas: collecte.volume_estime_repas ?? null,
                    pax: collecte.evenements.pax ?? null,
                    date_collecte: collecte.date_collecte,
                    heure_collecte: collecte.heure_collecte,
                    nb_camions_demande: collecte.nb_camions_demande,
                    type_vehicule_souhaite:
                      collecte.type_vehicule_souhaite ?? null,
                  }}
                  onValidee={() => {
                    // Le bloc dispatch qui prend la relève ne doit hériter
                    // d'aucune sélection : l'ordre vient de partir chez le
                    // transporteur choisi, pas chez le recommandé.
                    setSelectedTransporteurId('');
                    setMotifOverride('');
                    void refetch();
                  }}
                />
              </Card>
            )}
            {/* AG sans attribution hors `programmee` (brouillon, annulation
            demandée…) : la validation d'attribution est impossible (§06.09 §3,
            RPC P0043) — consigne plutôt qu'un formulaire qui échouerait. */}
            {attributionManquante &&
              collecte.statut !== 'programmee' &&
              !isTerminal && (
                <Card padding="md" className="space-y-4">
                  <BlocHeader
                    icon={HeartHandshake}
                    title="Attribution & dispatch"
                  />
                  <AlertBar variant="warn">
                    L&apos;attribution (association, prestataire) n&apos;est
                    possible qu&apos;au statut « Programmée » — statut actuel :
                    « {statutCollecteDisplay(collecte.statut).label} ».
                  </AlertBar>
                </Card>
              )}
            {/* AG attribuée : résumé de l'attribution AVANT « Prestataire &
            Dispatch » (décision Val 2026-10-01). */}
            {collecte.type === 'anti_gaspi' && !attributionManquante && (
              <Card padding="md" className="space-y-4">
                <BlocHeader icon={HeartHandshake} title="Attribution AG" />
                <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-savr-neutral-500">
                      Association retenue
                    </dt>
                    <dd className="font-medium">
                      {collecte.attributions_antgaspi?.associations?.nom ?? (
                        <span className="text-savr-neutral-400">
                          Aucune (en attente d’attribution)
                        </span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-savr-neutral-500">
                      Transporteur retenu
                    </dt>
                    <dd className="font-medium">
                      {collecte.attributions_antgaspi?.transporteurs?.nom ?? (
                        <span className="text-savr-neutral-400">—</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-savr-neutral-500">Validation</dt>
                    <dd className="font-medium">
                      {collecte.attributions_antgaspi?.valide_at ? (
                        <>
                          {collecte.attributions_antgaspi.mode_validation} —{' '}
                          {new Date(
                            collecte.attributions_antgaspi.valide_at,
                          ).toLocaleDateString('fr-FR', {
                            timeZone: 'Europe/Paris',
                          })}
                        </>
                      ) : (
                        <Badge variant="warning" className="text-xs">
                          En attente de validation
                        </Badge>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-savr-neutral-500">
                      Volume repas (estimé / réalisé)
                    </dt>
                    <dd className="font-medium">
                      {collecte.volume_estime_repas ?? '—'} /{' '}
                      {collecte.attributions_antgaspi?.volume_repas_realise ??
                        '—'}
                    </dd>
                  </div>
                </dl>
              </Card>
            )}
            {!(attributionManquante && !isTerminal) && (
              <Card padding="md" className="space-y-4">
                <BlocHeader icon={Truck} title="Prestataire & Dispatch" />
                {dispatchError && (
                  <AlertBar variant="err">{dispatchError}</AlertBar>
                )}
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  <div>
                    <dt className="text-savr-neutral-500">
                      Prestataire actuel
                    </dt>
                    <dd className="font-medium flex items-center gap-2">
                      {currentTransporteur?.nom ?? (
                        <span className="text-savr-neutral-400">
                          {libelleSansNom ?? 'Aucun prestataire attribué'}
                        </span>
                      )}
                      {currentTransporteur?.type_tms && (
                        <Badge variant="neutral" className="text-[10px]">
                          {libelleTypeTms(currentTransporteur.type_tms)}
                        </Badge>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-savr-neutral-500">Statut TMS</dt>
                    <dd className="font-medium">
                      <Badge variant={statutTms.variant} className="text-xs">
                        {statutTms.label}
                      </Badge>
                      {collecte.statut_tms_at && (
                        <Text as="span" variant="faint" className="ml-1">
                          (
                          {new Date(collecte.statut_tms_at).toLocaleString(
                            'fr-FR',
                            {
                              timeZone: 'Europe/Paris',
                            },
                          )}
                          )
                        </Text>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-savr-neutral-500">Référence TMS</dt>
                    <dd className="font-mono font-medium">
                      {collecte.tms_reference ?? '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-savr-neutral-500">Nb camions</dt>
                    <dd className="flex items-center gap-2 font-medium">
                      {collecte.nb_camions_demande}
                      {nbCamionsEditable && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setNbCamionsValue(
                              String(collecte.nb_camions_demande),
                            );
                            setNbCamionsError(null);
                            setNbCamionsModal(true);
                          }}
                        >
                          Modifier
                        </Button>
                      )}
                    </dd>
                  </div>
                  {collecte.motif_override_prestataire && (
                    <div className="col-span-2">
                      <dt className="text-savr-neutral-500">Motif override</dt>
                      <dd className="font-medium">
                        {collecte.motif_override_prestataire}
                      </dd>
                    </div>
                  )}
                </dl>

                {ordreEnFileEnvoi && (
                  <AlertBar variant="info">
                    <span className="font-semibold">
                      Collecte envoyée à {currentTransporteur?.nom}.
                    </span>{' '}
                    La commande part automatiquement vers {canalEnvoi} (toutes
                    les 15 minutes) : la référence TMS et le statut « Attente
                    acceptation presta » s&apos;afficheront ici dès sa prise en
                    compte.
                  </AlertBar>
                )}

                {/* Choix du prestataire (AG) — override manuel §06.06 §3, en cartes
            cochables (décision Val C3) : la reco algo est présélectionnée et
            marquée « Recommandé ». Pas de choix en ZD V1 (réémission seule).
            Ordre en file d'envoi : masqué tant que l'Ops ne demande pas à
            changer de prestataire. */}
                {collecte.type === 'anti_gaspi' &&
                  !isTerminal &&
                  !dispatchEnLecture && (
                    <div className="space-y-3 border-t border-savr-neutral-100 pt-4">
                      <Text
                        tone="strong"
                        className="font-semibold"
                        id="dispatch-transporteur-label"
                      >
                        {currentTransporteur
                          ? 'Changer de prestataire'
                          : 'Prestataire à attribuer'}
                      </Text>
                      {transporteursOrdonnes.length === 0 ? (
                        <Text>
                          Aucun transporteur actif dans le référentiel.
                        </Text>
                      ) : (
                        <div
                          role="radiogroup"
                          aria-labelledby="dispatch-transporteur-label"
                          onKeyDown={naviguerRadios}
                          className="grid gap-2 sm:grid-cols-2"
                        >
                          {transporteursOrdonnes.map((t, i) => {
                            const estActuel =
                              t.id === currentTransporteur?.transporteur_id;
                            const coche =
                              (selectedTransporteurId ||
                                currentTransporteur?.transporteur_id) === t.id;
                            return (
                              <CarteChoix
                                key={t.id}
                                coche={coche}
                                // Un seul arrêt de tabulation : la carte cochée, sinon la 1re.
                                focusable={
                                  coche || (aucuneCarteCochee && i === 0)
                                }
                                // Re-choisir le prestataire actuel = le conserver ('').
                                onSelect={() =>
                                  setSelectedTransporteurId(
                                    estActuel ? '' : t.id,
                                  )
                                }
                                titre={t.nom}
                                detail={libelleTypeTms(t.type_tms)}
                                badges={
                                  <>
                                    {t.id === recommendedTransporteurId && (
                                      <Badge
                                        variant="primary"
                                        className="text-xs"
                                      >
                                        Recommandé
                                      </Badge>
                                    )}
                                    {estActuel && (
                                      <Badge
                                        variant="neutral"
                                        className="text-xs"
                                      >
                                        Actuel
                                      </Badge>
                                    )}
                                  </>
                                }
                              />
                            );
                          })}
                        </div>
                      )}
                      {overrideActif && (
                        <div>
                          <label
                            className="block text-sm font-medium text-savr-neutral-700 mb-1"
                            htmlFor="dispatch-motif"
                          >
                            Motif override (obligatoire ≥ 5 car. — prestataire ≠
                            reco algo)
                          </label>
                          <Textarea
                            id="dispatch-motif"
                            rows={2}
                            value={motifOverride}
                            onChange={(e) => setMotifOverride(e.target.value)}
                            placeholder="Raison du choix d'un prestataire différent de la recommandation…"
                          />
                        </div>
                      )}
                    </div>
                  )}

                {/* Bouton d'envoi TMS forké par type_tms (+ acceptation manuelle
              A Toutes! quand Everest est indisponible, §06.06 §3 Bloc 0) */}
                <div className="flex flex-wrap justify-end gap-2">
                  {acceptationManuellePossible && (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setAcceptationSaisie({
                          reference_mission: '',
                          contact_joint: '',
                          heure_appel: '',
                          commentaire: '',
                        });
                        setAcceptationError(null);
                        setAcceptationModal(true);
                      }}
                    >
                      <PhoneCall className="h-4 w-4 mr-2" />
                      Acceptation manuelle
                    </Button>
                  )}
                  {dispatchEnLecture ? (
                    // Ordre en file d'envoi : pas de bouton primaire d'envoi (il
                    // est déjà parti). AG → rouvrir le choix du prestataire ;
                    // ZD → réémission idempotente seule (pas de choix V1).
                    collecte.type === 'anti_gaspi' ? (
                      <Button
                        variant="secondary"
                        onClick={() => setChangerPrestataire(true)}
                      >
                        <Truck className="h-4 w-4 mr-2" />
                        Changer de prestataire
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        disabled={dispatching}
                        onClick={() => void handleDispatch()}
                      >
                        <Send className="h-4 w-4 mr-2" />
                        {dispatching
                          ? 'Envoi…'
                          : libelleDispatch(forkTypeTms, true)}
                      </Button>
                    )
                  ) : (
                    <>
                      {ordreEnFileEnvoi && (
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setChangerPrestataire(false);
                            setSelectedTransporteurId('');
                            setMotifOverride('');
                          }}
                        >
                          Garder le prestataire actuel
                        </Button>
                      )}
                      <Button
                        disabled={
                          isTerminal || dispatching || overrideMotifManquant
                        }
                        onClick={() => void handleDispatch()}
                      >
                        <Send className="h-4 w-4 mr-2" />
                        {dispatching
                          ? 'Envoi…'
                          : libelleDispatch(
                              forkTypeTms,
                              // Même prestataire, ordre déjà en file → c'est un renvoi.
                              !!collecte.tms_reference ||
                                (ordreEnFileEnvoi && !selectedTransporteurId),
                            )}
                      </Button>
                    </>
                  )}
                </div>

                {/* Tournées (multi-camions) */}
                {collecte.collecte_tournees.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Text variant="body" className="font-medium">
                        Tournées
                      </Text>
                      <PlaqueTmsPicto tournees={collecte.collecte_tournees} />
                    </div>
                    <div className="space-y-1">
                      {collecte.collecte_tournees.map((ct) => (
                        <div
                          key={ct.rang}
                          className="flex items-center gap-4 text-sm bg-savr-neutral-50 rounded-savr-sm px-3 py-2"
                        >
                          <span className="font-medium">Camion {ct.rang}</span>
                          <Badge variant="neutral" className="text-xs">
                            {libelleStatutTournee(ct.tournees.statut)}
                          </Badge>
                          <Text as="span" variant="hint" className="font-mono">
                            {ct.tournees.external_ref_commande ?? '—'}
                          </Text>
                          <Text
                            as="span"
                            variant="hint"
                            tone="soft"
                            className="font-mono"
                          >
                            {ct.tournees.plaque_immatriculation ?? 'plaque —'}
                          </Text>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            )}
            {/* Pesées ZD (dérivées des pesées MTS-1 ou saisie manuelle Admin) */}
            {collecte.type === 'zero_dechet' && (
              <Card padding="md" className="space-y-4">
                <BlocHeader
                  icon={Scale}
                  title="Pesées ZD"
                  action={
                    !editPesees && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={collecte.statut === 'cloturee'}
                        onClick={openEditPesees}
                      >
                        {collecte.statut === 'cloturee'
                          ? 'Clôturée — édition via avoir'
                          : 'Éditer les pesées'}
                      </Button>
                    )
                  }
                />

                {!editPesees ? (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-savr-neutral-200">
                        <th className="text-left py-2 text-savr-neutral-500 font-medium">
                          Flux
                        </th>
                        <th className="text-right py-2 text-savr-neutral-500 font-medium">
                          Poids (kg)
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {ZD_FLUX.map((flux) => {
                        const ligne = collecte.collecte_flux.find(
                          (f) => f.flux_dechets?.code === flux.code,
                        );
                        const poids = ligne?.poids_reel_kg ?? null;
                        return (
                          <tr
                            key={flux.code}
                            className="border-b border-savr-neutral-100"
                          >
                            <td className="py-2 font-medium">{flux.nom}</td>
                            <td className="py-2 text-right">
                              {poids !== null ? (
                                <span className="font-medium">
                                  {fmtKgAuto(poids)}
                                </span>
                              ) : (
                                <span className="text-savr-neutral-400">
                                  En attente
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <form
                    onSubmit={(e) => void handleSavePesees(e)}
                    className="space-y-3"
                  >
                    <table className="w-full text-sm">
                      <tbody>
                        {ZD_FLUX.map((flux) => (
                          <tr
                            key={flux.code}
                            className="border-b border-savr-neutral-100"
                          >
                            <td className="py-2 font-medium">{flux.nom}</td>
                            <td className="py-2 text-right">
                              <Input
                                type="number"
                                min={0}
                                step="0.01"
                                value={peseesInput[flux.code] ?? ''}
                                onChange={(e) =>
                                  setPeseesInput((prev) => ({
                                    ...prev,
                                    [flux.code]: e.target.value,
                                  }))
                                }
                                aria-label={`Poids ${flux.nom} (kg)`}
                                className="ml-auto w-28 text-right"
                                placeholder="kg"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-savr-neutral-700">
                        Motif (obligatoire, ≥ 10 caractères)
                      </label>
                      <Textarea
                        value={peseesMotif}
                        onChange={(e) => setPeseesMotif(e.target.value)}
                        rows={2}
                        minLength={10}
                        required
                      />
                    </div>
                    {peseesError && (
                      <AlertBar variant="err">{peseesError}</AlertBar>
                    )}
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => setEditPesees(false)}
                        disabled={peseesSaving}
                      >
                        Annuler
                      </Button>
                      <Button type="submit" disabled={peseesSaving}>
                        {peseesSaving ? 'Enregistrement…' : 'Enregistrer'}
                      </Button>
                    </div>
                  </form>
                )}
              </Card>
            )}
          </TabsContent>

          <TabsContent value="documents">
            {/* Bloc 3 (CDC) — Documents : rapport RSE / bordereau ZD / attestation AG + photos */}
            <Card padding="md" className="space-y-4">
              <BlocHeader icon={FileText} title="Documents" />
              {docError && <AlertBar variant="err">{docError}</AlertBar>}

              <div className="divide-y divide-savr-neutral-100">
                {/* Rapport RSE (ZD + AG) */}
                <div className="flex items-center gap-3 py-3">
                  <div className="flex-1">
                    <p className="text-sm font-medium flex items-center gap-2">
                      Rapport RSE
                      {documents?.rapport &&
                        (documents.rapport.version > 1 ||
                          documents.rapport.regenere_at) && (
                          <span
                            title={`Rapport régénéré${
                              documents.rapport.regenere_at
                                ? ` — mis à jour le ${new Date(
                                    documents.rapport.regenere_at,
                                  ).toLocaleDateString('fr-FR', {
                                    timeZone: 'Europe/Paris',
                                  })}`
                                : ''
                            }`}
                            className="inline-flex items-center text-savr-primary-600"
                          >
                            <RotateCw className="h-3.5 w-3.5" />
                          </span>
                        )}
                    </p>
                    <Text variant="hint">
                      {!documents?.rapport
                        ? 'Non encore généré'
                        : !documents.rapport.genere_at
                          ? 'En attente de génération'
                          : documents.rapport.consulte_par_user_at
                            ? `Consulté le ${new Date(
                                documents.rapport.consulte_par_user_at,
                              ).toLocaleDateString('fr-FR', {
                                timeZone: 'Europe/Paris',
                              })}`
                            : 'Disponible'}
                    </Text>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!documents?.rapport?.genere_at}
                    onClick={() =>
                      documents?.rapport &&
                      void handleDownload(
                        `/api/v1/admin/rapports-rse/${encodeURIComponent(documents.rapport.id)}/download`,
                      )
                    }
                  >
                    <Download className="h-4 w-4 mr-1" />
                    Télécharger
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={
                      !documents?.rapport ||
                      regenerating === 'rapport-recyclage-zd'
                    }
                    onClick={() =>
                      void handleRegenerate('rapport-recyclage-zd')
                    }
                  >
                    <RotateCw
                      className={`h-4 w-4 mr-1 ${
                        regenerating === 'rapport-recyclage-zd'
                          ? 'animate-spin'
                          : ''
                      }`}
                    />
                    Régénérer
                  </Button>
                </div>

                {/* Bordereau ZD (ZD only) */}
                {collecte.type === 'zero_dechet' && (
                  <div className="flex items-center gap-3 py-3">
                    <div className="flex-1">
                      <p className="text-sm font-medium">
                        Bordereau ZD
                        {documents?.bordereau?.numero && (
                          <Text
                            as="span"
                            variant="hint"
                            className="ml-2 font-mono"
                          >
                            {documents.bordereau.numero}
                          </Text>
                        )}
                      </p>
                      <Text variant="hint">
                        {documents?.bordereau
                          ? `Statut : ${documents.bordereau.statut}`
                          : 'Non encore généré'}
                      </Text>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!documents?.bordereau?.genere_at}
                      onClick={() =>
                        documents?.bordereau &&
                        void handleDownload(
                          `/api/v1/admin/bordereaux/${encodeURIComponent(documents.bordereau.id)}/download`,
                        )
                      }
                    >
                      <Download className="h-4 w-4 mr-1" />
                      Télécharger
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={
                        !documents?.bordereau || regenerating === 'bordereau-zd'
                      }
                      onClick={() => void handleRegenerate('bordereau-zd')}
                    >
                      <RotateCw
                        className={`h-4 w-4 mr-1 ${
                          regenerating === 'bordereau-zd' ? 'animate-spin' : ''
                        }`}
                      />
                      Régénérer
                    </Button>
                  </div>
                )}

                {/* Attestation de don (AG only) */}
                {collecte.type === 'anti_gaspi' && (
                  <div className="flex items-center gap-3 py-3">
                    <div className="flex-1">
                      <p className="text-sm font-medium">
                        Attestation de don
                        {documents?.attestation?.numero && (
                          <Text
                            as="span"
                            variant="hint"
                            className="ml-2 font-mono"
                          >
                            {documents.attestation.numero}
                          </Text>
                        )}
                      </p>
                      <Text variant="hint">
                        {documents?.attestation
                          ? `Statut : ${documents.attestation.statut}`
                          : 'Non encore générée'}
                      </Text>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!documents?.attestation?.genere_at}
                      onClick={() =>
                        documents?.attestation &&
                        void handleDownload(
                          `/api/v1/admin/attestations/${encodeURIComponent(documents.attestation.id)}/download`,
                        )
                      }
                    >
                      <Download className="h-4 w-4 mr-1" />
                      Télécharger
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={
                        !documents?.attestation ||
                        regenerating === 'attestation-don'
                      }
                      onClick={() => void handleRegenerate('attestation-don')}
                    >
                      <RotateCw
                        className={`h-4 w-4 mr-1 ${
                          regenerating === 'attestation-don'
                            ? 'animate-spin'
                            : ''
                        }`}
                      />
                      Régénérer
                    </Button>
                  </div>
                )}
              </div>

              {/* Facture (ex-bloc Facturation, désormais intégré aux Documents) */}
              <div className="border-t border-savr-neutral-100 pt-4 space-y-3">
                <Text variant="body" className="font-medium">
                  Facture
                </Text>
                {collecte.factures_collectes.length === 0 ? (
                  <Text>Aucune facture générée.</Text>
                ) : (
                  <div className="space-y-2">
                    {collecte.factures_collectes.map((f) => (
                      <div
                        key={f.id}
                        className="flex items-center justify-between text-sm bg-savr-neutral-50 rounded-savr-sm px-3 py-2"
                      >
                        <Text as="span" variant="hint" className="font-mono">
                          {f.id.slice(0, 8)}…
                        </Text>
                        <Badge variant="neutral">
                          {libelleStatutFacture(f.factures?.statut)}
                        </Badge>
                        <span className="font-medium">
                          {fmtEuro(f.montant_ht)} HT
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" disabled>
                    Valider & envoyer Pennylane
                    <Badge variant="neutral" className="ml-2 text-xs">
                      M1.7
                    </Badge>
                  </Button>
                  {collecte.statut === 'realisee' &&
                    collecte.type === 'anti_gaspi' &&
                    !collecte.annulee_cote_savr && (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => {
                          setAnnulerCreditMotif('');
                          setAnnulerCreditError(null);
                          setAnnulerCreditModal(true);
                        }}
                      >
                        Annuler le crédit AG
                      </Button>
                    )}
                  {collecte.annulee_cote_savr && (
                    <Badge variant="error" className="self-center">
                      Crédit annulé côté Savr
                    </Badge>
                  )}
                </div>
              </div>

              {/* Galerie photos + import */}
              <div className="border-t border-savr-neutral-100 pt-4">
                <div className="flex items-center justify-between mb-3">
                  <Text variant="body" className="font-medium">
                    Photos ({documents?.photos?.length ?? 0})
                  </Text>
                  <label className="inline-flex items-center gap-1 text-sm text-savr-primary-600 cursor-pointer hover:underline">
                    <Upload className="h-4 w-4" />
                    {photoUploading ? 'Import…' : 'Importer des photos'}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      disabled={photoUploading}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void handleImportPhoto(f);
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>
                {documents?.photos && documents.photos.length > 0 ? (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {documents.photos.map((p) =>
                      p.url ? (
                        <img
                          key={p.id}
                          src={p.url}
                          alt="Photo collecte"
                          className="h-24 w-full object-cover rounded-savr-md border border-savr-neutral-200"
                        />
                      ) : (
                        <Text
                          as="div"
                          variant="faint"
                          className="h-24 w-full flex items-center justify-center rounded-savr-md border border-savr-neutral-200 bg-savr-neutral-50"
                          key={p.id}
                        >
                          Photo
                        </Text>
                      ),
                    )}
                  </div>
                ) : (
                  <Text tone="faint">Aucune photo importée.</Text>
                )}
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="historique">
            {/* Bloc 7 (CDC) — Historique + Audit log (Admin-only) */}
            <Card padding="md" className="space-y-4">
              <BlocHeader icon={History} title="Historique & audit" />
              {audit.length === 0 ? (
                <Text>Aucune action enregistrée sur cette collecte.</Text>
              ) : (
                <Timeline>
                  {audit.map((e) => {
                    const oldStatut = (
                      e.old_values as { statut?: string } | null
                    )?.statut;
                    const newStatut = (
                      e.new_values as { statut?: string } | null
                    )?.statut;
                    return (
                      <TimelineItem key={e.id}>
                        <Text tone="strong" className="font-medium">
                          {e.action}
                          {oldStatut && newStatut && (
                            <span className="ml-2 font-normal text-savr-neutral-500">
                              {oldStatut} → {newStatut}
                            </span>
                          )}
                        </Text>
                        <Text variant="hint">
                          {new Date(e.created_at).toLocaleString('fr-FR', {
                            timeZone: 'Europe/Paris',
                          })}
                          {e.role ? ` · ${e.role}` : ''}
                          {e.impersonator_id ? ' · (impersonation)' : ''}
                        </Text>
                        {e.motif && (
                          <Text
                            variant="hint"
                            tone="soft"
                            className="mt-1 italic"
                          >
                            « {e.motif} »
                          </Text>
                        )}
                      </TimelineItem>
                    );
                  })}
                </Timeline>
              )}
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Pied d'actions (cadre commun des fiches) — RM-08 forçage manuel du
          statut (motif obligatoire). */}
      <footer className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-savr-neutral-200 px-6 py-4 md:px-8">
        <Button
          variant="secondary"
          onClick={() => {
            setForceStatutValue(collecte.statut);
            setForceStatutMotif('');
            setForceStatutError(null);
            setForceStatutModal(true);
          }}
        >
          <Settings2 className="h-4 w-4" />
          Forcer le statut
        </Button>
      </footer>

      {/* Modale — Annuler le crédit AG */}
      <Modal
        open={annulerCreditModal}
        title="Annuler le crédit AG"
        onClose={() => setAnnulerCreditModal(false)}
      >
        {annulerCreditError && (
          <AlertBar variant="err" className="mb-4">
            {annulerCreditError}
          </AlertBar>
        )}
        <form
          onSubmit={(e) => void handleAnnulerCredit(e)}
          className="space-y-4"
        >
          <Text>
            Le crédit AG sera annulé côté Savr. La collecte reste à{' '}
            <strong>réalisée</strong> — seul le décompte du pack est rétabli.
            {collecte.packs_antgaspi && (
              <>
                {' '}
                Pack : <strong>
                  {collecte.packs_antgaspi.type_pack}
                </strong> — {collecte.packs_antgaspi.credits_restants} crédit
                {collecte.packs_antgaspi.credits_restants !== 1 ? 's' : ''}{' '}
                restant
                {collecte.packs_antgaspi.credits_restants !== 1 ? 's' : ''}.
              </>
            )}
          </Text>
          <div>
            <label className="mb-1 block text-sm font-medium text-savr-neutral-700">
              Motif (≥ 10 caractères)
            </label>
            <Textarea
              value={annulerCreditMotif}
              onChange={(e) => setAnnulerCreditMotif(e.target.value)}
              rows={3}
              minLength={10}
              required
            />
          </div>
          <div className="flex justify-end gap-2 border-t border-savr-neutral-100 pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setAnnulerCreditModal(false)}
              disabled={annulerCreditSubmitting}
            >
              Retour
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={annulerCreditSubmitting}
            >
              {annulerCreditSubmitting
                ? 'Annulation…'
                : "Confirmer l'annulation"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modale — Forcer le statut (RM-08) */}
      <Modal
        open={forceStatutModal}
        title="Forcer le statut de la collecte"
        onClose={() => setForceStatutModal(false)}
      >
        {forceStatutError && (
          <AlertBar variant="err" className="mb-4">
            {forceStatutError}
          </AlertBar>
        )}
        <form onSubmit={(e) => void handleForceStatut(e)} className="space-y-4">
          <Text>
            Bascule manuelle hors machine à états. L&apos;action est tracée dans
            l&apos;audit (motif obligatoire).
          </Text>
          <FormField label="Nouveau statut" htmlFor="force-statut-select">
            <Combobox
              id="force-statut-select"
              icon={null}
              value={forceStatutValue}
              onChange={setForceStatutValue}
              required
              options={STATUTS_FORCABLES.map((s) => ({
                value: s,
                label: statutCollecteDisplay(s, 'admin').label,
              }))}
            />
          </FormField>
          <div>
            <label
              className="mb-1 block text-sm font-medium text-savr-neutral-700"
              htmlFor="force-statut-motif"
            >
              Motif (obligatoire, ≥ 10 caractères)
            </label>
            <Textarea
              id="force-statut-motif"
              value={forceStatutMotif}
              onChange={(e) => setForceStatutMotif(e.target.value)}
              rows={3}
              minLength={10}
              required
            />
          </div>
          <div className="flex justify-end gap-2 border-t border-savr-neutral-100 pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setForceStatutModal(false)}
              disabled={forceStatutSubmitting}
            >
              Retour
            </Button>
            <Button
              type="submit"
              disabled={
                forceStatutSubmitting ||
                forceStatutMotif.trim().length < 10 ||
                forceStatutValue === ''
              }
            >
              {forceStatutSubmitting ? 'Application…' : 'Confirmer le forçage'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modale — Acceptation manuelle mission Everest (§06.06 §3 Bloc 0) */}
      <Modal
        open={acceptationModal}
        title="Acceptation manuelle — A Toutes!"
        onClose={() => setAcceptationModal(false)}
      >
        {acceptationError && (
          <AlertBar variant="err" className="mb-4">
            {acceptationError}
          </AlertBar>
        )}
        <form
          onSubmit={(e) => void handleAcceptationManuelle(e)}
          className="space-y-4"
        >
          <Text>
            À utiliser quand Everest est indisponible et que la course a été
            calée par téléphone avec A Toutes!. La référence de mission permet
            ensuite de renvoyer une modification ou d&apos;annuler la course.
          </Text>
          <div>
            <label
              className="mb-1 block text-sm font-medium text-savr-neutral-700"
              htmlFor="acceptation-reference"
            >
              Référence de mission communiquée par A Toutes! (obligatoire)
            </label>
            <Input
              id="acceptation-reference"
              value={acceptationSaisie.reference_mission}
              onChange={(e) =>
                setAcceptationSaisie((s) => ({
                  ...s,
                  reference_mission: e.target.value,
                }))
              }
              maxLength={64}
              autoComplete="off"
              className="font-mono"
              required
            />
            <Text variant="hint" className="mt-1">
              Sans espace, 64 caractères maximum.
            </Text>
          </div>
          <div>
            <label
              className="mb-1 block text-sm font-medium text-savr-neutral-700"
              htmlFor="acceptation-contact"
            >
              Contact joint chez A Toutes! (obligatoire)
            </label>
            <Input
              id="acceptation-contact"
              value={acceptationSaisie.contact_joint}
              onChange={(e) =>
                setAcceptationSaisie((s) => ({
                  ...s,
                  contact_joint: e.target.value,
                }))
              }
              maxLength={120}
              required
            />
          </div>
          <div>
            <label
              className="mb-1 block text-sm font-medium text-savr-neutral-700"
              htmlFor="acceptation-heure"
            >
              Heure de l&apos;appel
            </label>
            <Input
              id="acceptation-heure"
              type="time"
              value={acceptationSaisie.heure_appel}
              onChange={(e) =>
                setAcceptationSaisie((s) => ({
                  ...s,
                  heure_appel: e.target.value,
                }))
              }
              className="w-32"
            />
          </div>
          <div>
            <label
              className="mb-1 block text-sm font-medium text-savr-neutral-700"
              htmlFor="acceptation-commentaire"
            >
              Commentaire
            </label>
            <Textarea
              id="acceptation-commentaire"
              value={acceptationSaisie.commentaire}
              onChange={(e) =>
                setAcceptationSaisie((s) => ({
                  ...s,
                  commentaire: e.target.value,
                }))
              }
              rows={3}
              maxLength={1000}
            />
          </div>
          <div className="flex justify-end gap-2 border-t border-savr-neutral-100 pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setAcceptationModal(false)}
              disabled={acceptationSubmitting}
            >
              Retour
            </Button>
            <Button
              type="submit"
              disabled={acceptationSubmitting || acceptationIncomplete}
            >
              {acceptationSubmitting
                ? 'Enregistrement…'
                : "Enregistrer l'acceptation"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modale — Modifier N camions (multi-camions MTS-1, RM-02) */}
      <Modal
        open={nbCamionsModal}
        title="Modifier le nombre de camions"
        onClose={() => setNbCamionsModal(false)}
      >
        {nbCamionsError && (
          <AlertBar variant="err" className="mb-4">
            {nbCamionsError}
          </AlertBar>
        )}
        <form
          onSubmit={(e) => void handleModifierNbCamions(e)}
          className="space-y-4"
        >
          <Text>
            L&apos;adapter crée N tournées (1 par camion). Réduire N à moins
            d&apos;1 h de la mission est bloqué (alerte Ops). Non modifiable sur
            un statut terminal.
          </Text>
          <div>
            <label
              className="mb-1 block text-sm font-medium text-savr-neutral-700"
              htmlFor="nb-camions-input"
            >
              Nombre de camions
            </label>
            <Input
              id="nb-camions-input"
              type="number"
              min={1}
              max={10}
              value={nbCamionsValue}
              onChange={(e) => setNbCamionsValue(e.target.value)}
              className="w-32"
              required
            />
          </div>
          <div className="flex justify-end gap-2 border-t border-savr-neutral-100 pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setNbCamionsModal(false)}
              disabled={nbCamionsSubmitting}
            >
              Retour
            </Button>
            <Button
              type="submit"
              disabled={
                nbCamionsSubmitting ||
                Number(nbCamionsValue) < 1 ||
                !Number.isInteger(Number(nbCamionsValue))
              }
            >
              {nbCamionsSubmitting ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
