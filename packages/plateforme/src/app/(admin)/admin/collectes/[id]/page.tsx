'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Truck,
  Send,
  AlertTriangle,
  Settings2,
  FileText,
  Download,
  RotateCw,
  Upload,
  History,
  Gift,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHero } from '@/components/ui/page-hero';
import { AlertBar } from '@/components/ui/alert-bar';
import { Modal } from '@/components/ui/modal';
import { Timeline, TimelineItem } from '@/components/ui/timeline';
import {
  StatusCollecte,
  type StatutCollecte,
} from '@/components/ui/status-collecte';
import {
  statutCollecteDisplay,
  type StatutCollecteDb,
} from '@/lib/statut-collecte-labels';
import { statutTmsDisplay } from '@/lib/statut-tms-labels';

// Libellé d'affichage du type de collecte (UX — la DB garde l'enum).
function typeCollecteLabel(type: string): string {
  return type === 'zero_dechet' ? 'Zéro Déchet' : 'Anti-Gaspi';
}

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
// Bloc 0 : transporteur top-1 (baseline « ≠ top-1 → motif obligatoire ») +
// association recommandée. L'attribution complète (validation, emails, top 3) vit
// sur l'écran /admin/attributions-ag/[id] (+ Bloc 5).
interface RecoAlgo {
  // Scores détaillés (distance, capacité) exposés par calculerAlgoAttributionAg
  // (§06.06 l.253) — surfacés dans le top 3 du Bloc 5.
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

// Libellé du bouton d'envoi TMS forké par type_tms (§06.06 §3 « Spec V1 fork » :
// MTS-1 pour Strike/Marathon, A Toutes! pour le vélo cargo, manuel sinon).
function libelleDispatch(
  typeTms: string | undefined,
  dejaEnvoye: boolean,
): string {
  const verbe = dejaEnvoye ? 'Renvoyer' : 'Envoyer';
  if (typeTms === 'mts1') return `${verbe} à MTS-1`;
  if (typeTms === 'a_toutes') return `${verbe} à A Toutes!`;
  return 'Dispatcher (manuel)';
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
  controle_acces_requis: boolean;
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
  evenements: {
    nom_evenement: string | null;
    pax: number;
    organisations: { raison_sociale: string };
    lieux: { nom: string; ville: string; adresse_acces: string };
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

export default function CollecteDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
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
  // Bloc 0 — dispatch prestataire (BOA-06)
  const [transporteurs, setTransporteurs] = useState<Transporteur[]>([]);
  const [selectedTransporteurId, setSelectedTransporteurId] = useState('');
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
  // Bloc 3 — Documents / Bloc 7 — Historique (BOA-07)
  const [documents, setDocuments] = useState<DocumentsData | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [recreditAt, setRecreditAt] = useState<string | null>(null);
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
    const updated = await fetch(`/api/v1/admin/collectes/${params.id}`);
    if (updated.ok) setCollecte((await updated.json()) as CollecteDetail);
  }, [params.id]);

  // Bloc 3 — Documents (rapport / bordereau / attestation / photos).
  const refetchDocuments = useCallback(async () => {
    const r = await fetch(`/api/v1/admin/collectes/${params.id}/documents`);
    if (r.ok) setDocuments((await r.json()) as DocumentsData);
  }, [params.id]);

  // Bloc 7 — Historique + audit log (+ date de recrédit pour Bloc 4).
  const refetchAudit = useCallback(async () => {
    const r = await fetch(`/api/v1/admin/collectes/${params.id}/audit`);
    if (r.ok) {
      const j = (await r.json()) as {
        data: AuditEntry[];
        recredit_at: string | null;
      };
      setAudit(j.data);
      setRecreditAt(j.recredit_at);
    }
  }, [params.id]);

  useEffect(() => {
    void refetchDocuments();
    void refetchAudit();
  }, [refetchDocuments, refetchAudit]);

