'use client';

// Formulaire d'attribution AG (association + prestataire + besoin véhicule),
// partagé par la fiche collecte (onglet Logistique, décision Val 2026-10-01 :
// « l'association est choisie avant le prestataire, directement dans le
// popup ») et par l'écran /admin/attributions-ag/[id].
//
// Un seul geste : « Valider et envoyer » = rpc_valider_attribution_ag (asso +
// transporteur + débit pack + emails + event de dispatch, §06.09 §3). Le besoin
// véhicule (type souhaité + nombre) est écrit AVANT par la même route /valider :
// le worker lit la collecte à la consommation, donc N commandes MTS-1 et la
// ligne « Véhicule souhaité » du canal libre partent au prestataire.
//
// Mise en page (maquette validée Val 2026-10-01) : grille 2 colonnes alignée
// ligne à ligne — titres / champs / recommandations / listes / aides.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Minus, Plus, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FormField } from '@/components/ui/form-field';
import { Combobox } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { AlertBar } from '@/components/ui/alert-bar';
import { ErrorState } from '@/components/ui/error-state';
import { LoadingState } from '@/components/ui/loading-state';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { formatJour } from '@savr/shared/src/temps/index.js';
import {
  envoiAutomatique,
  libelleTypeTms,
  libelleValiderEtEnvoyer,
} from '@/lib/type-tms-labels';
import { Text } from '@/components/ui/text';
import { fmtPax, fmtInt } from '@/lib/format';

interface AssociationSuggestion {
  id: string;
  nom: string;
  // NULL = coordonnées GPS manquantes (lieu ou association) : jamais « 0 km ».
  distance_km: number | null;
  capacite_max_beneficiaires: number;
  contact_email: string;
}

interface TransporteurSuggestion {
  id: string;
  nom: string;
  type_tms: string;
  distance_km?: number;
}

export interface AlgoResult {
  associations: AssociationSuggestion[];
  assoc_count: number;
  transporteur: TransporteurSuggestion | null;
  transporteurs: TransporteurSuggestion[];
  branche: string;
  is_idf: boolean;
  no_asso: boolean;
  no_prestataire: boolean;
  delai_minutes: number;
  nb_pax: number;
}

interface AssoRef {
  id: string;
  nom: string;
  ville: string | null;
  capacite_max_beneficiaires: number | null;
  // null = inconnu (option de secours construite depuis la suggestion de l'algo).
  habilitee_attestation_fiscale: boolean | null;
  distance_km: number | null;
}

interface TranspRef {
  id: string;
  nom: string;
  type_tms: string;
  ville: string;
}

// Contexte de la collecte affiché en lecture seule (critères de l'algo asso) et
// valeurs initiales du besoin véhicule. Fourni par la fiche ; l'écran dédié le
// charge lui-même (GET /admin/collectes/[id]).
export interface ContexteCollecte {
  volume_estime_repas: number | null;
  pax: number | null;
  date_collecte: string | null;
  heure_collecte: string | null;
  nb_camions_demande: number;
  type_vehicule_souhaite: string | null;
}

// CDC §06.09 §3 — 6 motifs preset d'override (+ texte libre si 'autre').
const MOTIFS_OVERRIDE: { code: string; libelle: string }[] = [
  {
    code: 'assoc_top1_surchargee',
    libelle: 'Association top 1 surchargée cette semaine',
  },
  { code: 'client_demande', libelle: 'Demande spécifique client' },
  {
    code: 'transporteur_top1_indispo',
    libelle: 'Transporteur top 1 indisponible',
  },
  {
    code: 'a_toutes_indispo_locale',
    libelle: 'A Toutes! indisponible localement',
  },
  {
    code: 'proximite_acceptable',
    libelle: 'Distance top 2/3 acceptable, choix opérationnel',
  },
  { code: 'autre', libelle: 'Autre — préciser' },
];

