'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { use } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Attribution {
  id: string;
  volume_repas_realise: number | null;
  associations: {
    nom: string;
    ville: string | null;
    distance_km: number | null;
  } | null;
}
interface Collecte {
  id: string;
  type: string;
  statut: string;
  statut_affiche: string;
  date_collecte: string | null;
  heure_collecte: string | null;
  taux_recyclage: number | null;
  collecte_flux: {
    poids_reel_kg: number | null;
    flux_dechets: { code: string; nom: string } | null;
  }[];
  attributions_antgaspi: Attribution[];
  bordereaux_savr: {
    id: string;
    numero_bordereau: string;
    pdf_url: string | null;
  }[];
  rapports_rse: { id: string; pdf_url: string | null }[];
  attestations_don: {
    id: string;
    pdf_url: string | null;
    associations: { nom: string } | null;
  }[];
}
interface EvenementDetail {
  id: string;
  nom_evenement: string | null;
  date_evenement: string | null;
  pax: number | null;
  taille_bracket: string;
  dechets_labo_kg: number | null;
  lieux: {
    nom: string;
    adresse_acces: string | null;
    ville: string | null;
  } | null;
  organisations: { nom: string; logo_url: string | null } | null;
  collectes: Collecte[];
}

function one<T>(v: T | T[] | null): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export default function EvenementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [evt, setEvt] = useState<EvenementDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetch(`/api/v1/gestionnaire/evenements/${id}`)
      .then((r) => {
        if (r.status === 404) {
          setNotFound(true);
          return null;
        }
        return r.json();
      })
      .then((j) => {
        if (j) setEvt(j.data as EvenementDetail);
      })
      .finally(() => setLoading(false));
  }, [id]);

  if (loading)
    return <p className="text-sm text-savr-neutral-500">Chargement…</p>;
  if (notFound)
    return (
      <p className="text-sm text-savr-neutral-500">Événement non trouvé.</p>
    );
  if (!evt) return null;

  const lieu = one(evt.lieux as Parameters<typeof one>[0]);
  const traiteur = one(evt.organisations as Parameters<typeof one>[0]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          ←
        </Button>
        <h1 className="text-2xl font-bold text-savr-primary-800">
          {evt.nom_evenement ?? 'Événement'}
        </h1>
        <Badge variant="neutral">{evt.taille_bracket}</Badge>
      </div>

      {/* En-tête */}
      <Card>
        <CardContent className="grid grid-cols-2 gap-3 pt-4 text-sm md:grid-cols-4">
          <div>
            <div className="text-xs text-savr-neutral-500">Date</div>
            <div>{evt.date_evenement ?? '—'}</div>
          </div>
          <div>
            <div className="text-xs text-savr-neutral-500">Lieu</div>
            <div>{(lieu as { nom?: string } | null)?.nom ?? '—'}</div>
            <div className="text-xs text-savr-neutral-400">
              {(lieu as { ville?: string } | null)?.ville ?? ''}
            </div>
          </div>
          <div>
            <div className="text-xs text-savr-neutral-500">Traiteur</div>
            <div>{(traiteur as { nom?: string } | null)?.nom ?? '—'}</div>
          </div>
          <div>
            <div className="text-xs text-savr-neutral-500">Pax</div>
            <div>{evt.pax ?? '—'}</div>
            {evt.dechets_labo_kg != null && (
              <div className="text-xs text-savr-neutral-400">
                Est. labo : {evt.dechets_labo_kg.toFixed(1)} kg
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Collectes */}
      {evt.collectes.length === 0 ? (
        <p className="text-sm text-savr-neutral-500">
          Aucune collecte associée.
        </p>
      ) : (
        evt.collectes.map((c) => (
          <Card key={c.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                {c.type === 'zero_dechet'
                  ? 'Collecte Zéro Déchet'
                  : 'Collecte Anti-Gaspi'}
                <Badge variant="neutral">{c.statut_affiche}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {c.type === 'zero_dechet' && c.collecte_flux.length > 0 && (
                <div>
                  <div className="mb-1 text-xs font-medium text-savr-neutral-500 uppercase">
                    Pesées
                  </div>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                    {c.collecte_flux.map((f, i) => (
                      <div
                        key={i}
                        className="rounded bg-savr-neutral-50 px-2 py-1 text-sm"
                      >
                        <span className="font-medium">
                          {f.flux_dechets?.nom ?? f.flux_dechets?.code ?? '?'}
                        </span>{' '}
                        :{' '}
                        {f.poids_reel_kg != null
                          ? `${f.poids_reel_kg} kg`
                          : '—'}
                      </div>
                    ))}
                  </div>
                  {c.taux_recyclage != null && (
                    <div className="mt-1 text-sm">
                      Taux de recyclage :{' '}
                      <strong>{c.taux_recyclage.toFixed(1)} %</strong>
                    </div>
                  )}
                </div>
              )}

              {c.type === 'anti_gaspi' &&
                c.attributions_antgaspi.length > 0 && (
                  <div>
                    <div className="mb-1 text-xs font-medium text-savr-neutral-500 uppercase">
                      Attributions
                    </div>
                    {c.attributions_antgaspi.map((a) => (
                      <div key={a.id} className="text-sm">
                        {a.associations?.nom ?? '—'} —{' '}
                        {a.volume_repas_realise ?? 0} repas
                      </div>
                    ))}
                  </div>
                )}

              {/* Documents */}
              <div className="flex flex-wrap gap-2">
                {c.bordereaux_savr.map((b) =>
                  b.pdf_url ? (
                    <a
                      key={b.id}
                      href={b.pdf_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-savr-primary-700 underline"
                    >
                      Bordereau {b.numero_bordereau}
                    </a>
                  ) : null,
                )}
                {c.rapports_rse.map((r) =>
                  r.pdf_url ? (
                    <a
                      key={r.id}
                      href={r.pdf_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-savr-primary-700 underline"
                    >
                      Rapport RSE
                    </a>
                  ) : null,
                )}
                {c.attestations_don.map((a) =>
                  a.pdf_url ? (
                    <a
                      key={a.id}
                      href={a.pdf_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-savr-primary-700 underline"
                    >
                      Attestation don
                    </a>
                  ) : null,
                )}
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
