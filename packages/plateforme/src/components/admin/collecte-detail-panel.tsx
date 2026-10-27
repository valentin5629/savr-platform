'use client';

import { fmtEuro, fmtPax, fmtKgAuto } from '@/lib/format';
import { libelleStatutFacture } from '@/lib/libelles/facture';
import { libelleTypePack } from '@/lib/libelles/pack';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import {
  Truck,
  Send,
  AlertTriangle,
  Settings2,
  Download,
  RotateCw,
  PhoneCall,
  MapPin,
  HeartHandshake,
  CalendarDays,
  Clock,
  Users,
  Building2,
  PlusCircle,
} from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Combobox } from '@/components/ui/combobox';
import { FormField } from '@/components/ui/form-field';
import { FormGrid } from '@/components/ui/form-grid';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertBar } from '@/components/ui/alert-bar';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { Modal } from '@/components/ui/modal';
import { Timeline, TimelineItem } from '@/components/ui/timeline';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { IssueInfosAcces } from '@/lib/infos-acces/notify';
import type { SuiviEmailInfosAcces } from '@/lib/infos-acces/suivi-email';
import { CollecteStatutPastille } from './collecte-statut-pastille';
import { AttributionAgForm } from './attribution-ag-form';
import { PlaqueTmsPicto } from '@/components/collectes/plaque-tms-picto';
import {
  ChampsBesoinVehicule,
  NB_VEHICULES_MAX,
  TYPES_VEHICULE_OPTIONS,
  nbVehiculesValide,
} from './champs-besoin-vehicule';
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
  LIBELLE_SANS_EXCEDENT,
  statutCollecteDisplay,
  type StatutCollecteDb,
} from '@/lib/statut-collecte-labels';
import { statutCollecteAdmin } from '@/lib/statut-collecte-admin';
import { FLUX_ZD } from '@/lib/libelles/flux';
import { statutTmsDisplay } from '@/lib/statut-tms-labels';
import { PAX_COLLECTE_MAX } from '@/lib/pax-collecte-borne';
import { paxSaisiValide } from '@/lib/programmation/cartes-saisie';
import { estADispatcher, estModifieeSansRenvoi } from '@/lib/collectes-chips';
import { TENTATIVES_MAX_ORDRE, type OrdreEnvoi } from '@/lib/ordre-envoi';
import {
  formatDateParis,
  formatHeureParis,
} from '@savr/shared/src/temps/index.js';
import {
  envoiAutomatique,
  libelleCanalEnvoi,
  libelleDispatch,
  libelleTypeTms,
} from '@/lib/type-tms-labels';
import {
  dateLongueCapitalisee,
  TelephoneLien,
} from '@/components/collecte/fiche-blocs';
import {
  AjoutContactSecours,
  CarteContact,
  GRILLE_3,
  SectionInfos,
} from '@/components/collecte/fiche-collecte-client-onglets';
import { InfoEnTete } from '@/components/collecte/fiche-collecte-client-panel';
import { InfoItem } from '@/components/ui/info-item';
import { EnTeteMention } from '@/components/ui/fiche/fiche-en-tete';
import { FicheCorps, FichePied } from '@/components/ui/fiche/fiche-modal';
import { TypeCollecteBadge } from '@/components/ui/type-collecte-badge';
import { libelleTypeCollecte } from '@/lib/libelles/type-collecte';
import { refCourteCollecte } from '@/lib/collecte-ref';
import { ROUTES } from '@/lib/routes';
import type { FicheCollecteMeta } from '@/components/collecte/fiche-collecte-modal-cadre';
import { Text } from '@/components/ui/text';
import { FormActions } from '@/components/ui/form-actions';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ChoiceCard } from '@/components/ui/choice-card';
import { FileButton } from '@/components/ui/file-button';
import { Checkbox } from '@/components/ui/checkbox';
import { telechargerRapportRecyclage } from '@/lib/collectes/rapport-telechargement-client';
import { Label } from '@/components/ui/label';
import { MAX_PHOTOS_CLIENT } from '@/lib/collectes/photos-client';
import {
  BilanCollecte,
  useRadarFiche,
  type BilanFiche,
} from '@/components/collecte/fiche-collecte-client-bilan';
import { tailleBracket } from '@/lib/dashboard-kpi';

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
  // Flux pris en charge (`anti_gaspi` / `zero_dechet`) — peut manquer au
  // référentiel : absent = aucun filtre.
  types_collecte?: string[] | null;
}