const BRANCHE_LABELS: Record<string, string> = {
  ag_marathon_nuit: 'Marathon — Nuit',
  ag_marathon_volume: 'Marathon — Grand volume',
  ag_velo_programme: 'A Toutes! — Vélo programmé (svc 71)',
  ag_velo_express: 'A Toutes! — Vélo express (svc 74)',
  ag_velo_fallback_marathon: 'Marathon — Fallback vélo',
  ag_marathon_volume_backup_camion: 'A Toutes! — Camion backup volume',
  ag_everest_camion_express: 'A Toutes! — Camion express (svc 77)',
  ag_province_proximite: 'Province — Proximité',
  aucun_prestataire: 'Aucun prestataire disponible',
};

// Enum plateforme.type_vehicule (lieux.type_vehicule_max, tournees.type_vehicule,
// collectes.type_vehicule_souhaite).
const TYPES_VEHICULE: { value: string; label: string }[] = [
  { value: 'velo_cargo', label: 'Vélo cargo' },
  { value: 'camionnette', label: 'Camionnette' },
  { value: 'fourgon', label: 'Fourgon' },
  { value: 'vul', label: 'VUL' },
  { value: 'poids_lourd', label: 'Poids lourd' },
];

const NB_VEHICULES_MAX = 20;

function formatDistance(km: number | null | undefined): string {
  return km != null ? `${km.toLocaleString('fr-FR')} km` : 'Distance inconnue';
}

