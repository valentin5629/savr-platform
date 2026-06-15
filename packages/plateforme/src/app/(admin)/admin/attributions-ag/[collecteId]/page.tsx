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

interface AssociationSuggestion {
  id: string;
  nom: string;
  distance_km: number;
  capacite_max_beneficiaires: number;
  contact_email: string;
}

interface AlgoResult {
  associations: AssociationSuggestion[];
  assoc_count: number;
  transporteur: { id: string; nom: string; type_tms: string } | null;
  branche: string;
  is_idf: boolean;
  no_asso: boolean;
  no_prestataire: boolean;
  delai_minutes: number;
  nb_pax: number;
}

type ModeValidation = 'manuel_top1' | 'manuel_override';

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
  const [mode, setMode] = useState<ModeValidation>('manuel_top1');
  const [motif, setMotif] = useState('');
  const [motifLibre, setMotifLibre] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

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
      // Pré-sélectionner top 1
      if (json.data.associations.length > 0) {
        setSelectedAsso(json.data.associations[0]?.id ?? null);
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

  const handleValider = async () => {
    if (!algo?.transporteur || !selectedAsso) return;
    if (mode === 'manuel_override' && !motif) {
      setError('Motif override obligatoire');
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
            transporteur_id: algo.transporteur.id,
            branche_attribution: algo.branche,
            mode_validation: mode,
            motif_override: mode === 'manuel_override' ? motif : undefined,
            motif_override_libre: motifLibre || undefined,
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

            {algo.no_asso && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
                Aucune association éligible trouvée pour ce créneau / volume.
              </div>
            )}

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
                  setMode(idx === 0 ? 'manuel_top1' : 'manuel_override');
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
          </div>

          {/* Colonne droite : transporteur + validation */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium text-savr-neutral-700">
              <Truck className="h-4 w-4" />
              Transporteur recommandé
            </div>

            {algo.no_prestataire ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
                Aucun prestataire disponible pour cette branche.
              </div>
            ) : algo.transporteur ? (
              <Card className="border border-savr-neutral-200 p-4">
                <p className="font-medium text-savr-neutral-900">
                  {algo.transporteur.nom}
                </p>
                <p className="mt-1 text-xs text-savr-neutral-500">
                  Branche :{' '}
                  <span className="font-medium">
                    {BRANCHE_LABELS[algo.branche] ?? algo.branche}
                  </span>
                </p>
                <p className="text-xs text-savr-neutral-500">
                  Zone : {algo.is_idf ? 'IDF' : 'Province'} · {algo.nb_pax} PAX
                  ·{' '}
                  {algo.delai_minutes < 60
                    ? `${algo.delai_minutes} min`
                    : `${Math.round(algo.delai_minutes / 60)} h`}
                </p>
              </Card>
            ) : null}

            {/* Mode validation override */}
            {mode === 'manuel_override' && (
              <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-medium text-amber-800">
                  Sélection hors top 1 — motif override requis
                </p>
                <select
                  className="w-full rounded border border-savr-neutral-200 px-2 py-1 text-sm"
                  value={motif}
                  onChange={(e) => setMotif(e.target.value)}
                >
                  <option value="">Choisir un motif…</option>
                  <option value="asso_indisponible">
                    Association top 1 indisponible
                  </option>
                  <option value="capacite_insuffisante">
                    Capacité insuffisante
                  </option>
                  <option value="accord_prealable">Accord préalable</option>
                  <option value="autre">Autre</option>
                </select>
                {motif === 'autre' && (
                  <textarea
                    className="w-full rounded border border-savr-neutral-200 px-2 py-1 text-sm"
                    placeholder="Précision libre…"
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
                !selectedAsso ||
                !algo.transporteur ||
                submitting ||
                (mode === 'manuel_override' && !motif)
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