// Transporteur proposable pour une ZD (décision Val 2026-10-07 : l'Admin choisit
// le prestataire sur la fiche). Relié à un prestataire — c'est lui que le
// dispatch pose sur la collecte (une AG garde en repli le transporteur de son
// attribution) — et, quand le référentiel le renseigne, prenant les ZD. Jamais
// A Toutes! : son envoi exige l'association destinataire d'une AG, une ZD y
// finirait en échec définitif.
function proposableEnZd(t: Transporteur): boolean {
  return (
    t.prestataire_logistique_id != null &&
    t.type_tms !== 'a_toutes' &&
    (!t.types_collecte?.length || t.types_collecte.includes('zero_dechet'))
  );
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

// Statuts DB proposés au forçage manuel (RM-08). `brouillon` n'y est pas : un
// brouillon n'apparaît dans aucune liste Admin (décision Val 2026-10-07), y
// forcer une collecte la ferait disparaître du back-office.
const STATUTS_FORCABLES: StatutCollecteDb[] = [
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

interface ContactsCollecteDetail {
  contact_principal_nom: string | null;
  contact_principal_telephone: string | null;
  contact_secours_nom: string | null;
  contact_secours_telephone: string | null;
}

// PostgREST rend l'embed 1–1 en objet ; le tableau reste accepté.
function contactsDe(
  v: ContactsCollecteDetail | ContactsCollecteDetail[] | null | undefined,
): ContactsCollecteDetail | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

interface CollecteDetail {
  id: string;
  evenement_id: string;
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
  // État réel de l'email « infos d'accès », lu dans le journal des emails par
  // GET /admin/collectes/[id] (null si la collecte n'exige pas de contrôle d'accès).
  infos_acces_email?: SuiviEmailInfosAcces | null;
  notes_internes: string | null;
  informations_supplementaires: string | null;
  motif_override_prestataire: string | null;
  annulee_cote_savr: boolean;
  // Bilan de l'onglet Documents (valeurs figées à la clôture).
  taux_recyclage?: number | null;
  co2_evite_kg?: number | null;
  realisee_at?: string | null;
  aucun_repas_motif?: string | null;
  pack_antgaspi_id: string | null;
  packs_antgaspi: {
    id: string;
    type_pack: string;
    credits_restants: number;
    statut: string;
  } | null;
  // Collecte AG sans pack rattachable après coup au pack actif de son organisation
  // (décision Val 2026-10-16) — null si elle ne l'est pas ; `pack_actif` null tant
  // que le client n'a pas de pack actif.
  rattachement_pack?: {
    pack_actif: {
      id: string;
      type_pack: string;
      credits_initiaux: number;
      credits_restants: number;
    } | null;
  } | null;
  // Attribution AG (Bloc 5) — asso/transporteur retenus + volume réalisé (§06.06 l.249).
  attributions_antgaspi: {
    id: string;
    mode_validation: string;
    valide_at: string | null;
    volume_repas_realise: number | null;
    associations: {
      nom: string;
      ville?: string | null;
      description_rapport_impact?: string | null;
    } | null;
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
  // Ordre de tête de la collecte dans la file d'envoi au prestataire, lu par la
  // route détail (`lib/ordre-envoi`) ; null quand plus rien n'est en file.
  ordre_envoi?: OrdreEnvoi | null;
  // Surcharge per-collecte du lieu (§04 `collectes.lieu_overrides`) : prime sur
  // la référence `lieux` pour cette collecte seulement.
  lieu_overrides?: Record<string, unknown> | null;
  // Nombre de convives de la collecte (décision Val 2026-10-20) ; celui de
  // l'événement en est calculé (somme des jours) : jamais affiché à sa place.
  pax: number;
  // Type d'événement et contacts de LA collecte (refonte du formulaire, lot B1,
  // décision Val 2026-10-23) ; l'événement n'en garde qu'une copie.
  type_evenement_id?: string | null;
  type_evenement?: { libelle: string } | null;
  contacts?: ContactsCollecteDetail | ContactsCollecteDetail[] | null;
  evenements: {
    nom_evenement: string | null;
    pax: number;
    type_evenement_id?: string | null;
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
      type_vehicule: string | null;
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

// Référentiel des 5 flux ZD V1 (figé — seed flux_dechets ; source unique
// `lib/libelles/flux`, R-UI-2 C12). Sert à afficher tous les flux dans Bloc 3
// même quand collecte_flux n'a pas encore de ligne (pesées dérivées de
// pesees_tournees à l'agrégation, ou saisie manuelle Admin).
const ZD_FLUX = FLUX_ZD.map((f) => ({ code: f.code, nom: f.label }));

// Bloc 3 — Documents (GET /[id]/documents).
interface RapportDoc {
  id: string;
  version: number;
  disponible_a: string | null;
  genere_at: string | null;
  regenere_at: string | null;
  consulte_par_user_at: string | null;
  pdf_url: string | null;
  /** Téléchargeable maintenant (fin d'embargo ; rapport ZD fabriqué au clic). */
  disponible: boolean;
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
  // Photo choisie par l'équipe Savr pour le client (2 au maximum par collecte).
  visible_client: boolean;
  url: string | null;
}
interface DocumentsData {
  rapport: RapportDoc | null;
  bordereau: BordereauDoc | null;
  attestation: AttestationDoc | null;
  photos: PhotoItem[];
}

// Ligne d'un document (rapport, bordereau, rapport de don) qui n'existe pas encore :
// un seul texte, quel que soit le statut de la collecte (décision Val 2026-10-09).
const DOCUMENT_A_VENIR = 'Généré sous 48h après la collecte';

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
type PdfType =
  | 'rapport-recyclage-zd'
  | 'rapport-evenement-sans-excedent'
  | 'bordereau-zd'
  | 'attestation-don';

function Vide({ children = '—' }: { children?: React.ReactNode }) {
  return <span className="text-savr-neutral-400">{children}</span>;
}

function DifficulteBadge({ valeur }: { valeur?: string | null }) {
  if (!valeur) return <>—</>;
  return (
    <Badge variant={DIFFICULTE_VARIANT[valeur] ?? 'neutral'}>
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
    <ChoiceCard
      mode="radio"
      selected={coche}
      tabIndex={focusable ? 0 : -1}
      onClick={onSelect}
      className="flex min-h-11 items-start gap-3 p-3 text-sm"
    >
      <span
        aria-hidden
        className={cn(
          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-savr-full border-2',
          coche ? 'border-savr-primary-600' : 'border-savr-neutral-300',
        )}
      >
        {coche && (
          <span className="h-1.5 w-1.5 rounded-savr-full bg-savr-primary-600" />
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
    </ChoiceCard>
  );
}

// Relecture automatique de la fiche pendant l'envoi : toutes les 2 secondes,
// 15 fois au plus (30 secondes).
const RELECTURE_MS = 2_000;
const RELECTURES_MAX = 15;

// Ordre en file d'envoi : le dispatch a posé le prestataire chez un adapter, un
// ordre attend dans la file et la commande n'est pas encore revenue avec sa
// référence (détail au point d'usage).
function ordreEnFile(collecte: CollecteDetail): boolean {
  return (
    collecte.prestataire_logistique_id != null &&
    envoiAutomatique(collecte.prestataire_actuel?.type_tms) &&
    estADispatcher(collecte) &&
    collecte.ordre_envoi != null
  );
}

const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? 's' : ''}`;

// Encart du bloc « Prestataire & Dispatch » : ce qu'il est advenu de l'ordre
// envoyé au prestataire (décision Val 2026-10-12, C6).
//
// Collecte en file d'envoi (pas encore de référence TMS) :
//   · ordre en file ou en cours → la collecte est dite envoyée ;
//   · ordre en échec, une reprise est planifiée → on dit quand ;
//   · ordre abandonné → on dit que rien n'est transmis, et qu'un renvoi ne
//     partira pas tant que l'ordre n'est pas débloqué (head-of-line ; le
//     déblocage est une procédure technique en V1, §04 « Déblocage DLQ »).
//
// Hors file d'envoi (référence déjà enregistrée, ou collecte qui n'est plus à
// dispatcher : annulée, en cours…) : seul un échec est signalé.
//   · modification ou annulation en échec → c'est elle qui n'est pas passée ;
//   · ordre de CRÉATION en échec ALORS QU'une référence est enregistrée → la
//     collecte, elle, EST transmise (acceptation manuelle A Toutes! pendant
//     une panne, ou véhicule supplémentaire non commandé) : on dit seulement
//     qu'un ordre reste en échec, et qu'abandonné il retient les suivants ;
//   · ordre de création en échec SANS référence (collecte annulée avant
//     l'envoi, par exemple) → la collecte n'est pas transmise, on le dit.
function EncartOrdreEnvoi({
  ordre,
  enFile,
  referenceRecue,
  prestataire,
  canal,
}: {
  ordre: OrdreEnvoi | null;
  enFile: boolean;
  /** Une référence TMS est enregistrée sur la collecte. */
  referenceRecue: boolean;
  prestataire: string | undefined;
  canal: string | null;
}) {
  const enEchec =
    ordre?.etat === 'echec_reprise' || ordre?.etat === 'echec_definitif';
  if (!enFile && !enEchec) return null;

  const aPrestataire = prestataire ? `à ${prestataire}` : 'au prestataire';
  if (!ordre || !enEchec) {
    return (
      <AlertBar variant="info">
        <span>
          Collecte envoyée {aPrestataire}
          {aPrestataire.endsWith('!') ? '' : '.'}{' '}
          <span className="font-normal">
            La commande part vers {canal ?? 'le prestataire'} dans les secondes
            qui suivent l’envoi ; à défaut, au prochain passage automatique. Le
            statut « Attente acceptation presta » s’affichera ici dès sa prise
            en compte.
          </span>
        </span>
      </AlertBar>
    );
  }

  const abandonne = ordre.etat === 'echec_definitif';
  const tentatives = abandonne
    ? `après ${pluriel(ordre.tentatives, 'tentative')}`
    : `tentative ${ordre.tentatives} sur ${TENTATIVES_MAX_ORDRE}`;
  // Une date de reprise déjà passée ne s'affiche pas : l'ordre attend le
  // prochain passage.
  const reprise =
    ordre.prochaine_tentative_at &&
    Date.parse(ordre.prochaine_tentative_at) > Date.now()
      ? `Nouvelle tentative automatique le ${formatDateParis(ordre.prochaine_tentative_at)} à ${formatHeureParis(ordre.prochaine_tentative_at)}.`
      : 'Nouvelle tentative au prochain passage automatique.';
  const motif = ordre.erreur ? (
    <span className="mt-1 block font-normal">Motif : {ordre.erreur}</span>
  ) : null;

  let constat: string;
  let suite: string;
  if (referenceRecue && ordre.nature === 'creation') {
    constat = abandonne
      ? `Un ordre d’envoi ${aPrestataire} a été abandonné ${tentatives}, alors que la commande porte déjà une référence.`
      : `Un ordre d’envoi ${aPrestataire} est encore en reprise (${tentatives}), alors que la commande porte déjà une référence.`;
    suite = abandonne
      ? 'Les ordres suivants de cette collecte (modification, annulation, véhicule supplémentaire) ne partiront pas tant qu’il n’est pas débloqué par l’équipe technique.'
      : reprise;
  } else {
    const objet =
      ordre.nature === 'modification'
        ? 'La modification de la collecte'
        : ordre.nature === 'annulation'
          ? 'L’annulation de la collecte'
          : 'La collecte';
    constat = abandonne
      ? `${objet} n’est pas transmise ${aPrestataire} : envoi abandonné ${tentatives}.`
      : `${objet} n’a pas encore été transmise ${aPrestataire} (${tentatives}).`;
    suite = abandonne
      ? 'Un nouvel envoi depuis cette fiche ne partira pas tant que cet ordre n’est pas débloqué par l’équipe technique.'
      : reprise;
  }

  return (
    <AlertBar variant={abandonne ? 'err' : 'warn'}>
      <span>
        {constat} <span className="font-normal">{suite}</span>
        {motif}
      </span>
    </AlertBar>
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

const STATUTS_TERMINAUX = [
  'realisee',
  'cloturee',
  'annulee',
  'realisee_sans_collecte',
];

// Bloc « Chauffeur » : une ligne par camion DEMANDÉ (rangs 1..N, décision Val
// 2026-10-06 C2), qu'il ait déjà sa tournée (créée par l'adapter au dispatch)
// ou non (la saisie Admin crée alors la tournée du rang, que l'adapter reprend
// ensuite). Collecte terminée : seules les tournées existantes — même liste
// pour l'affichage ET le pré-remplissage du formulaire (jamais de tournée
// créée sur une collecte finie).
function rangsChauffeurDe(c: {
  statut: string;
  nb_camions_demande: number | null;
  collecte_tournees: Array<{ rang: number }>;
}): number[] {
  const terminal = STATUTS_TERMINAUX.includes(c.statut);
  const rangsExistants = new Set(c.collecte_tournees.map((ct) => ct.rang));
  const nbVises = terminal ? 0 : Math.max(1, c.nb_camions_demande ?? 1);
  return Array.from(
    { length: Math.max(nbVises, ...rangsExistants, 0) },
    (_, i) => i + 1,
  ).filter((rang) => !terminal || rangsExistants.has(rang));
}

// Clé de saisie d'un camion : id de tournée, ou `rang:N` sans tournée.
const CLE_RANG = 'rang:';

type SaisieChauffeur = {
  plaque_immatriculation: string;
  chauffeur_nom: string;
  chauffeur_telephone: string;
  accompagnant_nom: string;
  accompagnant_telephone: string;
};
const CHAMPS_SAISIE_CHAUFFEUR = [
  'plaque_immatriculation',
  'chauffeur_nom',
  'chauffeur_telephone',
  'accompagnant_nom',
  'accompagnant_telephone',
] as const;

// Après une erreur d'enregistrement, la fiche rechargée peut avoir gagné des
// tournées (créées par le prestataire) ou perdu des camions (collecte
// terminée) : les clés `rang:N` sont ré-ancrées sur la tournée du rang — la
// saisie de l'Admin prime, un champ laissé vide prend la valeur remontée — et
// les camions qui ne sont plus listés sont retirés.
function reancrerSaisieChauffeur(
  prev: Record<string, SaisieChauffeur>,
  fraiche: {
    statut: string;
    nb_camions_demande: number | null;
    collecte_tournees: Array<{
      rang: number;
      tournees: { id: string } & Partial<
        Record<(typeof CHAMPS_SAISIE_CHAUFFEUR)[number], string | null>
      >;
    }>;
  },
): Record<string, SaisieChauffeur> {
  const rangs = new Set(rangsChauffeurDe(fraiche));
  const suivant: Record<string, SaisieChauffeur> = {};
  for (const [cle, v] of Object.entries(prev)) {
    if (!cle.startsWith(CLE_RANG)) {
      suivant[cle] = v;
      continue;
    }
    const rang = Number(cle.slice(CLE_RANG.length));
    if (!rangs.has(rang)) continue;
    const ct = fraiche.collecte_tournees.find((x) => x.rang === rang);
    if (!ct) {
      suivant[cle] = v;
      continue;
    }
    const fusion = { ...v };
    for (const champ of CHAMPS_SAISIE_CHAUFFEUR) {
      if (v[champ].trim() === '') fusion[champ] = ct.tournees[champ] ?? '';
    }
    suivant[ct.tournees.id] = fusion;
  }
  return suivant;
}
function cleSaisieDe(
  c: { collecte_tournees: Array<{ rang: number; tournees: { id: string } }> },
  rang: number,
): string {
  return (
    c.collecte_tournees.find((ct) => ct.rang === rang)?.tournees.id ??
    `${CLE_RANG}${rang}`
  );
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
  const [annulerCreditSubmitting, setAnnulerCreditSubmitting] = useState(false);
  const [annulerCreditError, setAnnulerCreditError] = useState<string | null>(
    null,
  );
  const [rattacherPackModal, setRattacherPackModal] = useState(false);
  const [rattacherPackSubmitting, setRattacherPackSubmitting] = useState(false);
  const [rattacherPackError, setRattacherPackError] = useState<string | null>(
    null,
  );
  // Facture unitaire déjà numérotée au moment du rattachement (partie chez
  // Pennylane, ou rejetée et revenue en brouillon avec son numéro) : jamais
  // retirée, l'Admin la corrige ou émet l'avoir (arbitrage Val 2026-10-16).
  const [factureNumerotee, setFactureNumerotee] = useState(false);
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
  const [renvoiEmailEnCours, setRenvoiEmailEnCours] = useState(false);
  // Succès de l'enregistrement des infos d'accès = toast (R-UI-1 H1).
  const { toast } = useToast();
  // Bloc 0 — dispatch prestataire (BOA-06)
  const [transporteurs, setTransporteurs] = useState<Transporteur[]>([]);
  const [selectedTransporteurId, setSelectedTransporteurId] = useState('');
  // Besoin véhicule saisi au choix du prestataire (décision Val 2026-10-27) :
  // null = non touché, la valeur de la collecte s'affiche et rien n'est envoyé.
  const [typeVehiculeSaisi, setTypeVehiculeSaisi] = useState<string | null>(
    null,
  );
  const [nbVehiculesSaisi, setNbVehiculesSaisi] = useState<string | null>(null);
  // Ordre en file d'envoi : les cartes prestataire et le bouton d'envoi ne
  // reviennent que sur demande explicite (« Changer de prestataire »).
  const [changerPrestataire, setChangerPrestataire] = useState(false);
  // Focus clavier : à l'ouverture, sur la carte cochée ; à la fermeture, de
  // retour sur « Changer de prestataire » (les deux boutons disparaissent au clic).
  const dispatchChoixRef = useRef<HTMLDivElement>(null);
  const changerPrestataireBtnRef = useRef<HTMLButtonElement>(null);
  const retourFocusChangerRef = useRef(false);
  useEffect(() => {
    if (changerPrestataire) {
      // La carte « focusable » (cochée, sinon la 1re) porte déjà tabIndex 0.
      dispatchChoixRef.current
        ?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')
        ?.focus();
    } else if (retourFocusChangerRef.current) {
      retourFocusChangerRef.current = false;
      changerPrestataireBtnRef.current?.focus();
    }
  }, [changerPrestataire]);
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
  // Nombre de pax de la collecte, modifié par l'équipe Savr avec un motif
  // (décision Val 2026-10-21, §05 R_pax_collecte).
  const [paxModal, setPaxModal] = useState(false);
  const [paxValue, setPaxValue] = useState('');
  const [paxMotif, setPaxMotif] = useState('');
  const [paxSubmitting, setPaxSubmitting] = useState(false);
  const [paxError, setPaxError] = useState<string | null>(null);
  // Type d'événement et contacts de la collecte, modifiés par l'équipe Savr
  // sans motif (décisions Val 2026-10-23, B1-Q1 et B1-Q3).
  const [infosModal, setInfosModal] = useState(false);
  const [infosType, setInfosType] = useState('');
  const [infosCpNom, setInfosCpNom] = useState('');
  const [infosCpTel, setInfosCpTel] = useState('');
  const [infosCsNom, setInfosCsNom] = useState('');
  const [infosCsTel, setInfosCsTel] = useState('');
  const [infosSubmitting, setInfosSubmitting] = useState(false);
  const [infosError, setInfosError] = useState<string | null>(null);
  const [typesEvenement, setTypesEvenement] = useState<
    Array<{ id: string; libelle: string }>
  >([]);
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
  // Rapport de recyclage ZD : avec ou sans le radar de comparaison, au choix de
  // celui qui le télécharge ; la case part décochée.
  const [avecRadar, setAvecRadar] = useState(false);
  const [fabrication, setFabrication] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoEnCours, setPhotoEnCours] = useState<string | null>(null);
  const nbPhotosClient = (documents?.photos ?? []).filter(
    (p) => p.visible_client,
  ).length;
  // Documents d'une collecte AG : UNE seule ligne, toujours nommée « Rapport de
  // don » (décision Val 2026-10-09). Deux PDF distincts derrière ce nom :
  //   - avec excédents : l'attestation de don (attestations_don) ;
  //   - sans excédents (`realisee_sans_collecte`) : le rapport « Événement sans
  //     excédent alimentaire », porté par rapports_rse comme le rapport ZD.
  // La ligne du rapport sert donc la collecte ZD (« Rapport RSE ») et la collecte
  // AG sans excédents (« Rapport de don ») ; jamais une collecte AG avec don.
  const agSansExcedent =
    collecte?.type === 'anti_gaspi' &&
    collecte.statut === 'realisee_sans_collecte';
  const afficherRapport = collecte?.type === 'zero_dechet' || agSansExcedent;
  const typeRapport: PdfType = agSansExcedent
    ? 'rapport-evenement-sans-excedent'
    : 'rapport-recyclage-zd';
  // Radar du bilan de l'onglet Documents (celui de la fiche client, décision Val
  // 2026-10-16) : ses filtres sont ceux du rapport régénéré avec radar.
  const radar = useRadarFiche(
    `/api/v1/admin/collectes/${encodeURIComponent(collecteId)}/benchmark`,
    collecte,
  );
  // Radar à l'écran : seul cas où les filtres de la barre font foi pour le rapport.
  const choixRadarPossible = radar.visible && !radar.indisponible;

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

  // Rapport de recyclage ZD fabriqué au clic, avec ou sans le radar de l'onglet
  // (décision Val 2026-10-16). Sans radar à l'écran, le serveur compare au
  // segment de la collecte.
  const telechargerRapportZd = async () => {
    setDocError(null);
    setFabrication(true);
    const erreur = await telechargerRapportRecyclage(
      `/api/v1/admin/collectes/${encodeURIComponent(collecteId)}/rapport-rse`,
      {
        options: { benchmark: avecRadar },
        ...(avecRadar && choixRadarPossible && radar.filtres
          ? {
              benchmark_filters: {
                lieu_ids: radar.filtres.lieu_ids,
                type_evenement_ids: radar.filtres.type_evenement_ids,
                taille_evenement_codes: radar.filtres.taille_evenement_codes,
              },
            }
          : {}),
      },
    );
    setFabrication(false);
    setDocError(erreur);
  };

  // Régénération d'un PDF stocké (§06.06 l.283-284) — ré-enqueue jobs_pdf côté
  // serveur : bordereau, attestation, rapport « sans excédent ».
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

  // Choisir / retirer une photo visible du client (PATCH …/photos/<id>).
  const handlePhotoClient = async (photoId: string, visible: boolean) => {
    setPhotoEnCours(photoId);
    setDocError(null);
    const res = await fetch(
      `/api/v1/admin/collectes/${encodeURIComponent(collecteId)}/photos/${encodeURIComponent(photoId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visible_client: visible }),
      },
    );
    if (res.ok) {
      await refetchDocuments();
      await refetchAudit();
    } else {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setDocError(body.error ?? 'Choix de la photo impossible');
    }
    setPhotoEnCours(null);
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

  // Relecture automatique (décision Val 2026-10-12, C6) : l'envoi part en
  // arrière-plan juste après le clic, la référence TMS arrive quelques secondes
  // plus tard. Tant que l'ordre est en file ou en cours, la fiche se relit
  // seule — un nombre borné de fois : au-delà, on rouvre la fiche.
  const [relecturesRestantes, setRelecturesRestantes] =
    useState(RELECTURES_MAX);
  useEffect(() => {
    setRelecturesRestantes(RELECTURES_MAX);
  }, [collecteId]);
  const envoiEnVol =
    collecte != null &&
    ordreEnFile(collecte) &&
    collecte.ordre_envoi?.etat !== 'echec_reprise' &&
    collecte.ordre_envoi?.etat !== 'echec_definitif';
  useEffect(() => {
    if (!envoiEnVol || relecturesRestantes <= 0) return;
    const minuterie = setTimeout(() => {
      setRelecturesRestantes((n) => n - 1);
      void refetch();
    }, RELECTURE_MS);
    return () => clearTimeout(minuterie);
  }, [envoiEnVol, relecturesRestantes, refetch]);

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

  // ZD à dispatcher avec UN seul transporteur proposable (cas courant : un
  // unique prestataire ZD au référentiel) : il est présélectionné, l'Admin n'a
  // plus qu'à envoyer. Plusieurs candidats : aucun n'est coché d'office.
  useEffect(() => {
    if (
      collecteType !== 'zero_dechet' ||
      collecteStatut !== 'programmee' ||
      dejaAttribuee
    ) {
      return;
    }
    const candidats = transporteurs.filter(proposableEnZd);
    const seul = candidats.length === 1 ? candidats[0] : undefined;
    if (seul) setSelectedTransporteurId((prev) => prev || seul.id);
  }, [collecteType, collecteStatut, dejaAttribuee, transporteurs]);

  const handleAnnulerCredit = async (motif: string) => {
    setAnnulerCreditSubmitting(true);
    setAnnulerCreditError(null);
    const res = await fetch(
      `/api/v1/admin/collectes/${encodeURIComponent(collecteId)}/annuler-credit`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ motif }),
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

  const handleRattacherPack = async () => {
    setRattacherPackSubmitting(true);
    setRattacherPackError(null);
    try {
      const res = await fetch(
        `/api/v1/admin/collectes/${encodeURIComponent(collecteId)}/rattacher-pack`,
        { method: 'POST' },
      );
      const corps = (await res.json().catch(() => ({}))) as {
        facture_numerotee?: boolean;
        error?: string;
      };
      if (!res.ok) {
        setRattacherPackError(corps.error ?? 'Rattachement impossible.');
        return;
      }
      setFactureNumerotee(corps.facture_numerotee === true);
      setRattacherPackModal(false);
      const updated = await fetch(
        `/api/v1/admin/collectes/${encodeURIComponent(collecteId)}`,
      );
      if (updated.ok) setCollecte((await updated.json()) as CollecteDetail);
      void refetchAudit();
    } catch {
      setRattacherPackError('Rattachement impossible : réseau indisponible.');
    } finally {
      setRattacherPackSubmitting(false);
    }
  };

  const handleDispatch = async () => {
    setDispatching(true);
    setDispatchError(null);
    // Prestataire choisi (AG ou ZD) → on envoie son prestataire_logistique_id
    // (pont R5). Sans changement (re-send) → body vide = réémission dispatch
    // idempotente.
    const selected = transporteurs.find((t) => t.id === selectedTransporteurId);
    const body: Record<string, unknown> = {};
    // Besoin véhicule : seulement les champs modifiés, écrits avant l'envoi.
    if (besoinEditable && collecte) {
      if (
        nbVehiculesSaisi !== null &&
        Number(nbVehiculesSaisi) !== collecte.nb_camions_demande
      ) {
        if (!nbVehiculesValide(nbVehiculesSaisi)) {
          setDispatchError(
            `Nombre de véhicules invalide (entier entre 1 et ${NB_VEHICULES_MAX})`,
          );
          setDispatching(false);
          return;
        }
        body.nb_camions_demande = Number(nbVehiculesSaisi);
      }
      if (
        typeVehiculeSaisi !== null &&
        typeVehiculeSaisi !== (collecte.type_vehicule_souhaite ?? '')
      ) {
        body.type_vehicule_souhaite = typeVehiculeSaisi || null;
      }
    }
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
      setRelecturesRestantes(RELECTURES_MAX);
      setSelectedTransporteurId('');
      setMotifOverride('');
      setTypeVehiculeSaisi(null);
      setNbVehiculesSaisi(null);
      // Mode « changer » ouvert → il se referme : rendre le focus au bouton
      // « Changer de prestataire » plutôt que de le perdre en haut de page.
      retourFocusChangerRef.current = changerPrestataire;
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

  // Pax de la collecte : la route valide l'entier (1 à 100 000) et le motif
  // (≥ 10 car.), et trace le motif dans l'audit.
  const handleModifierPax = async (e: React.FormEvent) => {
    e.preventDefault();
    setPaxSubmitting(true);
    setPaxError(null);
    const res = await fetch(
      `/api/v1/admin/collectes/${encodeURIComponent(collecteId)}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pax: Number(paxValue), motif: paxMotif }),
      },
    );
    if (res.ok) {
      await refetch();
      setPaxModal(false);
    } else {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setPaxError(body.error ?? 'Modification impossible');
    }
    setPaxSubmitting(false);
  };

  // Type d'événement et contacts : seuls les champs modifiés partent ; la route
  // les valide (contact principal jamais vide, type du référentiel) et trace la
  // modification dans l'audit.
  const ouvrirInfosCollecte = () => {
    if (!collecte) return;
    const ct = contactsDe(collecte.contacts);
    setInfosType(collecte.type_evenement_id ?? '');
    setInfosCpNom(ct?.contact_principal_nom ?? '');
    setInfosCpTel(ct?.contact_principal_telephone ?? '');
    setInfosCsNom(ct?.contact_secours_nom ?? '');
    setInfosCsTel(ct?.contact_secours_telephone ?? '');
    setInfosError(null);
    setInfosModal(true);
    if (typesEvenement.length === 0) {
      void fetch('/api/v1/programmation/types-evenements')
        .then((r) => (r.ok ? r.json() : []))
        .then((j: unknown) =>
          setTypesEvenement(
            Array.isArray(j)
              ? (j as Array<{ id: string; libelle: string }>)
              : [],
          ),
        )
        .catch(() => setTypesEvenement([]));
    }
  };

  const handleModifierInfos = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!collecte) return;
    const ct = contactsDe(collecte.contacts);
    const maj: Record<string, unknown> = {};
    if (infosType && infosType !== (collecte.type_evenement_id ?? ''))
      maj.type_evenement_id = infosType;
    if (infosCpNom !== (ct?.contact_principal_nom ?? ''))
      maj.contact_principal_nom = infosCpNom;
    if (infosCpTel !== (ct?.contact_principal_telephone ?? ''))
      maj.contact_principal_telephone = infosCpTel;
    if (infosCsNom !== (ct?.contact_secours_nom ?? ''))
      maj.contact_secours_nom = infosCsNom || null;
    if (infosCsTel !== (ct?.contact_secours_telephone ?? ''))
      maj.contact_secours_telephone = infosCsTel || null;
    if (Object.keys(maj).length === 0) {
      setInfosModal(false);
      return;
    }
    setInfosSubmitting(true);
    setInfosError(null);
    const res = await fetch(
      `/api/v1/admin/collectes/${encodeURIComponent(collecteId)}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(maj),
      },
    );
    if (res.ok) {
      await refetch();
      setInfosModal(false);
    } else {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setInfosError(body.error ?? 'Modification impossible');
    }
    setInfosSubmitting(false);
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
    const parRang = new Map(
      collecte.collecte_tournees.map((ct) => [ct.rang, ct] as const),
    );
    for (const rang of rangsChauffeurDe(collecte)) {
      const ct = parRang.get(rang);
      prefill[cleSaisieDe(collecte, rang)] = {
        plaque_immatriculation: ct?.tournees.plaque_immatriculation ?? '',
        chauffeur_nom: ct?.tournees.chauffeur_nom ?? '',
        chauffeur_telephone: ct?.tournees.chauffeur_telephone ?? '',
        accompagnant_nom: ct?.tournees.accompagnant_nom ?? '',
        accompagnant_telephone: ct?.tournees.accompagnant_telephone ?? '',
      };
    }
    setInfosAccesInput(prefill);
    setInfosAccesError(null);
    setEditInfosAcces(true);
  };

  const handleSaveInfosAcces = async (e: React.FormEvent) => {
    e.preventDefault();
    setInfosAccesSaving(true);
    setInfosAccesError(null);
    const tournees = Object.entries(infosAccesInput)
      // Camion sans tournée laissé vide : rien à créer (la route refuserait,
      // et une tournée vide occuperait le rang pour l'adapter).
      .filter(
        ([cle, v]) =>
          !cle.startsWith(CLE_RANG) ||
          Object.values(v).some((val) => val.trim() !== ''),
      )
      .map(([cle, v]) => ({
        // Camion sans tournée : la route la crée (rang ≤ nb_camions_demande).
        ...(cle.startsWith(CLE_RANG)
          ? { rang: Number(cle.slice(CLE_RANG.length)) }
          : { tournee_id: cle }),
        plaque_immatriculation: v.plaque_immatriculation,
        chauffeur_nom: v.chauffeur_nom,
        chauffeur_telephone: v.chauffeur_telephone,
        accompagnant_nom: v.accompagnant_nom,
        accompagnant_telephone: v.accompagnant_telephone,
      }));
    if (tournees.length === 0) {
      setInfosAccesError('Aucune coordonnée saisie.');
      setInfosAccesSaving(false);
      return;
    }
    const res = await fetch(
      `/api/v1/admin/collectes/${encodeURIComponent(collecteId)}/infos-acces`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tournees }),
      },
    );
    if (res.ok) {
      const body = (await res.json()) as {
        email_envoye: boolean;
        email?: IssueInfosAcces;
      };
      const updated = await fetch(
        `/api/v1/admin/collectes/${encodeURIComponent(collecteId)}`,
      );
      if (updated.ok) setCollecte((await updated.json()) as CollecteDetail);
      // Le message dit ce qu'il est advenu de l'email, pas seulement de la saisie.
      const issue = body.email ?? (body.email_envoye ? 'envoye' : 'sans_objet');
      toast(
        issue === 'envoye'
          ? {
              title:
                'Infos enregistrées — email récapitulatif envoyé au programmateur.',
              variant: 'success',
            }
          : issue === 'en_reprise'
            ? {
                title:
                  'Infos enregistrées. L’email au programmateur n’est pas parti : une nouvelle tentative aura lieu automatiquement.',
                variant: 'warning',
              }
            : issue === 'non_envoye'
              ? {
                  title:
                    'Infos enregistrées. L’email au programmateur n’a pas pu être envoyé.',
                  variant: 'warning',
                }
              : { title: 'Infos enregistrées.', variant: 'success' },
      );
      setEditInfosAcces(false);
    } else {
      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      setInfosAccesError(body?.error ?? 'Enregistrement impossible.');
      // La fiche est rechargée : si le prestataire a créé la tournée d'un
      // camion entre-temps (409/422), la saisie en cours se rattache à elle
      // au lieu de rester bloquée sur une clé `rang:N` périmée — champ par
      // champ : ce que l'Admin a tapé prime, un champ laissé vide prend ce que
      // le prestataire a remonté (sinon le ré-enregistrement l'effacerait).
      // Un camion qui n'est plus listé (collecte devenue terminée) est retiré.
      const updated = await fetch(
        `/api/v1/admin/collectes/${encodeURIComponent(collecteId)}`,
      );
      if (updated.ok) {
        const fraiche = (await updated.json()) as CollecteDetail;
        setCollecte(fraiche);
        setInfosAccesInput((prev) => reancrerSaisieChauffeur(prev, fraiche));
      }
    }
    setInfosAccesSaving(false);
  };

  // Renvoi de l'email « infos d'accès » à la demande (email non remis, ou
  // coordonnées changées depuis l'envoi) — décision Val 2026-10-08.
  const handleRenvoiEmailInfosAcces = async () => {
    setRenvoiEmailEnCours(true);
    setInfosAccesError(null);
    const res = await fetch(
      `/api/v1/admin/collectes/${encodeURIComponent(collecteId)}/infos-acces/renvoi`,
      { method: 'POST' },
    );
    const body = (await res.json().catch(() => null)) as {
      email?: IssueInfosAcces;
      error?: string;
    } | null;
    if (res.ok) {
      const issue = body?.email ?? 'sans_objet';
      toast(
        issue === 'envoye'
          ? { title: 'Email envoyé au programmateur.', variant: 'success' }
          : issue === 'en_reprise'
            ? {
                title:
                  'L’email n’est pas parti : une nouvelle tentative aura lieu automatiquement.',
                variant: 'warning',
              }
            : issue === 'non_envoye'
              ? {
                  title: 'L’email au programmateur n’a pas pu être envoyé.',
                  variant: 'warning',
                }
              : {
                  title:
                    'Aucun email n’est parti. Vérifiez que le nom et le téléphone du chauffeur sont renseignés pour chaque camion.',
                  variant: 'warning',
                },
      );
    } else {
      setInfosAccesError(body?.error ?? 'Renvoi impossible.');
    }
    // Dans tous les cas la fiche est rechargée : l'état affiché est celui du
    // journal des emails, pas celui que ce clic espérait.
    const updated = await fetch(
      `/api/v1/admin/collectes/${encodeURIComponent(collecteId)}`,
    );
    if (updated.ok) setCollecte((await updated.json()) as CollecteDetail);
    setRenvoiEmailEnCours(false);
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
      title: `Collecte ${libelleTypeCollecte(collecte.type)} · ${d}${h} · ${collecte.evenements.organisations.raison_sociale} · ${lieu.nom} (${lieu.ville}) · jusqu'à ${fmtPax(collecte.pax)}`,
    });
  }, [collecte, onLoaded]);

  // Miroir de l'état « sous-modale ouverte » pour le wrapper modale (garde Escape).
  const anySubModalOpen =
    annulerCreditModal ||
    rattacherPackModal ||
    forceStatutModal ||
    nbCamionsModal ||
    paxModal ||
    infosModal ||
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
  // Bilan de l'onglet Documents, sous la forme de la fiche client : mêmes
  // valeurs figées, pesées sommées par flux, repas donnés et association de
  // l'attribution AG.
  const attribution = collecte.attributions_antgaspi;
  const bilan: BilanFiche = {
    id: collecte.id,
    type: collecte.type,
    statut: collecte.statut,
    date_collecte: collecte.date_collecte,
    taux_recyclage: collecte.taux_recyclage ?? null,
    co2_evite_kg: collecte.co2_evite_kg ?? null,
    realisee_at: collecte.realisee_at ?? null,
    aucun_repas_motif: collecte.aucun_repas_motif ?? null,
    // Taille et convives de LA collecte (lot C1, C4 du 2026-10-20) : badge,
    // radar par défaut, « Repas par pax » et « Pesée par pax ».
    taille_bracket:
      collecte.pax != null && collecte.pax > 0
        ? tailleBracket(collecte.pax)
        : null,
    // Type d'événement de LA collecte (lot B1) : filtre du radar par défaut.
    type_evenement_id: collecte.type_evenement_id ?? null,
    pax: collecte.pax ?? null,
    bilan_flux: collecte.collecte_flux.reduce<Record<string, number>>(
      (acc, cf) => {
        const code = cf.flux_dechets?.code;
        if (code && cf.poids_reel_kg != null)
          acc[code] = (acc[code] ?? 0) + Number(cf.poids_reel_kg);
        return acc;
      },
      {},
    ),
    repas_donnes: attribution?.volume_repas_realise ?? null,
    association: attribution?.associations
      ? {
          nom: attribution.associations.nom,
          ville: attribution.associations.ville ?? null,
          description:
            attribution.associations.description_rapport_impact ?? null,
        }
      : null,
  };
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
  // ZD (décision Val 2026-10-07) : l'Admin choisit le prestataire sur la fiche,
  // sans reco algo. Le premier choix est libre ; le motif n'est dû que pour
  // CHANGER un prestataire déjà posé — même garde que la route de dispatch.
  const estZd = collecte.type === 'zero_dechet';
  const changementPrestataireZd =
    estZd &&
    selectedTransporteur != null &&
    collecte.prestataire_logistique_id != null &&
    selectedTransporteur.prestataire_logistique_id !==
      collecte.prestataire_logistique_id;
  const overrideActif =
    changementPrestataireZd ||
    (selectedTransporteur != null &&
      recommendedTransporteurId != null &&
      selectedTransporteur.id !== recommendedTransporteurId);
  // ZD sans prestataire : rien à envoyer tant qu'aucune carte n'est cochée.
  const prestataireAChoisir =
    estZd &&
    collecte.prestataire_logistique_id == null &&
    selectedTransporteur == null;
  // ZD : le choix n'est offert que sur une collecte à dispatcher (`programmee`)
  // ou rejetée par son prestataire (réattribution), et jamais sur une commande
  // vivante (référence reçue, non rejetée) — le dispatch n'émettrait qu'une
  // modification chez le prestataire actuel, sans transférer la commande.
  // Mêmes refus que la route.
  const choixPrestataireZdFerme =
    estZd &&
    (!['programmee', 'rejetee_par_prestataire'].includes(collecte.statut) ||
      (collecte.tms_reference != null &&
        collecte.statut_tms !== 'rejetee_par_prestataire'));
  const overrideMotifManquant =
    overrideActif && motifOverride.trim().length < 5;
  // Acceptation manuelle : collecte chez A Toutes!, non terminale, sans
  // référence de mission encore enregistrée (sinon elle est déjà « transmise »).
  const acceptationManuellePossible =
    !isTerminal &&
    currentTransporteur?.type_tms === 'a_toutes' &&
    !collecte.tms_reference;
  // Ordre en file d'envoi (décision Val 2026-10-02, C1) : collecte dont le
  // dispatch (validation d'attribution AG, choix du prestataire ZD) a posé le
  // prestataire chez un adapter (MTS-1 / A Toutes!) et dont la
  // commande n'est pas encore revenue avec sa référence (l'ordre part au clic,
  // le passage planifié du worker n'est plus que le filet : `tms_reference`
  // vide, `statut_tms` encore « non envoyé » — §06.09 §3 pt 3).
  // À ce stade la fiche DIT la collecte envoyée et ne rouvre le choix du
  // prestataire que sur demande : avant, elle réaffichait « Prestataire à
  // attribuer » + « Envoyer », comme si rien n'était parti.
  // Gardes = celles du worker : `prestataire_logistique_id` posé (sans lui le
  // worker sort en no-op — un transporteur sans pont servi par le repli
  // `prestataire_actuel` n'a rien en file) et collecte encore `programmee` /
  // `validee`. ZD comprise depuis que l'Admin y choisit le prestataire (décision
  // Val 2026-10-07) : seul le dispatch en pose un, avec son ordre en file.
  // Transporteurs manuels (mail / téléphone / autre) exclus : rien ne part
  // automatiquement pour eux.
  // « À dispatcher » au sens canonique (§11 §1.1, `estADispatcher` : non envoyée,
  // sans référence, programmée ou validée) — mais l'ordre est déjà en file.
  // Et un ordre doit réellement attendre dans la file (`ordre_envoi` non nul) :
  // sans ordre dans la file ni référence, aucun envoi n'est enregistré (ordre mis
  // à l'écart sans envoi, par exemple). La fiche dit alors « Non envoyé » et
  // rouvre les cartes et l'envoi, au lieu d'afficher « Envoyée » à jamais
  // (décision Val 2026-10-20, C1). Exceptions connues : un ordre de création
  // résolu à la main (commande passée hors de l'application), et le rejeu
  // A Toutes! qui retrouve sa mission sans réécrire la référence de la collecte.
  const ordreEnFileEnvoi = ordreEnFile(collecte);
  // État réel de l'ordre de tête, lu dans la file (décision Val 2026-10-12, C6).
  const ordreEnvoi = collecte.ordre_envoi ?? null;
  const dispatchEnLecture = ordreEnFileEnvoi && !changerPrestataire;
  // AG attribuée : le choix du prestataire ne s'ouvre que sur « Modifier
  // l'attribution » (décision Val 2026-10-27).
  const agAttribuee = collecte.type === 'anti_gaspi' && !attributionManquante;
  // Seulement une fois l'ordre parti (en file, référence reçue, ou statut TMS
  // posé par le prestataire — il arrive avant la référence) : une AG attribuée
  // dont rien n'est parti, ou rejetée par son prestataire, garde ses cartes et
  // son envoi directs.
  const envoiParti =
    collecte.statut_tms !== 'rejetee_par_prestataire' &&
    (ordreEnFileEnvoi ||
      !!collecte.tms_reference ||
      collecte.statut_tms !== 'non_envoye');
  // Choix rouvert par « Modifier l'attribution » (titre « Changer de
  // prestataire », bouton « Garder le prestataire actuel »).
  const choixMasqueSansClic = agAttribuee && envoiParti;
  const choixMasque = choixMasqueSansClic && !changerPrestataire;
  // Besoin véhicule modifiable avec l'envoi d'une ZD (décision Val
  // 2026-10-27 ; l'AG le saisit à l'attribution) : mêmes gardes que la route
  // (collecte encore à attribuer, choix du prestataire ouvert).
  const besoinEditable =
    estZd &&
    !isTerminal &&
    !dispatchEnLecture &&
    !choixPrestataireZdFerme &&
    ['programmee', 'rejetee_par_prestataire'].includes(collecte.statut);
  // Même prestataire, ordre déjà en file (ou référence TMS reçue) → « Renvoyer ».
  const renvoi =
    !!collecte.tms_reference || (ordreEnFileEnvoi && !selectedTransporteurId);
  const canalEnvoi = libelleCanalEnvoi(currentTransporteur?.type_tms);
  // Bloc « Chauffeur » : une ligne par camion demandé (cf. rangsChauffeurDe).
  const tourneeParRang = new Map(
    collecte.collecte_tournees.map((ct) => [ct.rang, ct] as const),
  );
  const rangsChauffeur = rangsChauffeurDe(collecte);
  // Saisie possible : au moins un camion, et un prestataire posé si une tournée
  // doit être créée (tournees.prestataire_logistique_id NOT NULL).
  const saisieChauffeurPossible =
    rangsChauffeur.length > 0 &&
    (rangsChauffeur.every((rang) => tourneeParRang.has(rang)) ||
      collecte.prestataire_logistique_id != null);
  const titreChauffeur =
    rangsChauffeur.length === 0
      ? 'Aucun chauffeur enregistré'
      : rangsChauffeur.length > 1
        ? 'Chauffeurs'
        : 'Chauffeur';
  const aideChauffeur =
    rangsChauffeur.length === 0
      ? 'Aucune tournée enregistrée pour cette collecte.'
      : // Phrases sur la saisie retirées (décision Val 2026-10-27) ; reste
        // la consigne d'un transporteur manuel (rien ne remonte seul).
        saisieChauffeurPossible &&
          !collecte.controle_acces_requis &&
          !canalEnvoi
        ? 'Coordonnées à saisir par l’équipe Ops.'
        : null;
  // Email « infos d'accès » : l'état vient du journal des emails (servi par la
  // fiche). Sans lui (réponse antérieure au suivi), repli sur le tampon.
  const suiviEmailAcces: SuiviEmailInfosAcces = collecte.infos_acces_email ?? {
    etat: collecte.infos_acces_email_envoye_at ? 'envoye' : 'a_envoyer',
    date: collecte.infos_acces_email_envoye_at,
    tentative: null,
    motif: null,
  };
  // Même règle que l'envoi automatique : nom + téléphone pour chaque camion.
  const coordonneesCompletes =
    rangsChauffeur.length > 0 &&
    rangsChauffeur.every((rang) => {
      const t = tourneeParRang.get(rang)?.tournees;
      return !!t?.chauffeur_nom?.trim() && !!t?.chauffeur_telephone?.trim();
    });
  // Contrôle d'accès demandé, collecte encore à réaliser, coordonnées
  // incomplètes : le bloc « Chauffeur » est encadré (décision Val 2026-10-27).
  const chauffeurACompleter =
    collecte.controle_acces_requis && !isTerminal && !coordonneesCompletes;
  // Jamais pendant une reprise automatique : le renvoi ferait partir deux emails.
  const renvoiEmailPossible =
    collecte.controle_acces_requis &&
    !isTerminal &&
    !editInfosAcces &&
    (suiviEmailAcces.etat === 'envoye' ||
      suiviEmailAcces.etat === 'non_remis' ||
      (suiviEmailAcces.etat === 'a_envoyer' && coordonneesCompletes));
  const cleSaisie = (rang: number): string => cleSaisieDe(collecte, rang);
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
  const transporteursProposables = estZd
    ? transporteurs.filter(proposableEnZd)
    : transporteurs;
  const transporteursOrdonnes = [...transporteursProposables].sort(
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
  // Un ordre en échec le dit : « Envoyée » laisserait croire que tout suit son
  // cours (décision Val 2026-10-12, C6 — remplace « la fiche reste Envoyée »).
  const statutTms = !ordreEnFileEnvoi
    ? statutTmsDisplay(collecte.statut_tms)
    : ordreEnvoi?.etat === 'echec_definitif'
      ? { label: 'Échec d’envoi', variant: 'error' as const }
      : ordreEnvoi?.etat === 'echec_reprise'
        ? { label: 'Envoi en reprise', variant: 'warning' as const }
        : { label: 'Envoyée', variant: 'info' as const };

  // Variante B de la fiche client (décision Val 2026-10-27) : titre = nom de
  // l'événement, le lieu effectif à défaut ; dessous, le lieu (s'il n'est pas
  // déjà le titre) et le client final.
  const clientFinal =
    collecte.evenements.client_organisateur?.raison_sociale ??
    collecte.evenements.nom_client_organisateur ??
    null;
  const titre = collecte.evenements.nom_evenement?.trim() || lieu.nom;
  const sousTitre = [titre === lieu.nom ? null : lieu.nom, clientFinal]
    .map((v) => v?.trim())
    .filter(Boolean)
    .join(' · ');
  const contacts = contactsDe(collecte.contacts);
  const avecSecours = Boolean(
    contacts?.contact_secours_nom?.trim() ||
    contacts?.contact_secours_telephone?.trim(),
  );

  return (
    <Tabs defaultValue="informations" className="flex h-full min-h-0 flex-col">
      {/* En-tête de la variante B (décision Val 2026-10-27) : sur-titre (type,
          réf., « dirty TMS »), titre et pastille de statut, ligne d'infos à
          pictos, onglets soulignés ; seul le corps défile. */}
      <header className="flex shrink-0 flex-col gap-4 px-5 pt-5 sm:px-6 sm:pt-6 md:gap-3.5 md:px-12 md:pt-6">
        <div className="flex min-w-0 flex-wrap items-center gap-3 pr-12 md:pr-16">
          <TypeCollecteBadge type={collecte.type} forme="plein" />
          <EnTeteMention>Réf. {refCourteCollecte(collecte)}</EnTeteMention>
          {estModifieeSansRenvoi(collecte) && (
            <Badge variant="warning" className="flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              Modifiée — renvoi requis
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h3 className="font-display text-2xl font-semibold leading-[1.1] tracking-[-0.03em] text-savr-primary-900 md:text-4xl">
              {titre}
            </h3>
            {sousTitre && (
              <p className="text-[15px] text-savr-neutral-600">{sousTitre}</p>
            )}
          </div>
          <CollecteStatutPastille statut={statutCollecteAdmin(collecte)} />
        </div>
        <p
          data-testid="fiche-admin-sous-ligne"
          className="flex flex-wrap items-center gap-x-7 gap-y-2 text-sm text-savr-neutral-700"
        >
          <InfoEnTete icon={CalendarDays}>
            {dateLongueCapitalisee(collecte.date_collecte)}
          </InfoEnTete>
          {heureCollecte && (
            <InfoEnTete icon={Clock}>{heureCollecte}</InfoEnTete>
          )}
          <InfoEnTete icon={Users}>{fmtPax(collecte.pax)}</InfoEnTete>
          <InfoEnTete icon={Building2}>
            {collecte.evenements.organisations.raison_sociale}
          </InfoEnTete>
          {lieu.ville && <InfoEnTete icon={MapPin}>{lieu.ville}</InfoEnTete>}
          {/* Le badge garde la couleur du statut TMS (rejet, erreur) visible
              sans ouvrir l'onglet Logistique. */}
          <InfoEnTete icon={Truck}>
            <span className="inline-flex flex-wrap items-center gap-2">
              {currentTransporteur?.nom ??
                libelleSansNom ??
                'Prestataire non attribué'}
              <Badge variant={statutTms.variant}>{statutTms.label}</Badge>
            </span>
          </InfoEnTete>
          {collecte.type === 'anti_gaspi' && (
            <InfoEnTete icon={HeartHandshake}>
              {collecte.attributions_antgaspi?.associations?.nom ??
                'Association en attente d’attribution'}
            </InfoEnTete>
          )}
        </p>
        <TabsList
          aria-label="Sections de la fiche collecte"
          className="flex w-full gap-6 overflow-x-auto border-b border-savr-sable-200 bg-transparent p-0 [scrollbar-width:none] md:gap-9"
        >
          <TabsTrigger value="informations" className={ONGLET_ADMIN}>
            Informations
          </TabsTrigger>
          <TabsTrigger value="logistique" className={ONGLET_ADMIN}>
            Logistique
          </TabsTrigger>
          <TabsTrigger value="documents" className={ONGLET_ADMIN}>
            Documents
          </TabsTrigger>
          <TabsTrigger value="historique" className={ONGLET_ADMIN}>
            Historique
          </TabsTrigger>
        </TabsList>
      </header>

      <FicheCorps className="pb-3 pt-5 md:px-12">
        <TabsContent value="informations" className="mt-0">
          {/* Variante B (décision Val 2026-10-27) : une section par ligne,
                libellé à gauche, champs sur trois colonnes. Contenu Admin
                inchangé (§06.06 §3 onglet Informations). */}
          <SectionInfos titre="Événement" data-testid="bloc-evenement">
            <dl className={GRILLE_3}>
              <InfoItem label="Client final">
                {clientFinal ?? <Vide />}
              </InfoItem>
              <InfoItem label="Date et heure de collecte">
                {dateCollecteLongue}
                {heureCollecte ? ` · ${heureCollecte}` : ''}
              </InfoItem>
              <InfoItem
                label="Nombre de pax"
                valueClassName="flex items-center gap-2"
              >
                {collecte.pax}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label="Modifier le nombre de pax"
                  onClick={() => {
                    // Pax inconnu (0, reprise Bubble) : champ vide.
                    setPaxValue(collecte.pax > 0 ? String(collecte.pax) : '');
                    setPaxMotif('');
                    setPaxError(null);
                    setPaxModal(true);
                  }}
                >
                  Modifier
                </Button>
              </InfoItem>
              <InfoItem
                label="Type d'événement"
                valueClassName="flex flex-wrap items-center gap-2"
              >
                {collecte.type_evenement?.libelle ?? <Vide />}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label="Modifier le type d'événement"
                  onClick={ouvrirInfosCollecte}
                >
                  Modifier
                </Button>
              </InfoItem>
              <InfoItem label="Traiteur">
                {collecte.evenements.organisations.raison_sociale}
              </InfoItem>
              {collecte.type === 'anti_gaspi' && (
                <InfoItem label="Volume repas estimé">
                  {collecte.volume_estime_repas ?? '—'}
                </InfoItem>
              )}
            </dl>
          </SectionInfos>

          {/* Lieu effectif = référence `lieux` + surcharge de cette collecte
                (`lieu_overrides`, §04 : le lieu officiel n'est jamais modifié). */}
          <SectionInfos
            titre="Lieu et accès"
            data-testid="bloc-lieu"
            action={
              lieuSurcharge ? (
                <Badge variant="info">Modifié pour cette collecte</Badge>
              ) : undefined
            }
          >
            <dl className={GRILLE_3}>
              <InfoItem label="Adresse">
                {lieu.nom}
                <span className="block font-normal text-savr-neutral-600">
                  {[lieu.adresse_acces, lieu.code_postal, lieu.ville]
                    .filter(Boolean)
                    .join(' ')}
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
                <InfoItem label="Contraintes horaires">
                  {lieu.contraintes_horaires}
                </InfoItem>
              )}
              <InfoItem
                variant="texte"
                label="Accès au lieu (badge, code, interphone, gardien…)"
                className="sm:col-span-2 lg:col-span-3"
              >
                {lieu.acces_details ? (
                  <span className="whitespace-pre-line">
                    {lieu.acces_details}
                  </span>
                ) : (
                  <Vide>Aucune instruction renseignée</Vide>
                )}
              </InfoItem>
              {collecte.informations_supplementaires && (
                <InfoItem
                  variant="texte"
                  label="Informations supplémentaires"
                  className="sm:col-span-2 lg:col-span-3"
                >
                  <span className="whitespace-pre-line">
                    {collecte.informations_supplementaires}
                  </span>
                </InfoItem>
              )}
              {collecte.notes_internes && (
                <InfoItem
                  variant="texte"
                  label="Notes internes Savr"
                  className="sm:col-span-2 lg:col-span-3"
                >
                  <span className="whitespace-pre-line">
                    {collecte.notes_internes}
                  </span>
                </InfoItem>
              )}
            </dl>
          </SectionInfos>

          <SectionInfos
            titre="Contacts sur place"
            data-testid="bloc-contacts"
            action={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Modifier les contacts"
                onClick={ouvrirInfosCollecte}
                className="-ml-3"
              >
                Modifier
              </Button>
            }
          >
            <div className={GRILLE_3}>
              <CarteContact
                nom={contacts?.contact_principal_nom}
                telephone={contacts?.contact_principal_telephone}
                role="Contact principal"
              />
              {/* Contact de secours : sa carte s'il est renseigné, sinon le
                    bouton d'ajout de la fiche client (ouvre la fenêtre des
                    contacts). */}
              {avecSecours ? (
                <CarteContact
                  nom={contacts?.contact_secours_nom}
                  telephone={contacts?.contact_secours_telephone}
                  role="Contact de secours"
                />
              ) : (
                <AjoutContactSecours onClick={ouvrirInfosCollecte} />
              )}
            </div>
          </SectionInfos>
        </TabsContent>

        <TabsContent value="logistique" className="mt-0">
          {/* AG sans attribution : formulaire intégré (décision Val 2026-10-01) —
            association d'abord (son adresse est le point de livraison), besoin
            véhicule, prestataire, un seul bouton « Valider et envoyer ». */}
          {attributionManquante && collecte.statut === 'programmee' && (
            <SectionInfos titre="Attribution & dispatch">
              <div className="min-w-0 space-y-4">
                <AttributionAgForm
                  collecteId={collecte.id}
                  collecte={{
                    volume_estime_repas: collecte.volume_estime_repas ?? null,
                    pax: collecte.pax,
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
              </div>
            </SectionInfos>
          )}
          {/* AG sans attribution hors `programmee` (brouillon, annulation
            demandée…) : la validation d'attribution est impossible (§06.09 §3,
            RPC P0043) — consigne plutôt qu'un formulaire qui échouerait. */}
          {attributionManquante &&
            collecte.statut !== 'programmee' &&
            !isTerminal && (
              <SectionInfos titre="Attribution & dispatch">
                <div className="min-w-0 space-y-4">
                  <AlertBar variant="warn">
                    L&apos;attribution (association, prestataire) n&apos;est
                    possible qu&apos;au statut «{' '}
                    {statutCollecteDisplay('creee', 'admin').label} » — statut
                    actuel : « {statutCollecteDisplay(collecte.statut).label} ».
                  </AlertBar>
                </div>
              </SectionInfos>
            )}
          {!(attributionManquante && !isTerminal) && (
            <SectionInfos
              titre={
                agAttribuee
                  ? 'Prestataire et Dispatch'
                  : 'Prestataire & Dispatch'
              }
            >
              <div className="min-w-0 space-y-4">
                {/* AG attribuée : résumé de l'attribution en tête du bloc, puis
                    « Modifier l'attribution » qui rouvre le choix du
                    prestataire (blocs fusionnés, décision Val 2026-10-27). */}
                {agAttribuee && (
                  <>
                    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                      <InfoItem label="Association retenue">
                        {collecte.attributions_antgaspi?.associations?.nom ?? (
                          <span className="text-savr-neutral-400">
                            Aucune (en attente d’attribution)
                          </span>
                        )}
                      </InfoItem>
                      <InfoItem label="Validation">
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
                          <Badge variant="warning">
                            En attente de validation
                          </Badge>
                        )}
                      </InfoItem>
                      <InfoItem label="Volume repas (estimé / réalisé)">
                        {collecte.volume_estime_repas ?? '—'} /{' '}
                        {collecte.statut === 'realisee_sans_collecte'
                          ? LIBELLE_SANS_EXCEDENT
                          : (collecte.attributions_antgaspi
                              ?.volume_repas_realise ?? '—')}
                      </InfoItem>
                    </dl>
                    {!isTerminal && envoiParti && !changerPrestataire && (
                      <div>
                        <Button
                          ref={changerPrestataireBtnRef}
                          variant="secondary"
                          size="sm"
                          onClick={() => setChangerPrestataire(true)}
                        >
                          Modifier l’attribution
                        </Button>
                      </div>
                    )}
                  </>
                )}
                {dispatchError && (
                  <AlertBar variant="err">{dispatchError}</AlertBar>
                )}
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  <InfoItem
                    label="Prestataire actuel"
                    valueClassName="flex items-center gap-2"
                  >
                    {currentTransporteur?.nom ?? (
                      <span className="text-savr-neutral-400">
                        {libelleSansNom ?? 'Aucun prestataire attribué'}
                      </span>
                    )}
                    {currentTransporteur?.type_tms && (
                      <Badge size="sm" variant="neutral">
                        {libelleTypeTms(currentTransporteur.type_tms)}
                      </Badge>
                    )}
                  </InfoItem>
                  <InfoItem label="Statut TMS">
                    <Badge variant={statutTms.variant}>{statutTms.label}</Badge>
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
                  </InfoItem>
                  {/* Besoin véhicule en lecture quand il ne part plus avec
                      l'envoi (décision Val 2026-10-27 ; « Référence TMS »
                      retirée, idem). */}
                  {!besoinEditable && (
                    <>
                      <InfoItem label="Type de véhicule souhaité">
                        {TYPES_VEHICULE_OPTIONS.find(
                          (t) => t.value === collecte.type_vehicule_souhaite,
                        )?.label ?? 'Non précisé'}
                      </InfoItem>
                      <InfoItem
                        label="Nb camions"
                        valueClassName="flex items-center gap-2"
                      >
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
                      </InfoItem>
                    </>
                  )}
                  {collecte.motif_override_prestataire && (
                    <InfoItem label="Motif override" className="col-span-2">
                      {collecte.motif_override_prestataire}
                    </InfoItem>
                  )}
                </dl>
                {besoinEditable && (
                  <ChampsBesoinVehicule
                    typeVehicule={
                      typeVehiculeSaisi ?? collecte.type_vehicule_souhaite ?? ''
                    }
                    onTypeVehicule={setTypeVehiculeSaisi}
                    nbVehicules={
                      nbVehiculesSaisi ?? String(collecte.nb_camions_demande)
                    }
                    onNbVehicules={setNbVehiculesSaisi}
                  />
                )}

                <EncartOrdreEnvoi
                  ordre={ordreEnvoi}
                  enFile={ordreEnFileEnvoi}
                  referenceRecue={!!collecte.tms_reference}
                  prestataire={currentTransporteur?.nom}
                  canal={canalEnvoi}
                />

                {/* Choix du prestataire — §06.06 §3, en cartes cochables (décision
            Val C3). AG : la reco algo est présélectionnée et marquée
            « Recommandé ». ZD : choix libre de l'Admin, sans reco (décision Val
            2026-10-07). Ordre en file d'envoi : masqué tant que l'Ops ne
            demande pas à changer de prestataire. */}
                {!isTerminal &&
                  !dispatchEnLecture &&
                  !choixPrestataireZdFerme &&
                  !choixMasque && (
                    <div
                      ref={dispatchChoixRef}
                      className="space-y-3 border-t border-savr-neutral-100 pt-4"
                    >
                      <Text
                        tone="strong"
                        className="font-semibold"
                        id="dispatch-transporteur-label"
                      >
                        {ordreEnFileEnvoi || choixMasqueSansClic
                          ? 'Changer de prestataire'
                          : 'Prestataire à attribuer'}
                      </Text>
                      {prestataireAChoisir && (
                        <Text variant="hint">
                          Choisissez le prestataire qui réalisera la collecte,
                          puis envoyez.
                        </Text>
                      )}
                      {transporteursOrdonnes.length === 0 ? (
                        <EmptyState
                          size="inline"
                          title={
                            estZd
                              ? 'Aucun transporteur actif ne peut prendre une collecte Zéro Déchet.'
                              : 'Aucun transporteur actif dans le référentiel.'
                          }
                        />
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
                                      <Badge variant="primary">
                                        Recommandé
                                      </Badge>
                                    )}
                                    {estActuel && (
                                      <Badge variant="neutral">Actuel</Badge>
                                    )}
                                  </>
                                }
                              />
                            );
                          })}
                        </div>
                      )}
                      {overrideActif && (
                        <FormField
                          label={
                            changementPrestataireZd
                              ? 'Motif du changement de prestataire (≥ 5 car.)'
                              : 'Motif override (≥ 5 car. — prestataire ≠ reco algo)'
                          }
                          htmlFor="dispatch-motif"
                          required
                        >
                          <Textarea
                            id="dispatch-motif"
                            rows={2}
                            required
                            value={motifOverride}
                            onChange={(e) => setMotifOverride(e.target.value)}
                            placeholder={
                              changementPrestataireZd
                                ? 'Raison du changement de prestataire…'
                                : "Raison du choix d'un prestataire différent de la recommandation…"
                            }
                          />
                        </FormField>
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
                      <PhoneCall />
                      Acceptation manuelle
                    </Button>
                  )}
                  {dispatchEnLecture ? (
                    // Ordre en file d'envoi : pas de bouton primaire d'envoi (il
                    // est déjà parti), sauf si la collecte a été modifiée
                    // depuis — « Renvoyer » vide alors le drapeau (arbitrage Val
                    // 2026-10-09). Autre action : rouvrir le choix du
                    // prestataire.
                    <>
                      {!agAttribuee && (
                        <Button
                          ref={changerPrestataireBtnRef}
                          variant="secondary"
                          onClick={() => setChangerPrestataire(true)}
                        >
                          <Truck />
                          Changer de prestataire
                        </Button>
                      )}
                      {estModifieeSansRenvoi(collecte) && (
                        <Button
                          onClick={() => void handleDispatch()}
                          loading={dispatching}
                          loadingText="Envoi…"
                        >
                          <Send /> {libelleDispatch(forkTypeTms, true)}
                        </Button>
                      )}
                    </>
                  ) : (
                    <>
                      {changerPrestataire &&
                        (ordreEnFileEnvoi || choixMasqueSansClic) && (
                          <Button
                            variant="ghost"
                            onClick={() => {
                              retourFocusChangerRef.current = true;
                              setChangerPrestataire(false);
                              setSelectedTransporteurId('');
                              setMotifOverride('');
                            }}
                          >
                            Garder le prestataire actuel
                          </Button>
                        )}
                      {(!choixMasque || estModifieeSansRenvoi(collecte)) && (
                        <Button
                          disabled={
                            isTerminal ||
                            overrideMotifManquant ||
                            prestataireAChoisir
                          }
                          onClick={() => void handleDispatch()}
                          loading={dispatching}
                          loadingText="Envoi…"
                        >
                          <Send />{' '}
                          {prestataireAChoisir
                            ? 'Envoyer'
                            : libelleDispatch(forkTypeTms, renvoi)}
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </SectionInfos>
          )}
          {/* Chauffeur(s) par camion — même bloc que la fiche client (§06.04
            « Logistique », décision Val 2026-10-02) : nom, plaque, téléphone
            remontés automatiquement du prestataire (MTS-1 : référentiel carrier
            au polling ; A Toutes! : coursier du webhook Everest), complétés par
            l'Admin si besoin (contrôle d'accès, transporteur manuel). Remplace
            la card « Informations chauffeur » de l'onglet Informations. */}
          <SectionInfos
            titre={titreChauffeur}
            data-testid="bloc-chauffeur"
            action={
              collecte.collecte_tournees.length > 0 ||
              (!editInfosAcces && saisieChauffeurPossible) ? (
                <>
                  {/* Picto « plaque TMS » (§11) : déplacé ici avec le retrait
                      de la liste des tournées (décision Val 2026-10-27). */}
                  {collecte.collecte_tournees.length > 0 && (
                    <PlaqueTmsPicto tournees={collecte.collecte_tournees} />
                  )}
                  {!editInfosAcces && saisieChauffeurPossible && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={openEditInfosAcces}
                    >
                      Modifier les coordonnées
                    </Button>
                  )}
                </>
              ) : undefined
            }
          >
            {/* Contrôle d'accès demandé et coordonnées incomplètes : bloc
                encadré pour qu'il se voie (décision Val 2026-10-27). */}
            <div
              data-testid="chauffeur-contenu"
              className={cn(
                'min-w-0 space-y-4',
                chauffeurACompleter &&
                  'rounded-savr-lg border-2 border-savr-warning bg-savr-warning-subtle p-4',
              )}
            >
              {collecte.controle_acces_requis && (
                <>
                  <Text>
                    Ce lieu exige un contrôle d’accès : nom et téléphone du
                    chauffeur (et nom de l’accompagnant s’il y en a un) pour
                    chaque camion — un email récapitulatif est envoyé au
                    programmateur dès que toutes les tournées sont complètes.
                  </Text>
                  <div data-testid="etat-email-infos-acces">
                    {suiviEmailAcces.etat === 'envoye' && (
                      <div className="flex items-center gap-2 text-sm font-medium text-savr-success-strong">
                        <Send className="h-4 w-4 shrink-0" />
                        Email envoyé au programmateur
                        {suiviEmailAcces.date &&
                          ` le ${new Date(
                            suiviEmailAcces.date,
                          ).toLocaleDateString('fr-FR', {
                            timeZone: 'Europe/Paris',
                          })}`}
                      </div>
                    )}
                    {suiviEmailAcces.etat === 'en_reprise' && (
                      <AlertBar variant="warn" icon={<RotateCw />}>
                        L’email au programmateur n’est pas encore parti.{' '}
                        <span className="font-normal">
                          Une nouvelle tentative a lieu automatiquement
                          {suiviEmailAcces.tentative
                            ? ` (${suiviEmailAcces.tentative} tentative${
                                suiviEmailAcces.tentative > 1 ? 's' : ''
                              } sur 4 en échec)`
                            : ''}
                          . Si la collecte est proche, transmettez les
                          coordonnées par téléphone.
                        </span>
                      </AlertBar>
                    )}
                    {suiviEmailAcces.etat === 'non_remis' && (
                      <AlertBar variant="err" icon={<AlertTriangle />}>
                        {suiviEmailAcces.motif === 'adresse_refusee'
                          ? 'L’email n’a pas été remis : la messagerie du programmateur l’a refusé.'
                          : 'L’email n’a pas pu être envoyé au programmateur (4 tentatives en échec).'}{' '}
                        <span className="font-normal">
                          {suiviEmailAcces.motif === 'adresse_refusee'
                            ? 'Vérifiez son adresse, puis renvoyez l’email ou transmettez les coordonnées par téléphone.'
                            : 'Renvoyez-le ou transmettez les coordonnées par téléphone.'}
                        </span>
                      </AlertBar>
                    )}
                    {suiviEmailAcces.etat === 'a_envoyer' && (
                      <Text
                        as="div"
                        tone="soft"
                        className="flex items-center gap-2"
                      >
                        <AlertTriangle className="h-4 w-4 shrink-0 text-savr-warning-strong" />
                        {coordonneesCompletes
                          ? 'Coordonnées complètes : l’email n’a pas encore été envoyé au programmateur.'
                          : 'En attente : infos à compléter avant envoi de l’email.'}
                      </Text>
                    )}
                  </div>
                  {renvoiEmailPossible && (
                    <div>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={renvoiEmailEnCours}
                        onClick={() => void handleRenvoiEmailInfosAcces()}
                      >
                        {suiviEmailAcces.etat === 'a_envoyer'
                          ? 'Envoyer l’email'
                          : 'Renvoyer l’email'}
                      </Button>
                    </div>
                  )}
                </>
              )}
              {aideChauffeur && <Text>{aideChauffeur}</Text>}

              {infosAccesError && (
                <AlertBar variant="err">{infosAccesError}</AlertBar>
              )}

              {rangsChauffeur.length === 0 ? null : !editInfosAcces ? (
                <div className="space-y-2">
                  {rangsChauffeur.map((rang) => {
                    const t = tourneeParRang.get(rang)?.tournees ?? null;
                    const enAttente = (
                      <span className="text-savr-neutral-400">En attente</span>
                    );
                    return (
                      <div
                        key={rang}
                        data-testid="camion-chauffeur"
                        className="rounded-savr-md border border-savr-neutral-100 bg-savr-neutral-50 px-3 py-2.5 text-sm"
                      >
                        {rangsChauffeur.length > 1 && (
                          <p className="mb-1.5 font-medium">Camion {rang}</p>
                        )}
                        {t === null && (
                          <Text variant="hint" tone="soft" className="mb-1.5">
                            Tournée pas encore créée par le prestataire — la
                            saisie la crée.
                          </Text>
                        )}
                        <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-3">
                          <InfoItem label="Chauffeur">
                            {t?.chauffeur_nom?.trim() || enAttente}
                          </InfoItem>
                          <InfoItem label="Plaque d’immatriculation">
                            {t?.plaque_immatriculation?.trim() ||
                              (t?.type_vehicule === 'velo_cargo' ? (
                                // Vélo cargo : jamais de plaque, jamais « En attente ».
                                <span className="text-savr-neutral-400">
                                  Sans objet (vélo cargo)
                                </span>
                              ) : (
                                enAttente
                              ))}
                          </InfoItem>
                          <InfoItem label="Téléphone">
                            {t?.chauffeur_telephone?.trim() ? (
                              <TelephoneLien
                                telephone={t.chauffeur_telephone}
                              />
                            ) : (
                              enAttente
                            )}
                          </InfoItem>
                          {t?.accompagnant_nom?.trim() && (
                            <InfoItem label="Accompagnant">
                              {t.accompagnant_nom}
                            </InfoItem>
                          )}
                        </dl>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <form
                  onSubmit={(e) => void handleSaveInfosAcces(e)}
                  className="space-y-3"
                >
                  {rangsChauffeur.map((rang) => {
                    const cle = cleSaisie(rang);
                    const v = infosAccesInput[cle] ?? {
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
                        [cle]: { ...v, ...prev[cle], [field]: val },
                      }));
                    return (
                      <div
                        key={cle}
                        className="space-y-2.5 rounded-savr-md border border-savr-neutral-100 bg-savr-neutral-50 px-3 py-3"
                      >
                        <p className="text-sm font-medium">
                          Camion {rang}
                          {!tourneeParRang.has(rang) && (
                            <Text as="span" variant="hint" tone="soft">
                              {' '}
                              · tournée créée à l’enregistrement
                            </Text>
                          )}
                        </p>
                        <FormGrid>
                          <FormField
                            label="Plaque d’immatriculation"
                            htmlFor={`infos-acces-${cle}-plaque`}
                          >
                            <Input
                              id={`infos-acces-${cle}-plaque`}
                              value={v.plaque_immatriculation}
                              onChange={(e) =>
                                setField(
                                  'plaque_immatriculation',
                                  e.target.value,
                                )
                              }
                            />
                          </FormField>
                          <FormField
                            label="Nom du chauffeur"
                            htmlFor={`infos-acces-${cle}-chauffeur-nom`}
                          >
                            <Input
                              id={`infos-acces-${cle}-chauffeur-nom`}
                              value={v.chauffeur_nom}
                              onChange={(e) =>
                                setField('chauffeur_nom', e.target.value)
                              }
                            />
                          </FormField>
                          <FormField
                            label="Téléphone du chauffeur"
                            htmlFor={`infos-acces-${cle}-chauffeur-tel`}
                          >
                            <Input
                              id={`infos-acces-${cle}-chauffeur-tel`}
                              type="tel"
                              value={v.chauffeur_telephone}
                              onChange={(e) =>
                                setField('chauffeur_telephone', e.target.value)
                              }
                            />
                          </FormField>
                          <FormField
                            label="Nom de l’accompagnant (facultatif)"
                            htmlFor={`infos-acces-${cle}-accompagnant-nom`}
                          >
                            <Input
                              id={`infos-acces-${cle}-accompagnant-nom`}
                              value={v.accompagnant_nom}
                              onChange={(e) =>
                                setField('accompagnant_nom', e.target.value)
                              }
                            />
                          </FormField>
                        </FormGrid>
                      </div>
                    );
                  })}
                  <FormActions
                    cancel={{
                      label: 'Annuler',
                      size: 'sm',
                      onClick: () => setEditInfosAcces(false),
                    }}
                    submit={{ label: 'Enregistrer', size: 'sm' }}
                    loading={infosAccesSaving}
                    loadingText="Enregistrement…"
                  />
                </form>
              )}
            </div>
          </SectionInfos>
          {/* Pesées ZD (dérivées des pesées MTS-1 ou saisie manuelle Admin) */}
          {collecte.type === 'zero_dechet' && (
            <SectionInfos
              titre="Pesées ZD"
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
            >
              <div className="min-w-0 space-y-4">
                {!editPesees ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Flux</TableHead>
                        <TableHead className="text-right">Poids (kg)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ZD_FLUX.map((flux) => {
                        const ligne = collecte.collecte_flux.find(
                          (f) => f.flux_dechets?.code === flux.code,
                        );
                        const poids = ligne?.poids_reel_kg ?? null;
                        return (
                          <TableRow key={flux.code}>
                            <TableCell className="font-medium">
                              {flux.nom}
                            </TableCell>
                            <TableCell className="text-right">
                              {poids !== null ? (
                                <span className="font-medium">
                                  {fmtKgAuto(poids)}
                                </span>
                              ) : (
                                <span className="text-savr-neutral-400">
                                  En attente
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                ) : (
                  <form
                    onSubmit={(e) => void handleSavePesees(e)}
                    className="space-y-3"
                  >
                    <Table>
                      <TableBody>
                        {ZD_FLUX.map((flux) => (
                          <TableRow key={flux.code}>
                            <TableCell className="font-medium">
                              {flux.nom}
                            </TableCell>
                            <TableCell className="text-right">
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
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <FormField
                      label="Motif (≥ 10 caractères)"
                      htmlFor="pesees-motif"
                      required
                    >
                      <Textarea
                        id="pesees-motif"
                        value={peseesMotif}
                        onChange={(e) => setPeseesMotif(e.target.value)}
                        rows={2}
                        minLength={10}
                        required
                      />
                    </FormField>
                    {peseesError && (
                      <AlertBar variant="err">{peseesError}</AlertBar>
                    )}
                    <FormActions
                      cancel={{
                        label: 'Annuler',
                        onClick: () => setEditPesees(false),
                      }}
                      submit={{ label: 'Enregistrer' }}
                      loading={peseesSaving}
                      loadingText="Enregistrement…"
                    />
                  </form>
                )}
              </div>
            </SectionInfos>
          )}
        </TabsContent>

        <TabsContent value="documents" className="mt-0 space-y-3">
          {/* Bilan vu par le client, radar et barre « Comparer avec » compris
                (décision Val 2026-10-16). */}
          <BilanCollecte
            c={bilan}
            radar={radar}
            barre={{
              filtresEndpoint:
                '/api/v1/admin/dashboard-client/benchmark/filtres',
              avertissementComparaisonSoi: false,
            }}
          />
          {/* Bloc 3 (CDC) — Documents : rapport RSE / bordereau ZD / attestation AG + photos */}
          <SectionInfos titre="Documents">
            <div className="min-w-0 space-y-4">
              {docError && <AlertBar variant="err">{docError}</AlertBar>}

              <div className="divide-y divide-savr-neutral-100">
                {/* Rapport : « Rapport RSE » (ZD) ou « Rapport de don » (AG sans excédents) */}
                {afficherRapport && (
                  <div className="flex flex-wrap items-center gap-3 py-3">
                    <div className="flex-1">
                      <p className="text-sm font-medium flex items-center gap-2">
                        {agSansExcedent ? 'Rapport de don' : 'Rapport RSE'}
                        {agSansExcedent &&
                          documents?.rapport &&
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
                          ? DOCUMENT_A_VENIR
                          : !documents.rapport.disponible
                            ? agSansExcedent
                              ? 'En attente de génération'
                              : `Disponible le ${new Date(
                                  documents.rapport.disponible_a ?? '',
                                ).toLocaleDateString('fr-FR', {
                                  timeZone: 'Europe/Paris',
                                })}`
                            : documents.rapport.consulte_par_user_at
                              ? `Téléchargé par le client le ${new Date(
                                  documents.rapport.consulte_par_user_at,
                                ).toLocaleDateString('fr-FR', {
                                  timeZone: 'Europe/Paris',
                                })}`
                              : 'Disponible'}
                      </Text>
                    </div>
                    {agSansExcedent ? (
                      <>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={!documents?.rapport?.disponible}
                          onClick={() =>
                            documents?.rapport &&
                            void handleDownload(
                              `/api/v1/admin/rapports-rse/${encodeURIComponent(documents.rapport.id)}/download`,
                            )
                          }
                        >
                          <Download />
                          Télécharger
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!documents?.rapport}
                          loading={regenerating === typeRapport}
                          loadingText="Régénérer"
                          onClick={() => void handleRegenerate(typeRapport)}
                        >
                          <RotateCw />
                          Régénérer
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        // Radar demandé : on attend les filtres de l'onglet (sans
                        // eux, le rapport ne comparerait pas à ce qu'il affiche).
                        disabled={
                          !documents?.rapport?.disponible ||
                          (avecRadar && choixRadarPossible && !radar.filtres)
                        }
                        loading={fabrication}
                        loadingText="Préparation du PDF…"
                        onClick={() => void telechargerRapportZd()}
                      >
                        <Download />
                        Télécharger
                      </Button>
                    )}
                    {/* Version du rapport de recyclage : avec ou sans radar (ZD). */}
                    {typeRapport === 'rapport-recyclage-zd' &&
                      documents?.rapport?.disponible && (
                        <div
                          className="basis-full"
                          data-testid="option-rapport-radar-admin"
                        >
                          <Label
                            variant="choice"
                            htmlFor="rapport-avec-radar-admin"
                            className="flex items-center gap-2"
                          >
                            <Checkbox
                              id="rapport-avec-radar-admin"
                              checked={avecRadar}
                              onCheckedChange={(v) => setAvecRadar(v === true)}
                            />
                            Inclure le radar de comparaison dans le rapport
                          </Label>
                          <Text variant="hint" className="mt-1">
                            {choixRadarPossible
                              ? 'Le radar du rapport reprend les filtres de comparaison réglés ci-dessus.'
                              : 'Comparaison aux événements de même type et de même taille.'}
                          </Text>
                        </div>
                      )}
                  </div>
                )}

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
                          : DOCUMENT_A_VENIR}
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
                      <Download />
                      Télécharger
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!documents?.bordereau}
                      loading={regenerating === 'bordereau-zd'}
                      loadingText="Régénérer"
                      onClick={() => void handleRegenerate('bordereau-zd')}
                    >
                      <RotateCw />
                      Régénérer
                    </Button>
                  </div>
                )}

                {/* Rapport de don d'une collecte AG avec excédents = l'attestation de don */}
                {collecte.type === 'anti_gaspi' && !agSansExcedent && (
                  <div className="flex items-center gap-3 py-3">
                    <div className="flex-1">
                      <p className="text-sm font-medium">
                        Rapport de don
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
                          : DOCUMENT_A_VENIR}
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
                      <Download />
                      Télécharger
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!documents?.attestation}
                      loading={regenerating === 'attestation-don'}
                      loadingText="Régénérer"
                      onClick={() => void handleRegenerate('attestation-don')}
                    >
                      <RotateCw />
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
                  <EmptyState size="inline" title="Aucune facture générée." />
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
                    <Badge variant="neutral" className="ml-2">
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
                  {collecte.rattachement_pack && (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={!collecte.rattachement_pack.pack_actif}
                      onClick={() => {
                        setRattacherPackError(null);
                        setRattacherPackModal(true);
                      }}
                    >
                      Rattacher au pack
                    </Button>
                  )}
                </div>
                {collecte.rattachement_pack &&
                  !collecte.rattachement_pack.pack_actif && (
                    <Text variant="hint">
                      {/* Une annulée n'est pas facturée automatiquement. */}
                      {collecte.statut === 'annulee'
                        ? "Aucun pack Anti-Gaspi actif pour ce client : rattachement possible dès qu'il en aura un."
                        : "Aucun pack Anti-Gaspi actif pour ce client : la collecte reste facturée à l'unité."}
                    </Text>
                  )}
                {factureNumerotee && (
                  <AlertBar variant="warn">
                    La facture unitaire de cette collecte est déjà numérotée
                    (partie chez Pennylane, ou rejetée) : elle n&apos;a pas été
                    retirée, émettez un avoir ou corrigez-la.
                  </AlertBar>
                )}
              </div>

              {/* Galerie photos + import */}
              <div className="border-t border-savr-neutral-100 pt-4">
                <div className="flex items-center justify-between mb-3">
                  <Text variant="body" className="font-medium">
                    Photos ({documents?.photos?.length ?? 0})
                  </Text>
                  <FileButton
                    id="collecte-import-photo"
                    variant="link"
                    accept="image/png,image/jpeg,image/webp"
                    loading={photoUploading}
                    loadingText="Import…"
                    onFile={(f) => void handleImportPhoto(f)}
                    className="h-auto gap-1 px-0 font-normal sm:h-auto"
                  >
                    Importer des photos
                  </FileButton>
                </div>
                {documents?.photos && documents.photos.length > 0 ? (
                  <>
                    <Text variant="hint" className="mb-3">
                      {`Le client ne voit que les photos cochées, ${MAX_PHOTOS_CLIENT} au maximum. ${nbPhotosClient} sur ${MAX_PHOTOS_CLIENT} choisie${nbPhotosClient > 1 ? 's' : ''}.`}
                    </Text>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {documents.photos.map((p) => (
                        <div key={p.id} className="space-y-1.5">
                          {p.url ? (
                            <img
                              src={p.url}
                              alt="Photo collecte"
                              className="h-24 w-full object-cover rounded-savr-md border border-savr-neutral-200"
                            />
                          ) : (
                            <Text
                              as="div"
                              variant="faint"
                              className="h-24 w-full flex items-center justify-center rounded-savr-md border border-savr-neutral-200 bg-savr-neutral-50"
                            >
                              Photo
                            </Text>
                          )}
                          <Label
                            variant="choice"
                            className="flex items-center gap-2"
                          >
                            <Checkbox
                              checked={p.visible_client}
                              disabled={
                                photoEnCours !== null ||
                                (!p.visible_client &&
                                  nbPhotosClient >= MAX_PHOTOS_CLIENT)
                              }
                              onCheckedChange={(v) =>
                                void handlePhotoClient(p.id, v === true)
                              }
                            />
                            <span>Visible du client</span>
                          </Label>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <EmptyState
                    size="inline"
                    title="Aucune photo importée."
                    className="text-savr-neutral-400"
                  />
                )}
              </div>
            </div>
          </SectionInfos>
        </TabsContent>

        <TabsContent value="historique" className="mt-0">
          {/* Bloc 7 (CDC) — Historique + Audit log (Admin-only) */}
          <SectionInfos titre="Historique & audit">
            <div className="min-w-0 space-y-4">
              {audit.length === 0 ? (
                <EmptyState
                  size="inline"
                  title="Aucune action enregistrée sur cette collecte."
                />
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
            </div>
          </SectionInfos>
        </TabsContent>
      </FicheCorps>

      {/* Pied d'actions (cadre commun des fiches) — ajout d'une collecte à
          l'événement (programmation de support, sur tout événement confirmé,
          décision Val 2026-10-21 ; pas depuis un brouillon) et RM-08 forçage
          manuel du statut (motif obligatoire). */}
      <FichePied className="gap-3 border-savr-sable-200 px-5 py-4 sm:px-6 md:px-12">
        {collecte.statut !== 'brouillon' && (
          <Button
            asChild
            variant="sable"
            size="pilule"
            data-testid="action-ajouter-collecte"
            // Libellé long : il passe à la ligne sur un téléphone au lieu de
            // déborder du pied de la fiche.
            className="max-sm:h-auto max-sm:min-h-11 max-sm:whitespace-normal max-sm:text-center"
          >
            <Link
              href={ROUTES.programmer.ajouterCollecte(collecte.evenement_id)}
            >
              <PlusCircle />
              Ajouter une collecte à cet événement
            </Link>
          </Button>
        )}
        <Button
          variant="sable"
          size="pilule"
          onClick={() => {
            // Statut courant pré-sélectionné, sauf s'il n'est pas proposé
            // (brouillon ouvert par son adresse) : aucun choix par défaut.
            setForceStatutValue(
              STATUTS_FORCABLES.find((s) => s === collecte.statut) ?? '',
            );
            setForceStatutMotif('');
            setForceStatutError(null);
            setForceStatutModal(true);
          }}
        >
          <Settings2 />
          Forcer le statut
        </Button>
      </FichePied>

      {/* Modale — Annuler le crédit AG */}
      <ConfirmDialog
        open={annulerCreditModal}
        title="Annuler le crédit AG"
        confirmLabel="Confirmer l’annulation"
        cancelLabel="Retour"
        variant="destructive"
        loading={annulerCreditSubmitting}
        loadingText="Annulation…"
        error={annulerCreditError}
        motif={{ label: 'Motif', minLength: 10 }}
        onConfirm={(motif) => void handleAnnulerCredit(motif)}
        onCancel={() => setAnnulerCreditModal(false)}
      >
        <Text>
          Le crédit AG sera annulé côté Savr. La collecte reste à{' '}
          <strong>réalisée</strong> — seul le décompte du pack est rétabli.
          {collecte.packs_antgaspi && (
            <>
              {' '}
              Pack : <strong>{collecte.packs_antgaspi.type_pack}</strong> —{' '}
              {collecte.packs_antgaspi.credits_restants} crédit
              {collecte.packs_antgaspi.credits_restants !== 1 ? 's' : ''}{' '}
              restant
              {collecte.packs_antgaspi.credits_restants !== 1 ? 's' : ''}.
            </>
          )}
        </Text>
      </ConfirmDialog>

      {/* Modale — Rattacher au pack (décision Val 2026-10-16) */}
      <ConfirmDialog
        open={rattacherPackModal}
        title="Rattacher la collecte au pack"
        confirmLabel="Rattacher"
        cancelLabel="Retour"
        variant="primary"
        loading={rattacherPackSubmitting}
        loadingText="Rattachement…"
        error={rattacherPackError}
        onConfirm={() => void handleRattacherPack()}
        onCancel={() => setRattacherPackModal(false)}
      >
        {collecte.rattachement_pack?.pack_actif && (
          <Text>
            Un crédit du pack actif du client sera décompté :{' '}
            <strong>
              {libelleTypePack(collecte.rattachement_pack.pack_actif.type_pack)}
            </strong>{' '}
            — {collecte.rattachement_pack.pack_actif.credits_restants} crédit
            {collecte.rattachement_pack.pack_actif.credits_restants !== 1
              ? 's'
              : ''}{' '}
            restant
            {collecte.rattachement_pack.pack_actif.credits_restants !== 1
              ? 's'
              : ''}
            . Si la facture unitaire de la collecte est encore en brouillon sans
            numéro, elle est retirée ; si elle est déjà numérotée (partie chez
            Pennylane, ou rejetée), elle reste en place et il faudra émettre un
            avoir ou la corriger.
          </Text>
        )}
      </ConfirmDialog>

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
          <FormField
            label="Nouveau statut"
            htmlFor="force-statut-select"
            required
          >
            <Combobox
              id="force-statut-select"
              icon={null}
              value={forceStatutValue}
              onChange={setForceStatutValue}
              required
              // Le forçage pose un statut DB : `programmee` s'affichera
              // « Créée » ou « Programmée » selon que la demande est partie ;
              // `realisee` et `realisee_sans_collecte` s'affichent tous deux
              // « Réalisée », le choix doit donc dire lequel on pose.
              options={STATUTS_FORCABLES.map((s) => ({
                value: s,
                label:
                  s === 'programmee'
                    ? `${statutCollecteDisplay('creee', 'admin').label} / ${statutCollecteDisplay('programmee', 'admin').label}`
                    : s === 'realisee_sans_collecte'
                      ? `${statutCollecteDisplay(s, 'admin').label} — ${LIBELLE_SANS_EXCEDENT.toLowerCase()}`
                      : statutCollecteDisplay(s, 'admin').label,
              }))}
            />
          </FormField>
          <FormField
            label="Motif (≥ 10 caractères)"
            htmlFor="force-statut-motif"
            required
          >
            <Textarea
              id="force-statut-motif"
              value={forceStatutMotif}
              onChange={(e) => setForceStatutMotif(e.target.value)}
              rows={3}
              minLength={10}
              required
            />
          </FormField>
          <FormActions
            cancel={{
              label: 'Retour',
              onClick: () => setForceStatutModal(false),
            }}
            submit={{
              label: 'Confirmer le forçage',
              disabled:
                forceStatutMotif.trim().length < 10 || forceStatutValue === '',
            }}
            loading={forceStatutSubmitting}
            loadingText="Application…"
            bordered
          />
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
          <FormField
            label="Référence de mission communiquée par A Toutes!"
            htmlFor="acceptation-reference"
            required
            hint="Sans espace, 64 caractères maximum."
          >
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
          </FormField>
          <FormField
            label="Contact joint chez A Toutes!"
            htmlFor="acceptation-contact"
            required
          >
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
          </FormField>
          <FormField label="Heure de l'appel" htmlFor="acceptation-heure">
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
          </FormField>
          <FormField label="Commentaire" htmlFor="acceptation-commentaire">
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
          </FormField>
          <FormActions
            cancel={{
              label: 'Retour',
              onClick: () => setAcceptationModal(false),
            }}
            submit={{
              label: "Enregistrer l'acceptation",
              disabled: acceptationIncomplete,
            }}
            loading={acceptationSubmitting}
            loadingText="Enregistrement…"
            bordered
          />
        </form>
      </Modal>

      {/* Modale — Modifier le nombre de pax (décision Val 2026-10-21) */}
      <Modal
        open={paxModal}
        title="Modifier le nombre de pax"
        onClose={() => setPaxModal(false)}
      >
        {paxError && (
          <AlertBar variant="err" className="mb-4">
            {paxError}
          </AlertBar>
        )}
        <form onSubmit={(e) => void handleModifierPax(e)} className="space-y-4">
          <Text>
            Le nombre de pax de l&apos;événement est recalculé. Si une commande
            existe déjà chez le prestataire, la modification lui est envoyée,
            sauf pour une collecte réalisée, clôturée ou annulée. L&apos;action
            est tracée dans l&apos;audit (motif obligatoire).
          </Text>
          <FormField label="Nombre de pax" htmlFor="pax-input" required>
            <Input
              id="pax-input"
              type="number"
              inputMode="numeric"
              min={1}
              max={PAX_COLLECTE_MAX}
              step={1}
              value={paxValue}
              onChange={(e) => setPaxValue(e.target.value)}
              className="w-32"
              required
            />
          </FormField>
          <FormField
            label="Motif (≥ 10 caractères)"
            htmlFor="pax-motif"
            required
          >
            <Textarea
              id="pax-motif"
              value={paxMotif}
              onChange={(e) => setPaxMotif(e.target.value)}
              rows={3}
              minLength={10}
              required
            />
          </FormField>
          <FormActions
            cancel={{
              label: 'Retour',
              onClick: () => setPaxModal(false),
            }}
            submit={{
              label: 'Enregistrer',
              disabled:
                !paxSaisiValide(paxValue) || paxMotif.trim().length < 10,
            }}
            loading={paxSubmitting}
            loadingText="Enregistrement…"
            bordered
          />
        </form>
      </Modal>

      {/* Modale — Type d'événement et contacts de la collecte (lot B1) */}
      <Modal
        open={infosModal}
        title="Modifier le type d'événement et les contacts"
        onClose={() => setInfosModal(false)}
      >
        {infosError && (
          <AlertBar variant="err" className="mb-4">
            {infosError}
          </AlertBar>
        )}
        <form
          onSubmit={(e) => void handleModifierInfos(e)}
          className="space-y-4"
        >
          <Text>
            Ces informations sont celles de cette collecte. Si une commande
            existe déjà chez le prestataire, un changement de contact lui est
            envoyé, sauf pour une collecte réalisée, clôturée ou annulée. Le
            type d&apos;événement ne lui est pas transmis. L&apos;action est
            tracée dans l&apos;audit.
          </Text>
          <FormField label="Type d'événement" htmlFor="infos-type" required>
            <Combobox
              id="infos-type"
              icon={null}
              placeholder="Choisir un type"
              searchPlaceholder="Rechercher un type…"
              options={
                typesEvenement.length === 0 && infosType
                  ? [
                      {
                        value: infosType,
                        label: collecte?.type_evenement?.libelle ?? '—',
                      },
                    ]
                  : typesEvenement.map((t) => ({
                      value: t.id,
                      label: t.libelle,
                    }))
              }
              value={infosType}
              onChange={setInfosType}
            />
          </FormField>
          <FormGrid>
            <FormField
              label="Contact principal"
              htmlFor="infos-cp-nom"
              required
            >
              <Input
                id="infos-cp-nom"
                value={infosCpNom}
                onChange={(e) => setInfosCpNom(e.target.value)}
                required
              />
            </FormField>
            <FormField label="Téléphone" htmlFor="infos-cp-tel" required>
              <Input
                id="infos-cp-tel"
                value={infosCpTel}
                onChange={(e) => setInfosCpTel(e.target.value)}
                required
              />
            </FormField>
            <FormField label="Contact de secours" htmlFor="infos-cs-nom">
              <Input
                id="infos-cs-nom"
                value={infosCsNom}
                onChange={(e) => setInfosCsNom(e.target.value)}
              />
            </FormField>
            <FormField label="Téléphone de secours" htmlFor="infos-cs-tel">
              <Input
                id="infos-cs-tel"
                value={infosCsTel}
                onChange={(e) => setInfosCsTel(e.target.value)}
              />
            </FormField>
          </FormGrid>
          <FormActions
            cancel={{
              label: 'Retour',
              onClick: () => setInfosModal(false),
            }}
            submit={{
              label: 'Enregistrer',
              disabled:
                infosCpNom.trim() === '' ||
                infosCpTel.trim() === '' ||
                infosType === '',
            }}
            loading={infosSubmitting}
            loadingText="Enregistrement…"
            bordered
          />
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
          <FormField
            label="Nombre de camions"
            htmlFor="nb-camions-input"
            required
          >
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
          </FormField>
          <FormActions
            cancel={{
              label: 'Retour',
              onClick: () => setNbCamionsModal(false),
            }}
            submit={{
              label: 'Enregistrer',
              disabled:
                Number(nbCamionsValue) < 1 ||
                !Number.isInteger(Number(nbCamionsValue)),
            }}
            loading={nbCamionsSubmitting}
            loadingText="Enregistrement…"
            bordered
          />
        </form>
      </Modal>
    </Tabs>
  );
}

// Onglets de la variante B : soulignés en bleu nuit, plus espacés. Quatre
// onglets Admin : soulignés aussi sur téléphone (la barre défile).
const ONGLET_ADMIN =
  'px-0 data-[state=active]:border-savr-primary-900 data-[state=active]:text-savr-primary-900';