  // Régénération d'un PDF (§06.06 l.283-284) — ré-enqueue jobs_pdf côté serveur.
  const handleRegenerate = async (type: PdfType) => {
    setRegenerating(type);
    setDocError(null);
    const res = await fetch(
      `/api/v1/admin/collectes/${params.id}/documents/${type}/regenerate`,
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
    const res = await fetch(`/api/v1/admin/collectes/${params.id}/photos`, {
      method: 'POST',
      body: fd,
    });
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
    fetch(`/api/v1/admin/collectes/${params.id}`)
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
  }, [params.id]);

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
  const collectePresta = collecte?.prestataire_logistique_id ?? null;
  useEffect(() => {
    if (collecteType !== 'anti_gaspi') return;
    if (
      collecteStatut != null &&
      ['realisee', 'cloturee', 'annulee', 'realisee_sans_collecte'].includes(
        collecteStatut,
      )
    ) {
      return;
    }
    let active = true;
    fetch(`/api/v1/admin/attributions-ag/${params.id}/recommandation`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { data: RecoAlgo } | null) => {
        if (!active) return;
        const r = j?.data ?? null;
        setReco(r);
        // Pré-sélection du top-1 recommandé si aucune sélection ni prestataire courant.
        if (r?.transporteur && collectePresta == null) {
          setSelectedTransporteurId((prev) => prev || r.transporteur!.id);
        }
      })
      .catch(() => {
        if (active) setReco(null);
      });
    return () => {
      active = false;
    };
  }, [params.id, collecteType, collecteStatut, collectePresta]);

  const handleAnnulerCredit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAnnulerCreditSubmitting(true);
    setAnnulerCreditError(null);
    const res = await fetch(
      `/api/v1/admin/collectes/${params.id}/annuler-credit`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ motif: annulerCreditMotif }),
      },
    );
    if (res.ok) {
      const updated = await fetch(`/api/v1/admin/collectes/${params.id}`);
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
    const res = await fetch(`/api/v1/admin/collectes/${params.id}/dispatch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      await refetch();
      setSelectedTransporteurId('');
      setMotifOverride('');
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
    const res = await fetch(`/api/v1/admin/collectes/${params.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        statut: forceStatutValue,
        motif: forceStatutMotif,
      }),
    });
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
    const res = await fetch(`/api/v1/admin/collectes/${params.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nb_camions_demande: Number(nbCamionsValue) }),
    });
    if (res.ok) {
      await refetch();
      setNbCamionsModal(false);
    } else {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setNbCamionsError(body.error ?? 'Modification impossible');
    }
    setNbCamionsSubmitting(false);
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
    const res = await fetch(`/api/v1/admin/collectes/${params.id}/flux`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pesees, motif: peseesMotif }),
    });
    if (res.ok) {
      const updated = await fetch(`/api/v1/admin/collectes/${params.id}`);
      if (updated.ok) setCollecte((await updated.json()) as CollecteDetail);
      setEditPesees(false);
    } else {
      const body = (await res.json()) as { error: string };
      setPeseesError(body.error);
    }
    setPeseesSaving(false);
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (error || !collecte) {
    return <AlertBar variant="err">{error ?? 'Collecte introuvable'}</AlertBar>;
  }

  const isTerminal = STATUTS_TERMINAUX.includes(collecte.statut);
  // RM-02 — N camions modifiable uniquement hors état terminal (garde serveur).
  const nbCamionsEditable = ['programmee', 'validee', 'en_cours'].includes(
    collecte.statut,
  );

  // Bloc 0 — résolution prestataire (pont R5 : transporteurs.prestataire_logistique_id
  // → collectes.prestataire_logistique_id) + fork type_tms.
  const currentTransporteur = transporteurs.find(
    (t) => t.prestataire_logistique_id === collecte.prestataire_logistique_id,
  );
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

  return (
    <div className="space-y-6">
      {/* En-tête — bandeau navy (levier #2) : réf/type + méta + badges statut */}
      <PageHero
        icon={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => router.back()}
              aria-label="Retour"
              className="inline-flex h-9 w-9 items-center justify-center rounded-savr-md text-savr-white transition-colors hover:bg-savr-white/10"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <Truck className="h-6 w-6 text-savr-primary-200" />
          </div>
        }
        title={`Collecte ${typeCollecteLabel(collecte.type)}`}
        subtitle={
          <>
            {new Date(collecte.date_collecte).toLocaleDateString('fr-FR')}
            {collecte.heure_collecte
              ? ` · ${collecte.heure_collecte.slice(0, 5)}`
              : ''}{' '}
            · {collecte.evenements.organisations.raison_sociale} ·{' '}
            {collecte.evenements.lieux.nom} ({collecte.evenements.lieux.ville})
            · {collecte.evenements.pax} pax
          </>
        }
        actions={
          <>
            <StatusCollecte statut={collecte.statut as StatutCollecte} />
            {collecte.dirty_tms && (
              <Badge
                variant="warning"
                className="flex items-center gap-1 text-xs"
              >
                <AlertTriangle className="h-3 w-3" />
                Modifiée — renvoi requis
              </Badge>
            )}
            {/* RM-08 — forçage manuel du statut (motif obligatoire) */}
            <Button
              variant="secondary"
              size="sm"
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
          </>
        }
      />

      {/* Bloc 0 — Attribution prestataire & dispatch */}
      <Card className="p-6 space-y-4">
        <h2 className="font-semibold text-savr-neutral-800">
          Bloc 0 — Prestataire & Dispatch
        </h2>
        {dispatchError && <AlertBar variant="err">{dispatchError}</AlertBar>}
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-savr-neutral-500">Prestataire actuel</dt>
            <dd className="font-medium flex items-center gap-2">
              {currentTransporteur?.nom ?? (
                <span className="text-savr-neutral-400">
                  Aucun prestataire attribué
                </span>
              )}
              {currentTransporteur && (
                <Badge variant="neutral" className="text-[10px]">
                  {currentTransporteur.type_tms}
                </Badge>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-savr-neutral-500">Statut TMS</dt>
            <dd className="font-medium">
              <Badge
                variant={statutTmsDisplay(collecte.statut_tms).variant}
                className="text-xs"
              >
                {statutTmsDisplay(collecte.statut_tms).label}
              </Badge>
              {collecte.statut_tms_at && (
                <span className="ml-1 text-xs text-savr-neutral-400">
                  ({new Date(collecte.statut_tms_at).toLocaleString('fr-FR')})
                </span>
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
                    setNbCamionsValue(String(collecte.nb_camions_demande));
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

        {/* Sélecteur prestataire (AG) — override manuel §06.06 §3. Pas de
            sélecteur ZD V1 (prestataire fixe par lieu/zone : réémission seule). */}
        {collecte.type === 'anti_gaspi' && !isTerminal && (
          <div className="space-y-3 border-t border-savr-neutral-100 pt-4">
            {/* Recommandation algo (§06.09) — prestataire + association top-1. */}
            <div className="rounded-savr-md border border-savr-primary-100 bg-savr-primary-50 p-3 text-sm">
              <p className="font-medium text-savr-primary-800">
                Recommandation algo
              </p>
              <dl className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2">
                <div>
                  <dt className="text-savr-neutral-500">
                    Prestataire recommandé
                  </dt>
                  <dd className="font-medium">
                    {reco?.transporteur ? (
                      `${reco.transporteur.nom} (${reco.transporteur.type_tms})`
                    ) : (
                      <span className="text-savr-neutral-400">
                        Aucune recommandation
                      </span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-savr-neutral-500">
                    Association recommandée
                  </dt>
                  <dd className="font-medium">
                    {reco?.associations?.[0]?.nom ?? (
                      <span className="text-savr-neutral-400">Aucune</span>
                    )}
                  </dd>
                </div>
              </dl>
              <p className="mt-2 text-xs text-savr-neutral-500">
                Attribution complète (validation, emails, top 3 associations) :{' '}
                <Link
                  href={`/admin/attributions-ag/${collecte.id}`}
                  className="text-savr-primary-600 hover:underline"
                >
                  écran d&apos;attribution AG →
                </Link>
              </p>
            </div>

            <label
              htmlFor="dispatch-transporteur"
              className="block text-sm font-medium text-savr-neutral-700"
            >
              Prestataire à attribuer
            </label>
            <Select
              id="dispatch-transporteur"
              value={selectedTransporteurId}
              onChange={(e) => setSelectedTransporteurId(e.target.value)}
            >
              <option value="">
                {currentTransporteur
                  ? `Conserver — ${currentTransporteur.nom}`
                  : '— Choisir un transporteur —'}
              </option>
              {transporteurs.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nom} ({t.type_tms})
                  {t.id === recommendedTransporteurId ? ' — recommandé' : ''}
                </option>
              ))}
            </Select>
            {overrideActif && (
              <div>
                <label
                  htmlFor="dispatch-motif"
                  className="block text-sm font-medium text-savr-neutral-700 mb-1"
                >
                  Motif override (obligatoire ≥ 5 car. — prestataire ≠ reco
                  algo)
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

        {/* Bouton d'envoi TMS forké par type_tms */}
        <div className="flex justify-end">
          <Button
            disabled={isTerminal || dispatching || overrideMotifManquant}
            onClick={() => void handleDispatch()}
          >
            <Send className="h-4 w-4 mr-2" />
            {dispatching
              ? 'Envoi…'
              : libelleDispatch(forkTypeTms, !!collecte.tms_reference)}
          </Button>
        </div>

        {/* Tournées (multi-camions) */}
        {collecte.collecte_tournees.length > 0 && (
          <div>
            <p className="text-sm font-medium text-savr-neutral-700 mb-2">
              Tournées
            </p>
            <div className="space-y-1">
              {collecte.collecte_tournees.map((ct) => (
                <div
                  key={ct.rang}
                  className="flex items-center gap-4 text-sm bg-savr-neutral-50 rounded px-3 py-2"
                >
                  <span className="font-medium">Camion {ct.rang}</span>
                  <Badge variant="neutral" className="text-xs">
                    {ct.tournees.statut}
                  </Badge>
                  <span className="font-mono text-xs text-savr-neutral-500">
                    {ct.tournees.external_ref_commande ?? '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Blocs 1-4 — Infos mutualisées */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="p-6 space-y-4">
          <h2 className="font-semibold text-savr-neutral-800">
            Bloc 1 — Événement & Lieu
          </h2>
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-savr-neutral-500">Traiteur</dt>
              <dd className="font-medium">
                {collecte.evenements.organisations.raison_sociale}
              </dd>
            </div>
            <div>
              <dt className="text-savr-neutral-500">Événement</dt>
              <dd className="font-medium">
                {collecte.evenements.nom_evenement ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-savr-neutral-500">Type</dt>
              <dd className="font-medium">
                {collecte.evenements.types_evenements?.libelle ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-savr-neutral-500">PAX</dt>
              <dd className="font-medium">{collecte.evenements.pax}</dd>
            </div>
            <div>
              <dt className="text-savr-neutral-500">Lieu</dt>
              <dd className="font-medium">
                {collecte.evenements.lieux.nom} —{' '}
                {collecte.evenements.lieux.ville}
              </dd>
            </div>
            <div>
              <dt className="text-savr-neutral-500">Adresse</dt>
              <dd className="font-medium">
                {collecte.evenements.lieux.adresse_acces}
              </dd>
            </div>
            {collecte.volume_estime_repas && (
              <div>
                <dt className="text-savr-neutral-500">Volume estimé</dt>
                <dd className="font-medium">
                  {collecte.volume_estime_repas} repas
                </dd>
              </div>
            )}
          </dl>
        </Card>

        <Card className="p-6 space-y-4">
          <h2 className="font-semibold text-savr-neutral-800">
            Bloc 2 — Logistique
          </h2>
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-savr-neutral-500">Date</dt>
              <dd className="font-medium">
                {new Date(collecte.date_collecte).toLocaleDateString('fr-FR')}
              </dd>
            </div>
            <div>
              <dt className="text-savr-neutral-500">Heure</dt>
              <dd className="font-medium">{collecte.heure_collecte}</dd>
            </div>
            <div>
              <dt className="text-savr-neutral-500">Contrôle accès</dt>
              <dd className="font-medium">
                {collecte.controle_acces_requis ? 'Oui' : 'Non'}
              </dd>
            </div>
            {collecte.informations_supplementaires && (
              <div>
                <dt className="text-savr-neutral-500">Infos supplémentaires</dt>
                <dd className="bg-savr-neutral-50 rounded p-2">
                  {collecte.informations_supplementaires}
                </dd>
              </div>
            )}
            {collecte.notes_internes && (
              <div>
                <dt className="text-savr-neutral-500">Notes internes</dt>
                <dd className="bg-savr-neutral-50 rounded p-2">
                  {collecte.notes_internes}
                </dd>
              </div>
            )}
          </dl>
        </Card>
      </div>

      {/* Bloc 3 — Pesées ZD (dérivées des pesées MTS-1 ou saisie manuelle Admin) */}
      {collecte.type === 'zero_dechet' && (
        <Card className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-savr-neutral-800">
              Bloc 3 — Pesées ZD
            </h2>
            {!editPesees && (
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
            )}
          </div>

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
                          <span className="font-medium">{poids} kg</span>
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
                        <input
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
                          className="w-28 rounded-savr-md border border-savr-neutral-300 px-2 py-1 text-right text-sm focus:outline-2 focus:outline-offset-2 focus:outline-savr-primary-500"
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
              {peseesError && <AlertBar variant="err">{peseesError}</AlertBar>}
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

      {/* Bloc 3 (CDC) — Documents : rapport RSE / bordereau ZD / attestation AG + photos */}
      <Card className="p-6 space-y-4">
        <h2 className="font-semibold text-savr-neutral-800 flex items-center gap-2">
          <FileText className="h-4 w-4" />
          Documents
        </h2>
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
                            ).toLocaleDateString('fr-FR')}`
                          : ''
                      }`}
                      className="inline-flex items-center text-savr-primary-600"
                    >
                      <RotateCw className="h-3.5 w-3.5" />
                    </span>
                  )}
              </p>
              <p className="text-xs text-savr-neutral-500">
                {!documents?.rapport
                  ? 'Non encore généré'
                  : !documents.rapport.genere_at
                    ? 'En attente de génération'
                    : documents.rapport.consulte_par_user_at
                      ? `Consulté le ${new Date(
                          documents.rapport.consulte_par_user_at,
                        ).toLocaleDateString('fr-FR')}`
                      : 'Disponible'}
              </p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              disabled={!documents?.rapport?.genere_at}
              onClick={() =>
                documents?.rapport &&
                void handleDownload(
                  `/api/v1/admin/rapports-rse/${documents.rapport.id}/download`,
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
                !documents?.rapport || regenerating === 'rapport-recyclage-zd'
              }
              onClick={() => void handleRegenerate('rapport-recyclage-zd')}
            >
              <RotateCw
                className={`h-4 w-4 mr-1 ${
                  regenerating === 'rapport-recyclage-zd' ? 'animate-spin' : ''
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
                    <span className="ml-2 font-mono text-xs text-savr-neutral-500">
                      {documents.bordereau.numero}
                    </span>
                  )}
                </p>
                <p className="text-xs text-savr-neutral-500">
                  {documents?.bordereau
                    ? `Statut : ${documents.bordereau.statut}`
                    : 'Non encore généré'}
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={!documents?.bordereau?.genere_at}
                onClick={() =>
                  documents?.bordereau &&
                  void handleDownload(
                    `/api/v1/admin/bordereaux/${documents.bordereau.id}/download`,
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
                    <span className="ml-2 font-mono text-xs text-savr-neutral-500">
                      {documents.attestation.numero}
                    </span>
                  )}
                </p>
                <p className="text-xs text-savr-neutral-500">
                  {documents?.attestation
                    ? `Statut : ${documents.attestation.statut}`
                    : 'Non encore générée'}
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={!documents?.attestation?.genere_at}
                onClick={() =>
                  documents?.attestation &&
                  void handleDownload(
                    `/api/v1/admin/attestations/${documents.attestation.id}/download`,
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
                  !documents?.attestation || regenerating === 'attestation-don'
                }
                onClick={() => void handleRegenerate('attestation-don')}
              >
                <RotateCw
                  className={`h-4 w-4 mr-1 ${
                    regenerating === 'attestation-don' ? 'animate-spin' : ''
                  }`}
                />
                Régénérer
              </Button>
            </div>
          )}
        </div>

        {/* Galerie photos + import */}
        <div className="border-t border-savr-neutral-100 pt-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-savr-neutral-700">
              Photos ({documents?.photos?.length ?? 0})
            </p>
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
                  <div
                    key={p.id}
                    className="h-24 w-full flex items-center justify-center rounded-savr-md border border-savr-neutral-200 bg-savr-neutral-50 text-xs text-savr-neutral-400"
                  >
                    Photo
                  </div>
                ),
              )}
            </div>
          ) : (
            <p className="text-sm text-savr-neutral-400">
              Aucune photo importée.
            </p>
          )}
        </div>
      </Card>

      {/* Bloc 4 (CDC) — Pack AG (si type AG) */}
      {collecte.type === 'anti_gaspi' && (
        <Card className="p-6 space-y-4">
          <h2 className="font-semibold text-savr-neutral-800 flex items-center gap-2">
            <Gift className="h-4 w-4" />
            Pack AG
          </h2>
          {collecte.packs_antgaspi ? (
            <dl className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <dt className="text-savr-neutral-500">Pack rattaché</dt>
                <dd className="font-medium">
                  {collecte.packs_antgaspi.type_pack}
                </dd>
              </div>
              <div>
                <dt className="text-savr-neutral-500">Crédits restants</dt>
                <dd className="font-medium">
                  {collecte.packs_antgaspi.credits_restants}
                </dd>
              </div>
              <div>
                <dt className="text-savr-neutral-500">Statut</dt>
                <dd>
                  <Badge variant="neutral" className="text-xs">
                    {collecte.packs_antgaspi.statut}
                  </Badge>
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-savr-neutral-500">
              Aucun pack rattaché à cette collecte.
            </p>
          )}
          {/* Badge recrédit (annulee après realisee, §06.06 l.247 — le pack a été
              détaché par le trigger, la date vient de l'audit du recrédit). */}
          {collecte.statut === 'annulee' && recreditAt && (
            <Badge variant="warning" className="text-xs">
              Crédit recrédité automatiquement le{' '}
              {new Date(recreditAt).toLocaleDateString('fr-FR')}
            </Badge>
          )}
        </Card>
      )}

      {/* Bloc 5 (CDC) — Attribution AG complète (Admin-only, si type AG) */}
      {collecte.type === 'anti_gaspi' && (
        <Card className="p-6 space-y-4">
          <h2 className="font-semibold text-savr-neutral-800">
            Bloc 5 — Attribution AG
          </h2>
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-savr-neutral-500">Association retenue</dt>
              <dd className="font-medium">
                {collecte.attributions_antgaspi?.associations?.nom ?? (
                  <span className="text-savr-neutral-400">
                    Aucune (en attente d’attribution)
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-savr-neutral-500">Transporteur retenu</dt>
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
                    ).toLocaleDateString('fr-FR')}
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
                {collecte.attributions_antgaspi?.volume_repas_realise ?? '—'}
              </dd>
            </div>
          </dl>
          {reco?.associations && reco.associations.length > 0 && (
            <div className="rounded-savr-md border border-savr-neutral-100 bg-savr-neutral-50 p-3">
              <p className="text-xs font-medium text-savr-neutral-600 mb-1">
                Top 3 associations recommandées + scores (algo §06.09)
              </p>
              <ol className="list-decimal list-inside text-sm text-savr-neutral-700">
                {reco.associations.slice(0, 3).map((a) => (
                  <li key={a.id}>
                    {a.nom}
                    {(a.distance_km != null ||
                      a.capacite_max_beneficiaires != null) && (
                      <span className="text-savr-neutral-500">
                        {' — '}
                        {a.distance_km != null ? `${a.distance_km} km` : ''}
                        {a.distance_km != null &&
                        a.capacite_max_beneficiaires != null
                          ? ' · '
                          : ''}
                        {a.capacite_max_beneficiaires != null
                          ? `capacité ${a.capacite_max_beneficiaires}`
                          : ''}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}
          <Link
            href={`/admin/attributions-ag/${collecte.id}`}
            className="inline-flex items-center text-sm font-medium text-savr-primary-600 hover:underline"
          >
            Ouvrir l’attribution complète (top 3, validation, emails, re-jouer
            l’algo) →
          </Link>
        </Card>
      )}

      {/* Bloc 6 — Facturation */}
      <Card className="p-6 space-y-4">
        <h2 className="font-semibold text-savr-neutral-800">
          Bloc 6 — Facturation
        </h2>
        {collecte.factures_collectes.length === 0 ? (
          <p className="text-sm text-savr-neutral-500">
            Aucune facture générée.
          </p>
        ) : (
          <div className="space-y-2">
            {collecte.factures_collectes.map((f) => (
              <div
                key={f.id}
                className="flex items-center justify-between text-sm bg-savr-neutral-50 rounded px-3 py-2"
              >
                <span className="font-mono text-xs text-savr-neutral-500">
                  {f.id.slice(0, 8)}…
                </span>
                <Badge variant="neutral">{f.factures?.statut ?? '—'}</Badge>
                <span className="font-medium">{f.montant_ht} € HT</span>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2 flex-wrap">
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
      </Card>

      {/* Bloc 7 (CDC) — Historique + Audit log (Admin-only) */}
      <Card className="p-6 space-y-4">
        <h2 className="font-semibold text-savr-neutral-800 flex items-center gap-2">
          <History className="h-4 w-4" />
          Historique &amp; audit
        </h2>
        {audit.length === 0 ? (
          <p className="text-sm text-savr-neutral-500">
            Aucune action enregistrée sur cette collecte.
          </p>
        ) : (
          <Timeline>
            {audit.map((e) => {
              const oldStatut = (e.old_values as { statut?: string } | null)
                ?.statut;
              const newStatut = (e.new_values as { statut?: string } | null)
                ?.statut;
              return (
                <TimelineItem key={e.id}>
                  <p className="text-sm font-medium text-savr-neutral-800">
                    {e.action}
                    {oldStatut && newStatut && (
                      <span className="ml-2 font-normal text-savr-neutral-500">
                        {oldStatut} → {newStatut}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-savr-neutral-500">
                    {new Date(e.created_at).toLocaleString('fr-FR')}
                    {e.role ? ` · ${e.role}` : ''}
                    {e.impersonator_id ? ' · (impersonation)' : ''}
                  </p>
                  {e.motif && (
                    <p className="mt-1 text-xs italic text-savr-neutral-600">
                      « {e.motif} »
                    </p>
                  )}
                </TimelineItem>
              );
            })}
          </Timeline>
        )}
      </Card>

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
          <p className="text-sm text-savr-neutral-500">
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
          </p>
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
          <p className="text-sm text-savr-neutral-500">
            Bascule manuelle hors machine à états. L&apos;action est tracée dans
            l&apos;audit (motif obligatoire).
          </p>
          <div>
            <label
              htmlFor="force-statut-select"
              className="mb-1 block text-sm font-medium text-savr-neutral-700"
            >
              Nouveau statut
            </label>
            <Select
              id="force-statut-select"
              value={forceStatutValue}
              onChange={(e) => setForceStatutValue(e.target.value)}
              required
            >
              {STATUTS_FORCABLES.map((s) => (
                <option key={s} value={s}>
                  {statutCollecteDisplay(s, 'admin').label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label
              htmlFor="force-statut-motif"
              className="mb-1 block text-sm font-medium text-savr-neutral-700"
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
          <p className="text-sm text-savr-neutral-500">
            L&apos;adapter crée N tournées (1 par camion). Réduire N à moins
            d&apos;1 h de la mission est bloqué (alerte Ops). Non modifiable sur
            un statut terminal.
          </p>
          <div>
            <label
              htmlFor="nb-camions-input"
              className="mb-1 block text-sm font-medium text-savr-neutral-700"
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
