'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import {
  BarChart3,
  CalendarDays,
  FileText,
  MapPin,
  Pencil,
  Truck,
  Users,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AlertBar } from '@/components/ui/alert-bar';
import { Badge } from '@/components/ui/badge';
import { CollecteStatutBadge } from '@/components/ui/collecte-statut-badge';
import { Card } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip } from '@/components/ui/tooltip';
import { EditerCollecteForm } from '@/components/collecte/editer-collecte-form';
import {
  BlocHeader,
  ContactLigne,
  InfoItem,
  ResumeItem,
} from '@/components/collecte/fiche-blocs';
import {
  BenchmarkFilterBar,
  FLUX_ZD,
  type BenchmarkFilters,
} from '@/components/dashboards';
import { BenchmarkRadar } from '@/components/dashboards/charts/cockpit/BenchmarkRadar';
import { refCourteCollecte } from '@/lib/collecte-ref';
import { formatDateParis } from '@savr/shared/src/temps/index.js';

// Tooltip méthode UE (§06.04 l.422) — texte figé, affiché sur le libellé « Taux de
// recyclage » de la fiche (BL-P3-03).
const TOOLTIP_TAUX_UE =
  'Taux de recyclage net (méthode UE 2019/1004) — calculé avec les taux de captation ' +
  'effectifs par filière (verre, carton, biodéchets, emballages). L’OMR (déchet ' +
  'résiduel) entre uniquement au dénominateur. Voir Méthodologie.';

// Libellés des organisations programmatrices tierces (§06.04 badge « Programmée par »).
const TYPE_ORGA_LABEL: Record<string, string> = {
  agence: 'agence',
  gestionnaire_lieux: 'gestionnaire de lieux',
};

interface Lieu {
  nom: string;
  adresse_acces: string | null;
  code_postal: string | null;
  ville: string | null;
}
interface TypeEvenement {
  libelle: string | null;
}
interface Evenement {
  id: string;
  nom_evenement: string | null;
  pax: number | null;
  type_evenement_id: string | null;
  nom_client_organisateur: string | null;
  reference_affaire: string | null;
  notes_internes: string | null;
  contact_principal_nom: string | null;
  contact_principal_telephone: string | null;
  contact_secours_nom: string | null;
  contact_secours_telephone: string | null;
  type_evenement: TypeEvenement | TypeEvenement[] | null;
  lieu: Lieu | Lieu[] | null;
}
interface TourneeInfo {
  plaque_immatriculation: string | null;
  chauffeur_nom: string | null;
  chauffeur_telephone: string | null;
  type_vehicule: string | null;
}
interface FactureInfo {
  id: string;
  numero_facture: string;
  statut: string;
  pdf_url_savr: string | null;
  pdf_url_pennylane: string | null;
}
interface ProgrammeePar {
  nom: string;
  type: string;
  email: string | null;
}
interface Collecte {
  id: string;
  type: string;
  statut: string;
  statut_tms: string;
  tms_reference: string | null;
  date_collecte: string;
  heure_collecte: string | null;
  controle_acces_requis: boolean;
  informations_completes: boolean;
  informations_supplementaires: string | null;
  notes_internes: string | null;
  taux_recyclage: number | null;
  realisee_at: string | null;
  aucun_repas_motif: string | null;
  taille_bracket: string | null;
  programmee_par: ProgrammeePar | null;
  tournees: TourneeInfo[] | null;
  rapport_rse_disponible: boolean | null;
  rapport_rse_regenere: boolean | null;
  can_regenerate: boolean | null;
  factures: FactureInfo[] | null;
  evenement: Evenement | Evenement[] | null;
}

interface BenchmarkFlux {
  ratio_user: number | null;
  benchmark_kg_pax: number | null;
}

function one<T>(v: T | T[] | null): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