function formatCreneau(
  date: string | null | undefined,
  heure: string | null | undefined,
): string {
  if (!date) return '—';
  const jour = formatJour(date, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  if (!jour) return '—';
  return heure ? `${jour} · ${heure.slice(0, 5)}` : jour;
}

interface AttributionAgFormProps {
  collecteId: string;
  // Fiche collecte : contexte déjà chargé par le GET détail. Écran dédié : absent,
  // le formulaire le charge.
  collecte?: ContexteCollecte | null;
  // Appelé après une validation réussie (fiche : refetch ; écran : redirection).
  onValidee?: () => void;
}

export function AttributionAgForm({
  collecteId,
  collecte,
  onValidee,
}: AttributionAgFormProps) {
  const [algo, setAlgo] = useState<AlgoResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [contexte, setContexte] = useState<ContexteCollecte | null>(
    collecte ?? null,
  );
  // Écran dédié : tant que le contexte n'est pas lu, le besoin véhicule du POST
  // écraserait un N posé par Ops avec la valeur par défaut — il n'est alors pas
  // envoyé (le bouton reste actif : l'attribution part sans ces champs).
  const [contexteEtat, setContexteEtat] = useState<
    'ok' | 'chargement' | 'erreur'
  >(collecte ? 'ok' : 'chargement');
  // Un drapeau PAR CHAMP (nombre, type) : une lecture tardive ne pose que le
  // champ non touché, et seul un champ touché part si le contexte n'a pas pu
  // être lu — jamais la valeur par défaut de l'autre champ.
  const nbToucheRef = useRef(false);
  const typeToucheRef = useRef(false);

  const [selectedAsso, setSelectedAsso] = useState<string | null>(null);
  const [selectedAssoNom, setSelectedAssoNom] = useState<string | null>(null);
  const [assoSource, setAssoSource] = useState<'reco' | 'libre'>('reco');
  const [selectedTransp, setSelectedTransp] = useState<string | null>(null);
  const [selectedTranspNom, setSelectedTranspNom] = useState<string | null>(
    null,
  );
  const [transpSource, setTranspSource] = useState<'reco' | 'libre'>('reco');

  // Besoin véhicule (décision Val 2026-10-01) — initialisé depuis la collecte.
  const [typeVehicule, setTypeVehicule] = useState<string>(
    collecte?.type_vehicule_souhaite ?? '',
  );
  const [nbVehicules, setNbVehicules] = useState<string>(
    String(collecte?.nb_camions_demande ?? 1),
  );

  const [motif, setMotif] = useState('');
  const [motifLibre, setMotifLibre] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Succès = toast (R-UI-1 H1) ; l'état ne sert qu'à bloquer un second POST.
  const [validee, setValidee] = useState(false);
  const { toast } = useToast();

  // Liste déroulante association (BL-P1-ALGO-03) : toutes les associations
  // actives, triées par distance croissante au lieu de la collecte.
  const [associations, setAssociations] = useState<AssoRef[]>([]);
  const [assoErreur, setAssoErreur] = useState(false);
  // Liste déroulante transporteur (BL-P1-ALGO-04) : tous les transporteurs actifs.
  const [transporteurs, setTransporteurs] = useState<TranspRef[]>([]);
  const [transpErreur, setTranspErreur] = useState(false);

  const loadAlgo = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/v1/admin/attributions-ag/${encodeURIComponent(collecteId)}/recommandation`,
      );
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(
          json?.error ?? `Erreur chargement recommandation (${res.status})`,
        );
      }
      const json = (await res.json()) as { data: AlgoResult };
      setAlgo(json.data);
      // Pré-sélectionner le top 1 (asso + transporteur recommandés).
      const assoInitiale = json.data.associations[0];
      if (assoInitiale) {
        setSelectedAsso(assoInitiale.id);
        setSelectedAssoNom(assoInitiale.nom);
        setAssoSource('reco');
      }
      if (json.data.transporteur) {
        setSelectedTransp(json.data.transporteur.id);
        setSelectedTranspNom(json.data.transporteur.nom);
        setTranspSource('reco');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, [collecteId]);

  useEffect(() => {
    void loadAlgo();
  }, [loadAlgo]);

  // Contexte collecte non fourni (écran dédié) : lu depuis le GET détail.
  const chargerContexte = useCallback(async () => {
    setContexteEtat('chargement');
    try {
      const res = await fetch(
        `/api/v1/admin/collectes/${encodeURIComponent(collecteId)}`,
      );
      if (!res.ok) throw new Error('chargement collecte');
      const c = (await res.json()) as unknown;
      if (!c || typeof c !== 'object' || Array.isArray(c)) {
        throw new Error('collecte illisible');
      }
      const row = c as {
        volume_estime_repas?: number | null;
        date_collecte?: string | null;
        heure_collecte?: string | null;
        nb_camions_demande?: number;
        type_vehicule_souhaite?: string | null;
        evenements?: { pax?: number | null } | null;
      };
      if (typeof row.nb_camions_demande !== 'number') {
        throw new Error('collecte illisible');
      }
      setContexte({
        volume_estime_repas: row.volume_estime_repas ?? null,
        pax: row.evenements?.pax ?? null,
        date_collecte: row.date_collecte ?? null,
        heure_collecte: row.heure_collecte ?? null,
        nb_camions_demande: row.nb_camions_demande,
        type_vehicule_souhaite: row.type_vehicule_souhaite ?? null,
      });
      if (!nbToucheRef.current) {
        setNbVehicules(String(row.nb_camions_demande));
      }
      if (!typeToucheRef.current) {
        setTypeVehicule(row.type_vehicule_souhaite ?? '');
      }
      setContexteEtat('ok');
    } catch {
      setContexteEtat('erreur');
    }
  }, [collecteId]);

  useEffect(() => {
    if (collecte) return;
    void chargerContexte();
  }, [collecte, chargerContexte]);

  // Erreur dédiée (pas `error`, remis à null par loadAlgo) : la liste est le seul
  // moyen de choisir un transporteur quand l'algo n'en recommande aucun.
  const chargerTransporteurs = useCallback(async () => {
    setTranspErreur(false);
    try {
      const res = await fetch('/api/v1/admin/transporteurs?actif=true');
      if (!res.ok) throw new Error('chargement transporteurs');
      const json = (await res.json()) as { data?: TranspRef[] };
      setTransporteurs(Array.isArray(json.data) ? json.data : []);
    } catch {
      setTranspErreur(true);
    }
  }, []);

  useEffect(() => {
    void chargerTransporteurs();
  }, [chargerTransporteurs]);

  const chargerAssociations = useCallback(async () => {
    setAssoErreur(false);
    try {
      const res = await fetch(
        `/api/v1/admin/attributions-ag/${encodeURIComponent(collecteId)}/associations`,
      );
      if (!res.ok) throw new Error('chargement associations');
      const json = (await res.json()) as { data?: AssoRef[] };
      setAssociations(Array.isArray(json.data) ? json.data : []);
    } catch {
      setAssoErreur(true);
    }
  }, [collecteId]);

  useEffect(() => {
    void chargerAssociations();
  }, [chargerAssociations]);

  // Override = choix asso hors top 1 OU transporteur hors recommandation OU
  // recherche libre transporteur (impasse aucun_prestataire). Motif alors obligatoire.
  const assoIsTop1 =
    !!algo &&
    algo.associations.length > 0 &&
    selectedAsso === algo.associations[0]?.id;
  const transpIsReco =
    !!algo && !!algo.transporteur && selectedTransp === algo.transporteur.id;
  const isOverride =
    !!algo &&
    (((algo.associations.length > 0 && !assoIsTop1) ||
      (!!algo.transporteur && !transpIsReco) ||
      transpSource === 'libre') as boolean);
  const aucuneReco = !!algo && algo.no_asso && assoSource === 'libre';
  const motifOk =
    !isOverride ||
    (motif !== '' && (motif !== 'autre' || motifLibre.length >= 10));

  const suggestions = algo?.associations ?? [];
  // Options = associations actives triées par distance + suggestions absentes de
  // la liste chargée (échec / en cours) : la liste (Combobox) montre toujours la
  // sélection — son libellé est résolu parmi ces options.
  const optionsAsso: AssoRef[] = [
    ...associations,
    ...suggestions
      .filter((s) => !associations.some((a) => a.id === s.id))
      .map((s) => ({
        id: s.id,
        nom: s.nom,
        ville: null,
        capacite_max_beneficiaires: s.capacite_max_beneficiaires,
        habilitee_attestation_fiscale: null,
        distance_km: s.distance_km,
      })),
  ];

  const choisirAssociation = (id: string) => {
    const a = optionsAsso.find((x) => x.id === id);
    setSelectedAsso(a ? id : null);
    setSelectedAssoNom(a?.nom ?? null);
    // Suggestion de l'algo (ou aucun choix) = 'reco' ; hors suggestions = 'libre'
    // (audit attribution_manuelle_aucune_reco si l'algo n'en proposait aucune).
    setAssoSource(
      !a || suggestions.some((x) => x.id === id) ? 'reco' : 'libre',
    );
  };

  // Liste transporteurs recommandés : top 3 (province) ou unique (IDF). La carte
  // montre le premier ; les autres restent marqués « (recommandé) » dans la liste.
  const transpList = algo?.transporteurs ?? [];
  const transpReco = algo?.transporteur ?? transpList[0] ?? null;

  // Options = transporteurs actifs + recommandés absents de la liste chargée
  // (chargement en échec / en cours, au-delà de la 1re page) : la liste (Combobox)
  // affiche toujours le transporteur réellement sélectionné.
  const optionsTransp: TranspRef[] = [
    ...transporteurs,
    ...transpList
      .filter((r) => !transporteurs.some((t) => t.id === r.id))
      .map((r) => ({ id: r.id, nom: r.nom, type_tms: r.type_tms, ville: '' })),
  ];

  const choisirTransporteur = (id: string) => {
    const t = optionsTransp.find((x) => x.id === id);
    setSelectedTransp(t ? id : null);
    setSelectedTranspNom(t?.nom ?? null);
    // Recommandé (ou aucun choix) = pas de motif ; tout autre transporteur = override.
    setTranspSource(
      !t || transpList.some((x) => x.id === id) ? 'reco' : 'libre',
    );
  };

  const selectedTranspTypeTms =
    optionsTransp.find((t) => t.id === selectedTransp)?.type_tms ?? null;

  const nbVehiculesNum = Number(nbVehicules);
  const nbVehiculesOk =
    Number.isInteger(nbVehiculesNum) &&
    nbVehiculesNum >= 1 &&
    nbVehiculesNum <= NB_VEHICULES_MAX;
  const changerNbVehicules = (delta: number) => {
    const base = Number.isInteger(nbVehiculesNum) ? nbVehiculesNum : 1;
    nbToucheRef.current = true;
    setNbVehicules(
      String(Math.min(NB_VEHICULES_MAX, Math.max(1, base + delta))),
    );
  };
  const contexteCharge = contexteEtat === 'ok';

  const handleValider = async () => {
    if (!selectedAsso || !selectedTransp || !algo) return;
    if (isOverride && !motifOk) {
      setError('Motif override obligatoire (min 10 car. si « Autre »)');
      return;
    }
    if (!nbVehiculesOk) {
      setError(
        `Nombre de véhicules invalide (entier entre 1 et ${NB_VEHICULES_MAX})`,
      );
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/v1/admin/attributions-ag/${encodeURIComponent(collecteId)}/valider`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            association_id: selectedAsso,
            transporteur_id: selectedTransp,
            branche_attribution: algo.branche,
            mode_validation: isOverride ? 'manuel_override' : 'manuel_top1',
            motif_override: isOverride ? motif : undefined,
            motif_override_libre:
              isOverride && motif === 'autre' ? motifLibre : undefined,
            aucune_reco: aucuneReco,
            // Besoin véhicule : écrit avant l'event de dispatch, donc transmis.
            // Jamais le défaut à l'aveugle, champ par champ : un champ part si
            // le contexte de la collecte a été lu, ou si l'Admin l'a saisi lui-
            // même (sinon fn_modifier_collecte écraserait un N posé par Ops, ou
            // un type saisi seul enverrait nb=1 par défaut).
            ...(contexteCharge || nbToucheRef.current
              ? { nb_camions_demande: nbVehiculesNum }
              : {}),
            ...(contexteCharge || typeToucheRef.current
              ? { type_vehicule_souhaite: typeVehicule || null }
              : {}),
          }),
        },
      );
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(json?.error ?? `Erreur validation (${res.status})`);
      }
      const envoiAuto = envoiAutomatique(selectedTranspTypeTms);
      setValidee(true);
      toast({
        title: 'Attribution validée.',
        description: envoiAuto
          ? "L'ordre part au prestataire, les emails sont en cours d'envoi."
          : "Dispatch manuel à réaliser auprès du prestataire ; les emails sont en cours d'envoi.",
        variant: 'success',
      });
      onValidee?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue');
    } finally {
      setSubmitting(false);
    }
  };

  const assoTop1 = suggestions[0] ?? null;
  const assoTop1Selectionnee = !!assoTop1 && selectedAsso === assoTop1.id;
  const transpRecoSelectionne =
    !!transpReco && selectedTransp === transpReco.id;

  const volumeLabel = (() => {
    const pax = contexte?.pax ?? algo?.nb_pax ?? null;
    const repas = contexte?.volume_estime_repas ?? null;
    const parts: string[] = [];
    if (pax != null) parts.push(fmtPax(pax));
    if (repas != null) parts.push(`≈ ${fmtInt(repas)} repas`);
    return parts.length > 0 ? parts.join(' · ') : '—';
  })();

  const carteClasses = (active: boolean) =>
    cn(
      'flex w-full items-start gap-3 rounded-savr-md border-2 p-4 text-left transition-colors',
      active
        ? 'border-savr-primary-700 bg-savr-primary-50'
        : 'border-savr-neutral-200 bg-savr-white hover:border-savr-neutral-300',
    );

  if (loading) {
    return (
      <LoadingState
        variant="bloc"
        lignes={2}
        className="space-y-3 [&>div]:h-24"
      />
    );
  }

  return (
    <div className="space-y-5">
      {error && <AlertBar variant="err">{error}</AlertBar>}

      {algo && (
        <>
          <div className="grid gap-x-8 gap-y-4 lg:grid-cols-2">
            {/* Ligne 1 : titres */}
            <div className="flex h-7 items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-savr-full bg-savr-primary-700 text-xs font-extrabold text-savr-white">
                1
              </span>
              <Text tone="ink" className="font-bold">
                Association bénéficiaire
              </Text>
              <Text as="span" variant="hint">
                · son adresse est le point de livraison
              </Text>
            </div>
            <div className="flex h-7 items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-savr-full bg-savr-primary-700 text-xs font-extrabold text-savr-white">
                2
              </span>
              <Text tone="ink" className="font-bold">
                Prestataire logistique
              </Text>
              <Text as="span" variant="hint">
                · reçoit l&apos;adresse de l&apos;association
              </Text>
            </div>

            {/* Ligne 2 : champs — gauche = critères de l'algo (lecture seule),
                droite = besoin véhicule */}
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Volume estimé" htmlFor="attribution-volume">
                <Input id="attribution-volume" value={volumeLabel} readOnly />
              </FormField>
              <FormField
                label="Créneau de livraison"
                htmlFor="attribution-creneau"
              >
                <Input
                  id="attribution-creneau"
                  value={formatCreneau(
                    contexte?.date_collecte,
                    contexte?.heure_collecte,
                  )}
                  readOnly
                />
              </FormField>
              {contexteEtat === 'erreur' && (
                <ErrorState
                  className="col-span-2"
                  message="Impossible de lire la collecte : le besoin véhicule ne sera envoyé que si vous le modifiez ici."
                  onRetry={() => void chargerContexte()}
                  retryLabel="Recharger la collecte"
                />
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField
                label="Type de véhicule souhaité"
                htmlFor="type-vehicule-select"
              >
                <Combobox
                  id="type-vehicule-select"
                  icon={null}
                  searchable={false}
                  placeholder="Non précisé"
                  options={[
                    { value: '', label: 'Non précisé' },
                    ...TYPES_VEHICULE,
                  ]}
                  value={typeVehicule}
                  onChange={(v) => {
                    typeToucheRef.current = true;
                    setTypeVehicule(v);
                  }}
                />
              </FormField>
              <FormField label="Nombre de véhicules" htmlFor="nb-vehicules">
                <div className="flex h-10 items-center overflow-hidden rounded-savr-md border border-savr-neutral-300 bg-savr-white">
                  <button
                    type="button"
                    aria-label="Retirer un véhicule"
                    disabled={nbVehiculesOk && nbVehiculesNum <= 1}
                    className="flex h-full w-11 items-center justify-center border-r border-savr-neutral-200 bg-savr-neutral-50 text-savr-neutral-700 hover:bg-savr-neutral-100"
                    onClick={() => changerNbVehicules(-1)}
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <input
                    id="nb-vehicules"
                    type="text"
                    inputMode="numeric"
                    value={nbVehicules}
                    onChange={(e) => {
                      nbToucheRef.current = true;
                      setNbVehicules(e.target.value);
                    }}
                    aria-invalid={!nbVehiculesOk}
                    aria-describedby="nb-vehicules-aide"
                    className="h-full min-w-0 flex-1 border-0 bg-transparent text-center text-base font-bold text-savr-neutral-900 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-savr-primary-500"
                  />
                  <button
                    type="button"
                    aria-label="Ajouter un véhicule"
                    disabled={
                      nbVehiculesOk && nbVehiculesNum >= NB_VEHICULES_MAX
                    }
                    className="flex h-full w-11 items-center justify-center border-l border-savr-neutral-200 bg-savr-neutral-50 text-savr-neutral-700 hover:bg-savr-neutral-100"
                    onClick={() => changerNbVehicules(1)}
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                <p
                  id="nb-vehicules-aide"
                  className={cn(
                    'mt-1 text-xs',
                    nbVehiculesOk
                      ? 'text-savr-neutral-500'
                      : 'text-savr-error-strong',
                  )}
                >
                  {nbVehiculesOk
                    ? `Entier entre 1 et ${NB_VEHICULES_MAX} : 1 commande par véhicule chez le prestataire.`
                    : `Nombre invalide : entier entre 1 et ${NB_VEHICULES_MAX}.`}
                </p>
              </FormField>
            </div>

            {/* Ligne 3 : recommandations (même structure, même hauteur) */}
            <div>
              {assoTop1 ? (
                <button
                  type="button"
                  aria-pressed={assoTop1Selectionnee}
                  className={carteClasses(assoTop1Selectionnee)}
                  onClick={() => {
                    setSelectedAsso(assoTop1.id);
                    setSelectedAssoNom(assoTop1.nom);
                    setAssoSource('reco');
                  }}
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-bold text-savr-neutral-900">
                        {assoTop1.nom}
                      </span>
                      <Badge variant="success">Recommandée</Badge>
                    </span>
                    <Text as="span" variant="hint" tone="soft">
                      <span>{formatDistance(assoTop1.distance_km)}</span> ·
                      capacité {assoTop1.capacite_max_beneficiaires}{' '}
                      bénéficiaires
                    </Text>
                    <Text as="span" variant="hint" tone="soft">
                      {assoTop1.contact_email}
                    </Text>
                  </span>
                </button>
              ) : (
                <AlertBar variant="warn">
                  Aucune association disponible pour ce créneau. Traitement
                  manuel requis.
                </AlertBar>
              )}
            </div>
            <div>
              {transpReco ? (
                <button
                  type="button"
                  aria-pressed={transpRecoSelectionne}
                  className={carteClasses(transpRecoSelectionne)}
                  onClick={() => {
                    setSelectedTransp(transpReco.id);
                    setSelectedTranspNom(transpReco.nom);
                    setTranspSource('reco');
                  }}
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-bold text-savr-neutral-900">
                        {transpReco.nom}
                      </span>
                      <Badge variant="success">Recommandé</Badge>
                    </span>
                    <Text as="span" variant="hint" tone="soft">
                      Branche : {BRANCHE_LABELS[algo.branche] ?? algo.branche} ·
                      Zone : {algo.is_idf ? 'IDF' : 'Province'} · {algo.nb_pax}{' '}
                      PAX
                      {transpReco.distance_km != null
                        ? ` · ${transpReco.distance_km} km`
                        : ''}
                    </Text>
                    <Text as="span" variant="hint" tone="soft">
                      {libelleTypeTms(transpReco.type_tms)}
                    </Text>
                  </span>
                </button>
              ) : (
                <AlertBar variant="warn">
                  Aucun prestataire éligible — traitement manuel. Sélectionnez
                  un transporteur dans la liste ci-dessous.
                </AlertBar>
              )}
            </div>

            {/* Ligne 4 : listes déroulantes */}
            <FormField label="Association" htmlFor="association-select">
              {/* Option « vide » en tête : permet de revenir à « aucun choix ». */}
              <Combobox
                id="association-select"
                icon={<Search className="h-4 w-4" />}
                placeholder="Choisir une association…"
                searchPlaceholder="Rechercher une association…"
                options={[
                  { value: '', label: 'Choisir une association…' },
                  ...optionsAsso.map((a) => ({
                    value: a.id,
                    // Libellé = distance · capacité · nom (décision Val
                    // 2026-09-29) : la distance est le critère de tri de la liste.
                    label:
                      formatDistance(a.distance_km) +
                      (a.capacite_max_beneficiaires != null
                        ? ` · cap. ${a.capacite_max_beneficiaires}`
                        : '') +
                      ` · ${a.nom}`,
                  })),
                ]}
                value={selectedAsso ?? ''}
                onChange={choisirAssociation}
              />
              {assoErreur && (
                <ErrorState
                  className="mt-2"
                  message="Impossible de charger la liste des associations."
                  onRetry={() => void chargerAssociations()}
                />
              )}
            </FormField>
            <FormField label="Transporteur" htmlFor="transporteur-select">
              <Combobox
                id="transporteur-select"
                icon={<Search className="h-4 w-4" />}
                placeholder="Choisir un transporteur…"
                searchPlaceholder="Rechercher un prestataire…"
                options={[
                  { value: '', label: 'Choisir un transporteur…' },
                  ...optionsTransp.map((t) => ({
                    value: t.id,
                    label:
                      t.nom +
                      (t.ville ? ` · ${t.ville}` : '') +
                      (transpList.some((x) => x.id === t.id)
                        ? ' (recommandé)'
                        : ''),
                  })),
                ]}
                value={selectedTransp ?? ''}
                onChange={choisirTransporteur}
              />
              {transpErreur && (
                <ErrorState
                  className="mt-2"
                  message="Impossible de charger la liste des transporteurs."
                  onRetry={() => void chargerTransporteurs()}
                />
              )}
            </FormField>

            {/* Ligne 5 : aides */}
            <Text variant="hint">
              Toutes les associations actives, triées par distance au lieu.
            </Text>
            <Text variant="hint">
              Tous les transporteurs actifs. Hors recommandation, un motif est
              demandé.
            </Text>
          </div>

          {/* Motif override (obligatoire si override / recherche libre transporteur) */}
          {isOverride && (
            <div className="space-y-2 rounded-savr-md border border-savr-warning/40 bg-savr-warning-subtle p-3">
              <p className="text-xs font-semibold text-savr-warning-strong">
                Choix hors recommandation — motif obligatoire
              </p>
              <div className="grid gap-4 lg:grid-cols-2">
                <FormField label="Motif" htmlFor="motif-override-select">
                  <Combobox
                    id="motif-override-select"
                    icon={null}
                    placeholder="Choisir un motif…"
                    options={[
                      { value: '', label: 'Choisir un motif…' },
                      ...MOTIFS_OVERRIDE.map((m) => ({
                        value: m.code,
                        label: m.libelle,
                      })),
                    ]}
                    value={motif}
                    onChange={setMotif}
                  />
                </FormField>
                {motif === 'autre' && (
                  <FormField label="Précision" htmlFor="motif-override-libre">
                    <Textarea
                      id="motif-override-libre"
                      placeholder="Min 10 caractères"
                      rows={2}
                      value={motifLibre}
                      onChange={(e) => setMotifLibre(e.target.value)}
                    />
                  </FormField>
                )}
              </div>
            </div>
          )}

          {/* Pied : synthèse + action unique */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-savr-neutral-100 pt-4">
            <Text variant="body">
              Sélection : <strong>{selectedAssoNom ?? '—'}</strong> +{' '}
              <strong>{selectedTranspNom ?? '—'}</strong>
              {nbVehiculesOk && (
                <>
                  {' '}
                  · {nbVehiculesNum} ×{' '}
                  {TYPES_VEHICULE.find((t) => t.value === typeVehicule)
                    ?.label ?? 'véhicule (type non précisé)'}
                </>
              )}
              {aucuneReco && (
                <span className="ml-1 text-savr-warning-strong">
                  (association hors recommandation — auditée)
                </span>
              )}
            </Text>
            <Button
              disabled={
                !selectedAsso ||
                !selectedTransp ||
                !motifOk ||
                !nbVehiculesOk ||
                // Déjà validée : pas de second POST.
                validee
              }
              onClick={() => void handleValider()}
              loading={submitting}
              loadingText="Validation en cours…"
            >
              {libelleValiderEtEnvoyer(selectedTranspTypeTms)}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
