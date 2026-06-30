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
  Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

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
  ville: string;
  capacite_max_beneficiaires: number | null;
  habilitee_attestation_fiscale: boolean;
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

  // Recherche libre association (BL-P1-ALGO-03)
  const [assoQuery, setAssoQuery] = useState('');
  const [assoCapMin, setAssoCapMin] = useState('');
  const [assoHabilitee, setAssoHabilitee] = useState(false);
  const [assoResults, setAssoResults] = useState<AssoRef[]>([]);
  // Recherche libre transporteur (BL-P1-ALGO-04)
  const [transpQuery, setTranspQuery] = useState('');
  const [transpResults, setTranspResults] = useState<TranspRef[]>([]);

  const loadAlgo = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/v1/admin/attributions-ag/${collecteId}/recommandation`,
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

  const searchAssos = async () => {
    const p = new URLSearchParams({ actif: 'true' });
    if (assoQuery) p.set('q', assoQuery);
    if (assoCapMin) p.set('capacite_min', assoCapMin);
    if (assoHabilitee) p.set('habilitee', 'true');
    const res = await fetch(`/api/v1/admin/associations?${p.toString()}`);
    if (res.ok) {
      const json = (await res.json()) as { data: AssoRef[] };
      setAssoResults(json.data);
    }
  };

  const searchTransps = async () => {
    const p = new URLSearchParams({ actif: 'true' });
    if (transpQuery) p.set('q', transpQuery);
    const res = await fetch(`/api/v1/admin/transporteurs?${p.toString()}`);
    if (res.ok) {
      const json = (await res.json()) as { data: TranspRef[] };
      setTranspResults(json.data);
    }
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
        `/api/v1/admin/attributions-ag/${collecteId}/valider`,
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
      setTimeout(() => router.push('/admin/attributions-ag'), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue');
    } finally {
      setSubmitting(false);
    }
  };

  // Liste transporteurs à présenter : top 3 (province) ou unique (IDF).
  const transpList = algo?.transporteurs ?? [];
  const showTranspList = transpList.length > 1; // province → choix multiple

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
                    ? 'border-primary-500 bg-primary-50'
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

            {/* BL-P1-ALGO-03 — Recherche libre association (aucune reco ou choix alternatif) */}
            {algo.no_asso && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
                Aucune association disponible pour ce créneau. Traitement manuel
                requis.
              </div>
            )}
            <details className="rounded-md border border-savr-neutral-200 p-3">
              <summary className="cursor-pointer text-sm font-medium text-savr-neutral-700">
                <Search className="mr-1 inline h-3.5 w-3.5" />
                Choisir une autre association (recherche libre)
              </summary>
              <div className="mt-3 space-y-2">
                <div className="flex flex-wrap gap-2">
                  <input
                    className="flex-1 rounded border border-savr-neutral-200 px-2 py-1 text-sm"
                    placeholder="Ville ou nom…"
                    value={assoQuery}
                    onChange={(e) => setAssoQuery(e.target.value)}
                  />
                  <input
                    className="w-28 rounded border border-savr-neutral-200 px-2 py-1 text-sm"
                    placeholder="Capacité min"
                    type="number"
                    value={assoCapMin}
                    onChange={(e) => setAssoCapMin(e.target.value)}
                  />
                  <label className="flex items-center gap-1 text-xs text-savr-neutral-600">
                    <input
                      type="checkbox"
                      checked={assoHabilitee}
                      onChange={(e) => setAssoHabilitee(e.target.checked)}
                    />
                    Habilitée 2041-GE
                  </label>
                  <Button size="sm" variant="secondary" onClick={searchAssos}>
                    Rechercher
                  </Button>
                </div>
                {assoResults.map((a) => (
                  <button
                    key={a.id}
                    className={`flex w-full items-center justify-between rounded border px-2 py-1 text-left text-sm ${
                      selectedAsso === a.id
                        ? 'border-primary-500 bg-primary-50'
                        : 'border-savr-neutral-200'
                    }`}
                    onClick={() => {
                      setSelectedAsso(a.id);
                      setSelectedAssoNom(a.nom);
                      setAssoSource('libre');
                    }}
                  >
                    <span>
                      {a.nom}{' '}
                      <span className="text-xs text-savr-neutral-500">
                        · {a.ville}
                      </span>
                    </span>
                    {a.habilitee_attestation_fiscale && (
                      <Badge variant="neutral" dot={false}>
                        2041-GE
                      </Badge>
                    )}
                  </button>
                ))}
              </div>
            </details>
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
                transporteur via la recherche libre ci-dessous.
              </div>
            )}

            {/* Province : top 3 sélectionnable ; IDF : transporteur unique (bandeau branche) */}
            {transpList.map((t) => (
              <Card
                key={t.id}
                className={`cursor-pointer border-2 p-4 transition-colors ${
                  selectedTransp === t.id
                    ? 'border-primary-500 bg-primary-50'
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

            {/* BL-P1-ALGO-04 — Recherche libre transporteur (impasse aucun_prestataire ou override) */}
            <details
              className="rounded-md border border-savr-neutral-200 p-3"
              open={algo.no_prestataire}
            >
              <summary className="cursor-pointer text-sm font-medium text-savr-neutral-700">
                <Search className="mr-1 inline h-3.5 w-3.5" />
                Choisir un autre transporteur (recherche libre)
              </summary>
              <div className="mt-3 space-y-2">
                <div className="flex gap-2">
                  <input
                    className="flex-1 rounded border border-savr-neutral-200 px-2 py-1 text-sm"
                    placeholder="Nom du transporteur…"
                    value={transpQuery}
                    onChange={(e) => setTranspQuery(e.target.value)}
                  />
                  <Button size="sm" variant="secondary" onClick={searchTransps}>
                    Rechercher
                  </Button>
                </div>
                {transpResults.map((t) => (
                  <button
                    key={t.id}
                    className={`flex w-full items-center justify-between rounded border px-2 py-1 text-left text-sm ${
                      selectedTransp === t.id
                        ? 'border-primary-500 bg-primary-50'
                        : 'border-savr-neutral-200'
                    }`}
                    onClick={() => {
                      setSelectedTransp(t.id);
                      setSelectedTranspNom(t.nom);
                      setTranspSource('libre');
                    }}
                  >
                    <span>
                      {t.nom}{' '}
                      <span className="text-xs text-savr-neutral-500">
                        · {t.ville}
                      </span>
                    </span>
                    <Badge variant="neutral" dot={false}>
                      {t.type_tms}
                    </Badge>
                  </button>
                ))}
              </div>
            </details>

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