const STATUTS_EDITABLES = ['programmee', 'validee'];
const STATUTS_ANNULABLES = ['brouillon', 'programmee', 'validee'];
// Bloc 3 ZD benchmark — collectes ZD terminées (§06.04 l.428).
const STATUTS_BENCHMARK = ['realisee', 'cloturee'];
// Bloc Logistique : chauffeur + plaque + téléphone affichés dès qu'un camion est
// affecté, tant que la collecte n'est pas terminée (arbitrage Val 2026-09-29 :
// plus conditionné au contrôle d'accès — divergence §06.04 tracée).
const STATUTS_LOGISTIQUE = ['programmee', 'validee', 'en_cours'];

function typeCollecteLabel(type: string): string {
  return type === 'zero_dechet' ? 'Zéro Déchet' : 'Anti-Gaspi';
}

interface FicheCollecteTraiteurPanelProps {
  collecteId: string;
  // Ouverture directe en édition (action « Modifier » de la liste).
  initialEditing?: boolean;
  // Remonte au wrapper modale le type + le titre-résumé une fois la collecte
  // chargée → titre de la modale + couleur du cadre (AG orange / ZD vert).
  onLoaded?: (info: {
    type: 'anti_gaspi' | 'zero_dechet';
    title: string;
  }) => void;
  // Signale une mutation (édition, annulation, régénération) : la liste
  // rafraîchit à la fermeture de la modale.
  onChanged?: () => void;
  // Entrée / sortie du mode édition : la liste retire `edit=1` de l'URL.
  onEditingChange?: (editing: boolean) => void;
  // Miroir « une sous-modale est ouverte » : le wrapper ne ferme pas la fiche
  // sur Escape tant qu'une sous-modale (annulation, programmée par) est ouverte.
  blockCloseRef?: MutableRefObject<boolean>;
}

