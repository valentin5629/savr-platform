'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Truck, Send, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  StatusCollecte,
  type StatutCollecte,
} from '@/components/ui/status-collecte';

interface CollecteDetail {
  id: string;
  type: 'zd' | 'ag';
  statut: string;
  statut_tms: string;
  dirty_tms: boolean;
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
  prestataire_logistique_id: string | null;
  evenements: {
    nom_evenement: string | null;
    pax: number;
    organisations: { raison_sociale: string };
    lieux: { nom: string; ville: string; adresse_acces: string };
    types_evenements: { nom: string };
  };
  collecte_flux: { code_flux: string; poids_kg: number | null }[];
  collecte_tournees: {
    rang: number;
    tournees: {
      id: string;
      statut_tms: string;
      tms_reference: string | null;
      external_ref_commande: string | null;
    };
  }[];
  factures_collectes: { id: string; montant_ht: number; statut: string }[];
}

export default function CollecteDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [collecte, setCollecte] = useState<CollecteDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [dispatching, setDispatching] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const STATUTS_TERMINAUX = [
    'realisee',
    'cloturee',
    'annulee',
    'realisee_sans_collecte',
  ];

  useEffect(() => {
    fetch(`/api/v1/admin/collectes/${params.id}`)
      .then((r) => r.json())
      .then((d: CollecteDetail) => setCollecte(d))
      .catch(() => setError('Erreur chargement'))
      .finally(() => setLoading(false));
  }, [params.id]);

  const handleDispatch = async () => {
    setDispatching(true);
    setDispatchError(null);
    const res = await fetch(`/api/v1/admin/collectes/${params.id}/dispatch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (res.ok) {
      const updated = await fetch(`/api/v1/admin/collectes/${params.id}`);
      if (updated.ok) setCollecte((await updated.json()) as CollecteDetail);
    } else {
      const body = (await res.json()) as { error: string };
      setDispatchError(body.error);
    }
    setDispatching(false);
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
    return (
      <p className="text-savr-error-600">{error ?? 'Collecte introuvable'}</p>
    );
  }

  const isTerminal = STATUTS_TERMINAUX.includes(collecte.statut);

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Truck className="h-5 w-5 text-savr-neutral-600" />
        <h1 className="text-xl font-bold text-savr-neutral-900">
          Collecte {collecte.type.toUpperCase()} —{' '}
          {new Date(collecte.date_collecte).toLocaleDateString('fr-FR')}
        </h1>
        <StatusCollecte statut={collecte.statut as StatutCollecte} />
        <Badge variant="neutral" className="text-xs">
          TMS: {collecte.statut_tms}
        </Badge>
        {collecte.dirty_tms && (
          <Badge variant="warning" className="text-xs flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            Modifiée — renvoi requis
          </Badge>
        )}
      </div>

      {/* Bloc 0 — Attribution prestataire & dispatch */}
      <Card className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-savr-neutral-800">
            Bloc 0 — Prestataire & Dispatch
          </h2>
          <Button
            size="sm"
            disabled={isTerminal || dispatching}
            onClick={() => void handleDispatch()}
          >
            <Send className="h-4 w-4 mr-2" />
            {dispatching
              ? 'Envoi…'
              : collecte.tms_reference
                ? 'Renvoyer au TMS'
                : 'Envoyer au TMS'}
          </Button>
        </div>
        {dispatchError && (
          <p className="text-savr-error-600 text-sm">{dispatchError}</p>
        )}
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-savr-neutral-500">Référence TMS</dt>
            <dd className="font-mono font-medium">
              {collecte.tms_reference ?? '—'}
            </dd>
          </div>
          <div>
            <dt className="text-savr-neutral-500">Nb camions</dt>
            <dd className="font-medium">{collecte.nb_camions_demande}</dd>
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
                    {ct.tournees.statut_tms}
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
                {collecte.evenements.types_evenements.nom}
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

      {/* Bloc 3 — Pesées ZD */}
      {collecte.type === 'zd' && collecte.collecte_flux.length > 0 && (
        <Card className="p-6 space-y-4">
          <h2 className="font-semibold text-savr-neutral-800">
            Bloc 3 — Pesées ZD
          </h2>
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
              {collecte.collecte_flux.map((f) => (
                <tr
                  key={f.code_flux}
                  className="border-b border-savr-neutral-100"
                >
                  <td className="py-2 font-medium">{f.code_flux}</td>
                  <td className="py-2 text-right">
                    {f.poids_kg !== null ? (
                      <span className="font-medium">{f.poids_kg} kg</span>
                    ) : (
                      <span className="text-savr-neutral-400">En attente</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Bloc 5 — AG Attribution (squelette) */}
      {collecte.type === 'ag' && (
        <Card className="p-6 space-y-3">
          <h2 className="font-semibold text-savr-neutral-800">
            Bloc 5 — Attribution AG
          </h2>
          <p className="text-sm text-savr-neutral-500">
            Attribution automatique (algo V2) — Non disponible en V1.
          </p>
          <Button variant="secondary" size="sm" disabled>
            Re-jouer l&apos;algo
            <Badge variant="neutral" className="ml-2 text-xs">
              V2
            </Badge>
          </Button>
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
                <Badge variant="neutral">{f.statut}</Badge>
                <span className="font-medium">{f.montant_ht} € HT</span>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" disabled>
            Valider & envoyer Pennylane
            <Badge variant="neutral" className="ml-2 text-xs">
              M1.7
            </Badge>
          </Button>
        </div>
      </Card>
    </div>
  );
}
