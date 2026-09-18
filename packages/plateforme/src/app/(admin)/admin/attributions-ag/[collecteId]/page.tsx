'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Leaf,
  AlertTriangle,
  CheckCircle2,
  MapPin,
  Users,
  Truck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

interface AssociationSuggestion {
  id: string;
  nom: string;
  distance_km: number;
  capacite_max_beneficiaires: number;
  contact_email: string;
}

interface TransporteurSuggestion {
  id: string;
  nom: string;
  type_tms: string;
  distance_km?: number;
}

interface AlgoResult {
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
  habilitee_attestation_fiscale: boolean;
  distance_km: number | null;
}

interface TranspRef {
  id: string;
  nom: string;
  type_tms: string;
  ville: string;
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

export default function AttributionDetailPage() {
  const { collecteId } = useParams<{ collecteId: string }>();
  const router = useRouter();

  const [algo, setAlgo] = useState<AlgoResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedAsso, setSelectedAsso] = useState<string | null>(null);
  const [selectedAssoNom, setSelectedAssoNom] = useState<string | null>(null);
  const [assoSource, setAssoSource] = useState<'reco' | 'libre'>('reco');
  const [selectedTransp, setSelectedTransp] = useState<string | null>(null);
  const [selectedTranspNom, setSelectedTranspNom] = useState<string | null>(
    null,
  );
  const [transpSource, setTranspSource] = useState<'reco' | 'libre'>('reco');