export function FicheCollecteTraiteurPanel({
  collecteId: id,
  initialEditing = false,
  onLoaded,
  onChanged,
  onEditingChange,
  blockCloseRef,
}: FicheCollecteTraiteurPanelProps) {
  const [c, setC] = useState<Collecte | null>(null);
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [editing, setEditing] = useState(initialEditing);

  // Annulation (BL-P1-TRAIT-03) — modale + champ motif (plus de POST à motif vide).
  const [annulOpen, setAnnulOpen] = useState(false);
  const [annulMotif, setAnnulMotif] = useState('');
  const [annulEnCours, setAnnulEnCours] = useState(false);
  const [annulErreur, setAnnulErreur] = useState<string | null>(null);
  const [regenEnCours, setRegenEnCours] = useState(false);
  const [progOpen, setProgOpen] = useState(false);
  // Confirmation « Confirmer la modification » du formulaire d'édition.
  const [editConfirmOpen, setEditConfirmOpen] = useState(false);

  useEffect(() => {
    onEditingChange?.(editing);
  }, [editing, onEditingChange]);

  // Bloc 3 ZD — repère parc par flux. Premier rendu sans filtre (segment de la
  // collecte) ; l'encart émet ensuite ses défauts (période fixe 24 mois glissants) et le
  // repère est recalculé — les valeurs « Vous », elles, ne bougent pas.
  const [bench, setBench] = useState<Record<string, BenchmarkFlux> | null>(
    null,
  );
  const [benchFilters, setBenchFilters] = useState<BenchmarkFilters | null>(
    null,
  );

  // Fiche → fiche sans remontage (rendu direct du panneau) : une réponse lente
  // de la fiche quittée écraserait la nouvelle. On compare l'id capturé par la
  // requête à l'id actuellement rendu — `idRendu` est réaffecté à chaque rendu,
  // jamais dans un effet. Couvre aussi les `reload()` manuels, déclenchés hors
  // de tout effet après une annulation ou une régénération.
  const idRendu = useRef(id);
  idRendu.current = id;

  const reload = useCallback(() => {
    setErreur(null);
    const perime = (): boolean => idRendu.current !== id;
    fetch(`/api/v1/traiteur/collectes/${encodeURIComponent(id)}`)
      .then(async (r) => {
        // 404 = collecte supprimée ou sortie du périmètre : ce n'est pas une
        // panne, et « Réessayer » n'y changerait rien. La fiche rend son état
        // « introuvable », distinct de l'état Error (§10 §7).
        if (r.status === 404) return null;
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((j) => {
        if (perime()) return;
        setC(j?.data ?? null);
      })
      .catch(() => {
        if (!perime()) setErreur('Le chargement de la collecte a échoué.');
      })
      .finally(() => {
        if (!perime()) setLoading(false);
      });
  }, [id]);

  useEffect(() => {
    // Réinitialiser AVANT de recharger : sans cela, le temps d'un aller-retour,
    // la fiche quittée resterait affichée alors que les actions portent déjà
    // sur la nouvelle. `bench` porte le ratio kg/pax de LA collecte : purgé aussi.
    setC(null);
    setLoading(true);
    setBench(null);
    reload();
  }, [reload]);

  const benchmarkVisible =
    c?.type === 'zero_dechet' && STATUTS_BENCHMARK.includes(c.statut);

  useEffect(() => {
    if (!benchmarkVisible || !benchFilters) return;
    const qs = new URLSearchParams();
    if (benchFilters.periode_debut)
      qs.set('periode_debut', benchFilters.periode_debut);
    if (benchFilters.periode_fin)
      qs.set('periode_fin', benchFilters.periode_fin);
    if (benchFilters.type_evenement_ids.length)
      qs.set('type_evenement_ids', benchFilters.type_evenement_ids.join(','));
    if (benchFilters.taille_evenement_codes.length)
      qs.set(
        'taille_evenement_codes',
        benchFilters.taille_evenement_codes.join(','),
      );
    if (benchFilters.lieu_ids.length)
      qs.set('lieu_ids', benchFilters.lieu_ids.join(','));
    const url = `/api/v1/traiteur/collectes/${encodeURIComponent(id)}/benchmark?${qs.toString()}`;
    let annule = false;
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (annule) return;
        // Échec du recalcul ⇒ on RETIRE le repère au lieu de laisser celui des
        // filtres précédents : un chiffre périmé sans signal est pire que pas
        // de chiffre sur un écran dont la fonction est la comparaison.
        setBench(j?.data?.flux ?? null);
      })
      .catch(() => {
        if (!annule) setBench(null);
      });
    return () => {
      annule = true;
    };
  }, [id, benchmarkVisible, benchFilters]);

  // Titre de la modale (en-tête figé) : type · date · heure · lieu · pax.
  useEffect(() => {
    if (!c) return;
    const evt = one(c.evenement);
    const lieu = one(evt?.lieu ?? null);
    const morceaux = [
      `Collecte ${typeCollecteLabel(c.type)}`,
      formatDateParis(c.date_collecte),
      c.heure_collecte?.slice(0, 5),
      lieu ? `${lieu.nom}${lieu.ville ? ` (${lieu.ville})` : ''}` : null,
      evt?.pax != null ? `${evt.pax} pax` : null,
    ];
    onLoaded?.({
      type: c.type === 'zero_dechet' ? 'zero_dechet' : 'anti_gaspi',
      title: morceaux.filter(Boolean).join(' · '),
    });
  }, [c, onLoaded]);

  if (blockCloseRef)
    blockCloseRef.current = annulOpen || progOpen || editConfirmOpen;

  async function confirmerAnnulation() {
    setAnnulEnCours(true);
    setAnnulErreur(null);
    try {
      const res = await fetch(
        `/api/v1/traiteur/collectes/${encodeURIComponent(id)}/annulation`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ motif: annulMotif }),
        },
      );
      if (res.ok) {
        setAnnulOpen(false);
        onChanged?.();
        reload();
      } else {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setAnnulErreur(j.error ?? "Échec de l'annulation.");
      }
    } finally {
      setAnnulEnCours(false);
    }
  }

  async function telechargerRapport() {
    const res = await fetch(
      `/api/v1/traiteur/collectes/${encodeURIComponent(id)}/rapport-rse/download`,
    );
    if (!res.ok) return;
    const { url } = (await res.json()) as { url?: string };
    if (url) window.open(url, '_blank');
  }

  // Régénération manuelle du rapport RSE (RPT-04, manager, ZD) — §12 §1.2 l.92.
  async function regenererRapport() {
    setRegenEnCours(true);
    try {
      const res = await fetch(
        `/api/v1/traiteur/collectes/${encodeURIComponent(id)}/documents/rapport-recyclage-zd/regenerate`,
        { method: 'POST' },
      );
      if (res.ok) {
        onChanged?.();
        reload();
      }
    } finally {
      setRegenEnCours(false);
    }
  }

  // États système §10 §7 : Loading = skeleton à la forme du contenu, Error =
  // message + « Réessayer » (jamais un « introuvable » trompeur sur un 500).
  if (loading)
    return (
      <div className="space-y-4" data-testid="fiche-skeleton">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  if (erreur)
    return (
      <div className="space-y-4" data-testid="fiche-erreur">
        <AlertBar variant="err">{erreur}</AlertBar>
        <Button
          variant="secondary"
          onClick={() => {
            setLoading(true);
            reload();
          }}
        >
          Réessayer
        </Button>
      </div>
    );
  if (!c) return <p className="p-4 text-sm">Collecte introuvable.</p>;

  const evt = one(c.evenement);
  const lieu = one(evt?.lieu ?? null);
  const typeEvt = one(evt?.type_evenement ?? null);
  const heure = c.heure_collecte?.slice(0, 5) ?? null;
  const dateLongue = new Date(c.date_collecte).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Paris',
  });
  const adresse = [lieu?.adresse_acces, lieu?.code_postal, lieu?.ville]
    .filter(Boolean)
    .join(' ');

  const tournees = c.tournees ?? [];
  const logistiqueVisible =
    STATUTS_LOGISTIQUE.includes(c.statut) && tournees.length > 0;

  const factureTelechargeable = (c.factures ?? []).find(
    (f) => f.statut !== 'brouillon' && (f.pdf_url_pennylane || f.pdf_url_savr),
  );
  const documentsVisibles = Boolean(
    c.rapport_rse_disponible || factureTelechargeable,
  );
  const tauxVisible = c.type === 'zero_dechet' && c.statut === 'cloturee';
  const sansCollecte = c.statut === 'realisee_sans_collecte';
  const bilanVide =
    !documentsVisibles && !tauxVisible && !sansCollecte && !benchmarkVisible;

  const estDemande = c.statut === 'validee';
  const progTypeLabel = c.programmee_par
    ? (TYPE_ORGA_LABEL[c.programmee_par.type] ?? c.programmee_par.type)
    : null;

  const gaugeItems = FLUX_ZD.map((f) => ({
    label: f.label,
    value: bench?.[f.code]?.ratio_user ?? null,
    benchmark: bench?.[f.code]?.benchmark_kg_pax ?? null,
  }));

  return (
    <div className="space-y-4">
      {/* En-tête : référence + statut à gauche, actions à droite. Le titre-résumé
          (type · date · heure · lieu · pax) vit dans l'en-tête figé de la modale. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <CollecteStatutBadge statut={c.statut} />
          <span className="text-xs text-savr-neutral-400">
            Réf. {refCourteCollecte(c)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={!STATUTS_EDITABLES.includes(c.statut)}
            title={
              STATUTS_EDITABLES.includes(c.statut)
                ? ''
                : 'Édition impossible à ce statut'
            }
            onClick={() => setEditing((v) => !v)}
          >
            <Pencil className="h-4 w-4" />
            {editing ? 'Fermer l’édition' : 'Éditer la collecte'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!STATUTS_ANNULABLES.includes(c.statut)}
            onClick={() => {
              setAnnulErreur(null);
              setAnnulOpen(true);
            }}
          >
            <XCircle className="h-4 w-4" />
            {estDemande ? "Demander l'annulation" : 'Annuler la collecte'}
          </Button>
        </div>
      </div>

      {!c.informations_completes && (
        <AlertBar variant="warn" data-testid="bandeau-infos-incompletes">
          Informations incomplètes — merci de compléter avant la collecte.
        </AlertBar>
      )}

      {/* Formulaire d'édition (événement + collecte) */}
      {editing && evt && (
        <EditerCollecteForm
          collecte={{
            id: c.id,
            type: c.type,
            statut: c.statut,
            statut_tms: c.statut_tms,
            date_collecte: c.date_collecte,
            heure_collecte: c.heure_collecte,
            controle_acces_requis: c.controle_acces_requis,
            informations_supplementaires: c.informations_supplementaires,
            notes_internes: c.notes_internes,
            lieu_nom: lieu?.nom ?? null,
            evenement: {
              id: evt.id,
              nom_evenement: evt.nom_evenement,
              pax: evt.pax,
              type_evenement_id: evt.type_evenement_id,
              nom_client_organisateur: evt.nom_client_organisateur,
              reference_affaire: evt.reference_affaire,
              contact_principal_nom: evt.contact_principal_nom,
              contact_principal_telephone: evt.contact_principal_telephone,
              contact_secours_nom: evt.contact_secours_nom,
              contact_secours_telephone: evt.contact_secours_telephone,
              notes_internes: evt.notes_internes,
            },
          }}
          collecteEndpoint={`/api/v1/traiteur/collectes/${encodeURIComponent(c.id)}`}
          onSaved={() => {
            setEditing(false);
            onChanged?.();
            reload();
          }}
          onCancel={() => setEditing(false)}
          onConfirmOpenChange={setEditConfirmOpen}
        />
      )}

      {/* Colonne résumé fixe à gauche + onglets à droite (même mise en page que
          la fiche Admin). Masquée sous md : le titre de la modale porte le résumé. */}
      <div className="grid items-start gap-4 md:min-h-[50vh] md:grid-cols-[13rem_minmax(0,1fr)]">
        <aside
          aria-label="Résumé de la collecte"
          className="hidden rounded-savr-lg border border-savr-neutral-100 bg-savr-neutral-50 p-4 md:sticky md:top-0 md:block"
        >
          <dl className="grid grid-cols-1 gap-y-3 text-sm">
            <ResumeItem label="Date et heure">
              {dateLongue}
              {heure && (
                <span className="block text-savr-neutral-600">{heure}</span>
              )}
            </ResumeItem>
            <ResumeItem label="Pax">
              {evt?.pax != null ? evt.pax : '—'}
            </ResumeItem>
            <ResumeItem label="Lieu">
              {lieu?.nom ?? '—'}
              {lieu?.ville && (
                <span className="block text-savr-neutral-600">
                  {lieu.ville}
                </span>
              )}
            </ResumeItem>
            <ResumeItem label="Type de collecte">
              {typeCollecteLabel(c.type)}
            </ResumeItem>
          </dl>
        </aside>

        <Tabs defaultValue="informations" className="min-w-0">
          <TabsList className="sticky top-0 z-10 w-full overflow-x-auto bg-savr-white">
            <TabsTrigger value="informations" className="px-3 sm:px-4">
              Informations
            </TabsTrigger>
            <TabsTrigger value="logistique" className="px-3 sm:px-4">
              Logistique
            </TabsTrigger>
            <TabsTrigger value="bilan" className="px-3 sm:px-4">
              Bilan & documents
            </TabsTrigger>
          </TabsList>

          <TabsContent value="informations" className="space-y-4">
            <Card className="p-5 space-y-4">
              <BlocHeader icon={CalendarDays} title="Événement" />
              <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <InfoItem label="Heure de collecte">{heure ?? '—'}</InfoItem>
                <InfoItem label="Nombre de pax">
                  {evt?.pax != null ? evt.pax : '—'}
                </InfoItem>
                <InfoItem label="Type d’événement">
                  <span className="flex flex-wrap items-center gap-2">
                    {typeEvt?.libelle ?? '—'}
                    {c.taille_bracket && (
                      <Badge
                        variant="neutral"
                        dot={false}
                        title={`Taille de l’événement (calculée sur le nombre de convives) : ${c.taille_bracket}`}
                      >
                        {c.taille_bracket}
                      </Badge>
                    )}
                  </span>
                </InfoItem>
                {evt?.nom_client_organisateur && (
                  <InfoItem label="Client final">
                    {evt.nom_client_organisateur}
                  </InfoItem>
                )}
                {evt?.nom_evenement && (
                  <InfoItem label="Nom de l’événement">
                    {evt.nom_evenement}
                  </InfoItem>
                )}
                {/* Badge « Programmée par » (§06.04, ajout 2026-05-07) : l'événement
                    a été programmé par un tiers, le traiteur est l'opérationnel sur
                    place. Libellé porté PAR le badge — forme exacte du CDC. */}
                {c.programmee_par && (
                  <div className="sm:col-span-2">
                    <button
                      type="button"
                      data-testid="badge-programmee-par"
                      onClick={() => setProgOpen(true)}
                      className="rounded-savr-full"
                    >
                      <Badge variant="action">
                        Programmée par {c.programmee_par.nom} ({progTypeLabel})
                      </Badge>
                    </button>
                  </div>
                )}
              </dl>
            </Card>

            <Card className="p-5 space-y-4">
              <BlocHeader icon={MapPin} title="Lieu" />
              <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <InfoItem label="Nom">{lieu?.nom ?? '—'}</InfoItem>
                <InfoItem label="Adresse">{adresse || '—'}</InfoItem>
              </dl>
            </Card>

            <Card className="p-5 space-y-4">
              <BlocHeader icon={Users} title="Contacts" />
              <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <InfoItem label="Contact principal">
                  <ContactLigne
                    nom={evt?.contact_principal_nom}
                    telephone={evt?.contact_principal_telephone}
                  />
                </InfoItem>
                <InfoItem label="Contact de secours">
                  <ContactLigne
                    nom={evt?.contact_secours_nom}
                    telephone={evt?.contact_secours_telephone}
                  />
                </InfoItem>
              </dl>
            </Card>
          </TabsContent>

          {/* Logistique — nom du chauffeur, plaque, téléphone : rien d'autre
              (demande Val 2026-09-29). Une carte par camion. */}
          <TabsContent value="logistique" className="space-y-4">
            <Card className="p-5 space-y-4" data-testid="bloc-logistique">
              <BlocHeader icon={Truck} title="Logistique" />
              {!logistiqueVisible ? (
                <p className="text-sm text-savr-neutral-500">
                  {STATUTS_LOGISTIQUE.includes(c.statut)
                    ? 'Aucun camion affecté pour le moment.'
                    : 'Aucune information logistique à afficher pour cette collecte.'}
                </p>
              ) : (
                <div className="space-y-2">
                  {tournees.map((t, i) => (
                    <div
                      key={i}
                      className="rounded-savr-md border border-savr-neutral-100 bg-savr-neutral-50 px-3 py-2.5 text-sm"
                    >
                      {tournees.length > 1 && (
                        <p className="mb-1.5 font-medium">Camion {i + 1}</p>
                      )}
                      <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-3">
                        <InfoItem label="Chauffeur">
                          {t.chauffeur_nom ?? (
                            <span className="text-savr-neutral-400">
                              En attente
                            </span>
                          )}
                        </InfoItem>
                        <InfoItem label="Plaque d’immatriculation">
                          {t.type_vehicule === 'velo_cargo' &&
                          !t.plaque_immatriculation ? (
                            // Vélo cargo : jamais de plaque, pas « en attente ».
                            <span className="text-savr-neutral-400">
                              Sans objet (vélo cargo)
                            </span>
                          ) : (
                            (t.plaque_immatriculation ?? (
                              <span className="text-savr-neutral-400">
                                En attente
                              </span>
                            ))
                          )}
                        </InfoItem>
                        <InfoItem label="Téléphone">
                          {t.chauffeur_telephone ? (
                            <a
                              href={`tel:${t.chauffeur_telephone.replace(/\s/g, '')}`}
                              className="text-savr-primary-600 hover:underline"
                            >
                              {t.chauffeur_telephone}
                            </a>
                          ) : (
                            <span className="text-savr-neutral-400">
                              En attente
                            </span>
                          )}
                        </InfoItem>
                      </dl>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </TabsContent>

          <TabsContent value="bilan" className="space-y-4">
            {bilanVide && (
              <Card className="p-5 space-y-4">
                <BlocHeader icon={FileText} title="Documents" />
                <p className="text-sm text-savr-neutral-500">
                  Le bilan et les documents seront disponibles après la
                  collecte.
                </p>
              </Card>
            )}

            {/* Documents téléchargeables (BL-P1-TRAIT-03) — §06.04 l.403-404 */}
            {documentsVisibles && (
              <Card className="p-5 space-y-4" data-testid="bloc-documents">
                <BlocHeader icon={FileText} title="Documents" />
                <div className="flex flex-wrap items-center gap-2">
                  {c.rapport_rse_disponible && (
                    <Button
                      variant="secondary"
                      onClick={() => void telechargerRapport()}
                    >
                      Télécharger le rapport RSE
                    </Button>
                  )}
                  {c.rapport_rse_regenere && (
                    <span
                      data-testid="rapport-regenere"
                      className="inline-flex items-center gap-1 text-xs text-savr-warning-strong"
                      title="Ce rapport a été mis à jour après sa première génération."
                    >
                      ⟳ Rapport mis à jour
                    </span>
                  )}
                  {c.can_regenerate && c.rapport_rse_disponible && (
                    <Button
                      variant="ghost"
                      disabled={regenEnCours}
                      onClick={() => void regenererRapport()}
                    >
                      {regenEnCours ? 'Régénération…' : 'Régénérer le rapport'}
                    </Button>
                  )}
                  {factureTelechargeable && (
                    <Button
                      variant="secondary"
                      onClick={() =>
                        window.open(
                          factureTelechargeable.pdf_url_pennylane ??
                            factureTelechargeable.pdf_url_savr ??
                            '',
                          '_blank',
                        )
                      }
                    >
                      Télécharger la facture
                    </Button>
                  )}
                </div>
              </Card>
            )}

            {/* Cas realisee_sans_collecte (AG) */}
            {sansCollecte && (
              <Card className="p-5 space-y-4">
                <BlocHeader icon={FileText} title="Aucun repas collecté" />
                <p className="text-sm">
                  {c.aucun_repas_motif ??
                    'Aucun excédent alimentaire sur place.'}
                </p>
              </Card>
            )}

            {/* Bloc 2bis ZD — taux de recyclage (collecte cloturee) */}
            {tauxVisible && (
              <Card className="p-5 space-y-4">
                <BlocHeader icon={BarChart3} title="Taux de recyclage" />
                <Tooltip content={TOOLTIP_TAUX_UE}>
                  <span
                    className="cursor-help border-b border-dotted border-savr-neutral-400 text-2xl font-bold"
                    tabIndex={0}
                    aria-label={TOOLTIP_TAUX_UE}
                  >
                    {c.taux_recyclage != null
                      ? `${c.taux_recyclage.toFixed(1)} %`
                      : '—'}
                  </span>
                </Tooltip>
              </Card>
            )}

            {/* Bloc 3 ZD — radar kg/pax de CETTE collecte × repère parc (§06.04).
                Filtres du repère imbriqués dans la carte ; k-anonymat ≥5 appliqué
                côté serveur → repère masqué. */}
            {benchmarkVisible && (
              <div data-testid="bloc-3-zd-fiche" key={id}>
                <BenchmarkRadar
                  items={gaugeItems}
                  filtersSlot={
                    <BenchmarkFilterBar
                      embedded
                      onChange={setBenchFilters}
                      initialTypeEvenementIds={
                        evt?.type_evenement_id ? [evt.type_evenement_id] : []
                      }
                      initialTailleCodes={
                        c.taille_bracket ? [c.taille_bracket] : []
                      }
                    />
                  }
                />
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Modale info « Programmée par » (§06.04) — informative, sans action :
          le droit de retrait passe par les boutons Éditer / Annuler existants. */}
      <Modal
        open={progOpen}
        title="Collecte programmée par un tiers"
        onClose={() => setProgOpen(false)}
      >
        <div className="space-y-4 text-sm">
          <p>
            Cette collecte a été programmée par{' '}
            <strong>{c.programmee_par?.nom}</strong>, {progTypeLabel}. Vous êtes
            le traiteur opérationnel sur place.
          </p>
          {c.programmee_par?.email && (
            <p className="text-savr-neutral-500">
              Pour toute question :{' '}
              <a
                className="text-savr-primary-700 underline"
                href={`mailto:${c.programmee_par.email}`}
              >
                {c.programmee_par.email}
              </a>
            </p>
          )}
          <div className="flex justify-end border-t border-savr-neutral-100 pt-4">
            <Button variant="secondary" onClick={() => setProgOpen(false)}>
              Fermer
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modale d'annulation / demande d'annulation (BL-P1-TRAIT-03) */}
      <Modal
        open={annulOpen}
        title={estDemande ? "Demander l'annulation" : 'Annuler la collecte'}
        onClose={() => setAnnulOpen(false)}
      >
        <div className="space-y-4">
          <p className="text-sm text-savr-neutral-500">
            {estDemande
              ? 'Votre demande d’annulation sera transmise à l’équipe Savr pour validation.'
              : 'Cette collecte sera annulée immédiatement. Le prestataire sera informé le cas échéant.'}
          </p>
          {/* Mention crédit préservé (AG) — §06.04 l.614 : rappel avant confirmation
              qu'une annulation avant réalisation ne débite aucun crédit pack. */}
          {c.type === 'anti_gaspi' && (
            <p
              data-testid="mention-credit-ag"
              className="rounded-savr-md bg-savr-success-subtle px-3 py-2 text-sm text-savr-success-strong"
            >
              Votre crédit Anti-Gaspi sera préservé : il n’a pas encore été
              débité (annulation avant réalisation de la collecte).
            </p>
          )}
          <label className="block text-sm">
            <span className="text-savr-neutral-700">Motif (facultatif)</span>
            <textarea
              className="mt-1 w-full rounded-savr-md border border-savr-neutral-300 px-3 py-2 text-sm"
              rows={3}
              value={annulMotif}
              onChange={(e) => setAnnulMotif(e.target.value)}
            />
          </label>
          {annulErreur && (
            <p className="text-sm text-savr-error-600">{annulErreur}</p>
          )}
          <div className="flex justify-end gap-2 border-t border-savr-neutral-100 pt-4">
            <Button
              variant="secondary"
              onClick={() => setAnnulOpen(false)}
              disabled={annulEnCours}
            >
              Retour
            </Button>
            <Button
              variant="destructive"
              onClick={() => void confirmerAnnulation()}
              disabled={annulEnCours}
            >
              {estDemande ? 'Confirmer la demande' : "Confirmer l'annulation"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
