'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { use } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateHeureParis } from '@savr/shared/src/temps/index.js';

interface Attribution {
  id: string;
  volume_repas_realise: number | null;
  // Distance association ↔ lieu de l'événement, calculée à la volée par la
  // route (haversine, §06.05 §3 « Pour AG »). null = association ou lieu non
  // géocodé → « — », jamais 0.
  distance_km: number | null;
  associations: {
    nom: string;
    ville: string | null;
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
    numero: string | null;
    statut: string;
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
  // §06.05 §3 en-tête : « Client Organisateur si renseigné par le traiteur ».
  nom_client_organisateur: string | null;
  lieux: {
    nom: string;
    adresse_acces: string | null;
    ville: string | null;
  } | null;
  // `organisations` = embed sur v_traiteurs_gestionnaire (id, nom, logo_url) :
  // `id` sert à construire l'URL du proxy logo, jamais la clé R2 elle-même.
  organisations: { id: string; nom: string; logo_url: string | null } | null;
  // §06.05 §3 en-tête : « type d'événement ». Embed types_evenements!type_evenement_id.
  types_evenements: { libelle: string } | null;
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
  const [docMessage, setDocMessage] = useState<string | null>(null);
  const [logoKo, setLogoKo] = useState(false);

  useEffect(() => {
    setLogoKo(false);
    fetch(`/api/v1/gestionnaire/evenements/${encodeURIComponent(id)}`)
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

  // Bordereau ZD : URL pré-signée R2 servie par la route registre (gestionnaire
  // autorisé, RLS bordereaux_savr = frontière) — même geste que le registre.
  async function telechargerBordereau(bordereauId: string) {
    const res = await fetch(
      `/api/v1/registre/bordereaux/${encodeURIComponent(bordereauId)}/download`,
    );
    if (!res.ok) return;
    const j = (await res.json()) as { url?: string };
    if (j.url) window.open(j.url, '_blank');
  }

  // Rapport de recyclage / attestation de don : pdf_url = clé R2 (bucket/key),
  // pas une URL → URL pré-signée via la route gestionnaire (RLS = frontière,
  // embargo H+24 appliqué côté serveur → 425).
  async function telechargerDocument(
    type: 'rapport' | 'attestation',
    docId: string,
  ) {
    setDocMessage(null);
    const res = await fetch(
      `/api/v1/gestionnaire/documents/${encodeURIComponent(type)}/${encodeURIComponent(docId)}/download`,
    );
    if (res.status === 425) {
      const j = (await res.json()) as { disponible_a?: string };
      setDocMessage(
        j.disponible_a
          ? `Document disponible à partir du ${formatDateHeureParis(j.disponible_a)}.`
          : 'Document pas encore disponible.',
      );
      return;
    }
    if (!res.ok) {
      setDocMessage('Document indisponible pour le moment.');
      return;
    }
    const j = (await res.json()) as { url?: string };
    if (j.url) window.open(j.url, '_blank');
  }

  if (loading)
    return <p className="text-sm text-savr-neutral-500">Chargement…</p>;
  if (notFound)
    return (
      <p className="text-sm text-savr-neutral-500">Événement non trouvé.</p>
    );
  if (!evt) return null;

  const lieu = one(evt.lieux as Parameters<typeof one>[0]);
  const traiteur = one(evt.organisations as Parameters<typeof one>[0]) as {
    id?: string;
    nom?: string;
    logo_url?: string | null;
  } | null;
  const typeEvenement = one(
    evt.types_evenements as Parameters<typeof one>[0],
  ) as { libelle?: string } | null;

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
            {/* §06.05 §3 : « nom + logo, pas d'email / téléphone / SIRET ».
                logo_url porte une CLÉ R2 : seul le proxy la résout, dans le
                périmètre de v_traiteurs_gestionnaire (#367). */}
            <div className="flex items-center gap-2">
              {traiteur?.logo_url && traiteur.id && !logoKo && (
                <img
                  src={`/api/v1/gestionnaire/traiteurs/${encodeURIComponent(traiteur.id)}/logo`}
                  alt=""
                  onError={() => setLogoKo(true)}
                  className="h-8 w-8 rounded-full object-cover"
                />
              )}
              <span>{traiteur?.nom ?? '—'}</span>
            </div>
          </div>
          <div>
            <div className="text-xs text-savr-neutral-500">
              Type d'événement
            </div>
            <div>{typeEvenement?.libelle ?? '—'}</div>
          </div>
          {/* « Client Organisateur si renseigné par le traiteur » : la cellule
              n'apparaît pas quand le champ est vide (§06.05 §3). */}
          {evt.nom_client_organisateur && (
            <div>
              <div className="text-xs text-savr-neutral-500">
                Client organisateur
              </div>
              <div>{evt.nom_client_organisateur}</div>
            </div>
          )}
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

      {docMessage && (
        <p role="status" className="text-sm text-savr-neutral-600">
          {docMessage}
        </p>
      )}

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
                        {a.associations?.nom ?? '—'}
                        <span className="text-savr-neutral-500">
                          {a.associations?.ville
                            ? ` · ${a.associations.ville}`
                            : ''}
                          {' · '}
                          {/* §06.05 §3 : distance en km, « — » si non calculable */}
                          {a.distance_km != null ? `${a.distance_km} km` : '—'}
                        </span>{' '}
                        — {a.volume_repas_realise ?? 0} repas
                      </div>
                    ))}
                  </div>
                )}

              {/* Documents */}
              <div className="flex flex-wrap gap-2">
                {c.bordereaux_savr.map((b) =>
                  b.statut === 'emis' || b.statut === 'corrige' ? (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => void telechargerBordereau(b.id)}
                      className="text-xs text-savr-primary-700 underline"
                    >
                      Bordereau {b.numero ?? ''}
                    </button>
                  ) : null,
                )}
                {c.rapports_rse.map((r) =>
                  r.pdf_url ? (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => void telechargerDocument('rapport', r.id)}
                      className="text-xs text-savr-primary-700 underline"
                    >
                      Rapport RSE
                    </button>
                  ) : null,
                )}
                {c.attestations_don.map((a) =>
                  a.pdf_url ? (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() =>
                        void telechargerDocument('attestation', a.id)
                      }
                      className="text-xs text-savr-primary-700 underline"
                    >
                      Attestation don
                    </button>
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