  const [motif, setMotif] = useState('');
  const [motifLibre, setMotifLibre] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

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
        const json = (await res.json()) as { error?: string };
        throw new Error(json.error ?? 'Erreur chargement recommandation');
      }
      const json = (await res.json()) as { data: AlgoResult };
      setAlgo(json.data);
      // Pré-sélectionner top 1 (asso + transporteur recommandés)
      if (json.data.associations.length > 0) {
        setSelectedAsso(json.data.associations[0]?.id ?? null);
        setSelectedAssoNom(json.data.associations[0]?.nom ?? null);
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

  // Erreur dédiée (pas `error`, remis à null par loadAlgo) : la liste est le seul
  // moyen de choisir un transporteur quand l'algo n'en recommande aucun.
  const chargerTransporteurs = useCallback(async () => {
    setTranspErreur(false);
    try {
      const res = await fetch('/api/v1/admin/transporteurs?actif=true');
      if (!res.ok) throw new Error('chargement transporteurs');
      const json = (await res.json()) as { data: TranspRef[] };
      setTransporteurs(json.data);
    } catch {
      setTranspErreur(true);
    }
  }, []);

  useEffect(() => {
    void chargerTransporteurs();
  }, [chargerTransporteurs]);

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

  const chargerAssociations = useCallback(async () => {
    setAssoErreur(false);
    try {
      const res = await fetch(
        `/api/v1/admin/attributions-ag/${encodeURIComponent(collecteId)}/associations`,
      );
      if (!res.ok) throw new Error('chargement associations');
      const json = (await res.json()) as { data: AssoRef[] };
      setAssociations(json.data);
    } catch {
      setAssoErreur(true);
    }
  }, [collecteId]);

  useEffect(() => {
    void chargerAssociations();
  }, [chargerAssociations]);

  const suggestions = algo?.associations ?? [];
  // Options = associations actives triées par distance + suggestions absentes de
  // la liste chargée (échec / en cours) : le <select> montre toujours la sélection.
  const optionsAsso: AssoRef[] = [
    ...associations,
    ...suggestions
      .filter((s) => !associations.some((a) => a.id === s.id))
      .map((s) => ({
        id: s.id,
        nom: s.nom,
        ville: null,
        capacite_max_beneficiaires: s.capacite_max_beneficiaires,
        habilitee_attestation_fiscale: false,
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

  const handleValider = async () => {
    if (!selectedAsso || !selectedTransp || !algo) return;
    if (isOverride && !motifOk) {
      setError('Motif override obligatoire (min 10 car. si « Autre »)');
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
          }),
        },
      );
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        throw new Error(json.error ?? 'Erreur validation');
      }
      setSuccessMsg("Attribution validée. Les emails sont en cours d'envoi.");
      // La file d'attribution vit dans Collectes (chip « AG en attente attribution »,
      // §06.09 §1) : il n'existe pas de page /admin/attributions-ag.
      setTimeout(
        () => router.push('/admin/collectes?chip=ag_attente_attribution'),
        2000,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue');
    } finally {
      setSubmitting(false);
    }
  };

  // Liste transporteurs à présenter : top 3 (province) ou unique (IDF).
  const transpList = algo?.transporteurs ?? [];
  const showTranspList = transpList.length > 1; // province → choix multiple

  // Options = transporteurs actifs + recommandés absents de la liste chargée
  // (chargement en échec / en cours, au-delà de la 1re page) : le <select> affiche
  // toujours le transporteur réellement sélectionné.
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

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-2">
          <Leaf className="h-5 w-5 text-green-600" />
          <h1 className="text-xl font-semibold text-savr-neutral-900">
            Attribution AG
          </h1>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {successMsg && (
        <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {successMsg}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : algo ? (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Colonne gauche : associations */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-savr-neutral-700">
              <Users className="h-4 w-4" />
              Associations suggérées ({algo.assoc_count})
            </div>

            {algo.associations.map((asso, idx) => (
              <Card
                key={asso.id}
                className={`cursor-pointer border-2 p-4 transition-colors ${
                  selectedAsso === asso.id
                    ? 'border-savr-primary-500 bg-savr-primary-50'
                    : 'border-savr-neutral-200 hover:border-savr-neutral-300'
                }`}
                onClick={() => {
                  setSelectedAsso(asso.id);
                  setSelectedAssoNom(asso.nom);
                  setAssoSource('reco');
                }}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium text-savr-neutral-900">
                      {asso.nom}
                    </p>
                    <p className="text-xs text-savr-neutral-500">
                      {asso.contact_email}
                    </p>
                  </div>
                  <div className="text-right">
                    {idx === 0 && <Badge variant="success">Top 1</Badge>}
                    <p className="mt-1 text-xs text-savr-neutral-500">
                      <MapPin className="mr-0.5 inline h-3 w-3" />
                      {asso.distance_km} km
                    </p>
                    <p className="text-xs text-savr-neutral-500">
                      Cap. {asso.capacite_max_beneficiaires} bénéficiaires
                    </p>
                  </div>
                </div>
              </Card>
            ))}

            {/* BL-P1-ALGO-03 — Aucune suggestion : choix manuel dans la liste déroulante */}
            {algo.no_asso && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
                Aucune association disponible pour ce créneau. Traitement manuel
                requis.
              </div>
            )}
            <div>
              <Label htmlFor="association-select">Association</Label>
              <Select
                id="association-select"
                value={selectedAsso ?? ''}
                onChange={(e) => choisirAssociation(e.target.value)}
              >
                <option value="">Choisir une association…</option>
                {optionsAsso.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nom}
                    {a.ville ? ` · ${a.ville}` : ''}
                    {a.distance_km != null
                      ? ` · ${a.distance_km.toLocaleString('fr-FR')} km`
                      : ' · distance inconnue'}
                    {a.capacite_max_beneficiaires != null
                      ? ` · cap. ${a.capacite_max_beneficiaires}`
                      : ''}
                    {a.habilitee_attestation_fiscale ? ' · 2041-GE' : ''}
                    {suggestions.some((x) => x.id === a.id)
                      ? ' (suggérée)'
                      : ''}
                  </option>
                ))}
              </Select>
              {assoErreur && (
                <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  <span>Impossible de charger la liste des associations.</span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void chargerAssociations()}
                  >
                    Réessayer
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Colonne droite : transporteur + validation */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium text-savr-neutral-700">
              <Truck className="h-4 w-4" />
              Transporteur{' '}
              {showTranspList ? 'recommandé (top 3)' : 'recommandé'}
            </div>

            {algo.no_prestataire && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
                Aucun prestataire éligible — traitement manuel. Sélectionnez un
                transporteur dans la liste ci-dessous.
              </div>
            )}

            {/* Province : top 3 sélectionnable ; IDF : transporteur unique (bandeau branche) */}
            {transpList.map((t) => (
              <Card
                key={t.id}
                className={`cursor-pointer border-2 p-4 transition-colors ${
                  selectedTransp === t.id
                    ? 'border-savr-primary-500 bg-savr-primary-50'
                    : 'border-savr-neutral-200 hover:border-savr-neutral-300'
                }`}
                onClick={() => {
                  setSelectedTransp(t.id);
                  setSelectedTranspNom(t.nom);
                  setTranspSource('reco');
                }}
              >
                <p className="font-medium text-savr-neutral-900">{t.nom}</p>
                <p className="mt-1 text-xs text-savr-neutral-500">
                  Branche :{' '}
                  <span className="font-medium">
                    {BRANCHE_LABELS[algo.branche] ?? algo.branche}
                  </span>
                </p>
                <p className="text-xs text-savr-neutral-500">
                  Zone : {algo.is_idf ? 'IDF' : 'Province'} · {algo.nb_pax} PAX
                  {t.distance_km != null ? ` · ${t.distance_km} km` : ''}
                </p>
              </Card>
            ))}

            {/* BL-P1-ALGO-04 — Choix du transporteur parmi tous les transporteurs actifs */}
            <div>
              <Label htmlFor="transporteur-select">Transporteur</Label>
              <Select
                id="transporteur-select"
                value={selectedTransp ?? ''}
                onChange={(e) => choisirTransporteur(e.target.value)}
              >
                <option value="">Choisir un transporteur…</option>
                {optionsTransp.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nom}
                    {t.ville ? ` · ${t.ville}` : ''}
                    {transpList.some((x) => x.id === t.id)
                      ? ' (recommandé)'
                      : ''}
                  </option>
                ))}
              </Select>
              {transpErreur && (
                <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  <span>Impossible de charger la liste des transporteurs.</span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void chargerTransporteurs()}
                  >
                    Réessayer
                  </Button>
                </div>
              )}
            </div>

            {/* Récapitulatif sélection */}
            <div className="rounded-md border border-savr-neutral-200 bg-savr-neutral-50 p-3 text-xs text-savr-neutral-600">
              Sélection : <strong>{selectedAssoNom ?? '—'}</strong> +{' '}
              <strong>{selectedTranspNom ?? '—'}</strong>
              {aucuneReco && (
                <span className="ml-1 text-amber-700">
                  (association hors recommandation — audité)
                </span>
              )}
            </div>

            {/* Motif override (obligatoire si override / recherche libre transporteur) */}
            {isOverride && (
              <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-medium text-amber-800">
                  Choix hors recommandation — motif obligatoire
                </p>
                <select
                  className="w-full rounded border border-savr-neutral-200 px-2 py-1 text-sm"
                  value={motif}
                  onChange={(e) => setMotif(e.target.value)}
                >
                  <option value="">Choisir un motif…</option>
                  {MOTIFS_OVERRIDE.map((m) => (
                    <option key={m.code} value={m.code}>
                      {m.libelle}
                    </option>
                  ))}
                </select>
                {motif === 'autre' && (
                  <textarea
                    className="w-full rounded border border-savr-neutral-200 px-2 py-1 text-sm"
                    placeholder="Précision libre (min 10 caractères)…"
                    rows={2}
                    value={motifLibre}
                    onChange={(e) => setMotifLibre(e.target.value)}
                  />
                )}
              </div>
            )}

            <Button
              className="w-full"
              disabled={
                !selectedAsso || !selectedTransp || submitting || !motifOk
              }
              onClick={handleValider}
            >
              {submitting ? 'Validation en cours…' : "Valider l'attribution"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
