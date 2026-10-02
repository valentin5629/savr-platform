'use client';

import { fmtKg } from '@/lib/format';
import { use, useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Heading } from '@/components/ui/heading';
import { Text } from '@/components/ui/text';

// Détail d'une collecte au registre (§06.03, 8 blocs snapshot lecture seule).

interface FluxDetail {
  code: string;
  libelle: string;
  filiere: string;
  poids_kg: number;
}
interface RegistreDetail {
  collecte_id: string;
  evenement: {
    nom: string | null;
    date: string | null;
    heure: string | null;
    pax: number | null;
    type_evenement: string | null;
    client_organisateur: string | null;
  };
  producteur: {
    raison_sociale: string | null;
    siret: string | null;
    adresse: string | null;
  };
  lieu: {
    nom: string | null;
    adresse: string | null;
    code_postal: string | null;
    ville: string | null;
  };
  transporteur: { nom: string | null; siret: string | null };
  exutoire: {
    nom: string | null;
    siret: string | null;
    adresse: string | null;
  };
  flux: FluxDetail[];
  poids_total_kg: number | null;
  documents: {
    bordereau_id: string | null;
    numero: string | null;
    statut: string | null;
    date_emission: string | null;
    version: number | null;
  };
  historique: { action?: string; table_name?: string; created_at?: string }[];
  historique_partiel: boolean;
}

function dateFr(d: string | null | undefined): string {
  if (!d) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
}
function poidsFr(kg: number | null): string {
  return kg == null ? '—' : fmtKg(kg, 2);
}

function Field({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  return (
    <div>
      <dt className="text-xs uppercase text-savr-neutral-500">{label}</dt>
      <dd className="text-sm">{value ?? '—'}</dd>
    </div>
  );
}

export default function RegistreDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [data, setData] = useState<RegistreDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetch(`/api/v1/registre/${encodeURIComponent(id)}`)
      .then((r) => {
        if (!r.ok) {
          setNotFound(true);
          return null;
        }
        return r.json() as Promise<RegistreDetail>;
      })
      .then((j) => j && setData(j))
      .finally(() => setLoading(false));
  }, [id]);

  async function downloadBordereau(bid: string) {
    const res = await fetch(
      `/api/v1/registre/bordereaux/${encodeURIComponent(bid)}/download`,
    );
    if (!res.ok) return;
    const j = (await res.json()) as { url?: string };
    if (j.url) window.open(j.url, '_blank');
  }

  if (loading) return <p className="p-4 text-sm">Chargement…</p>;
  if (notFound || !data)
    return <p className="p-4 text-sm">Collecte introuvable.</p>;

  const dispo =
    data.documents.statut === 'emis' || data.documents.statut === 'corrige';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <a
            href="/registre"
            className="text-sm text-savr-primary-700 underline"
          >
            ← Registre
          </a>
          <Heading level={1} tone="primary">
            Collecte ZD — {dateFr(data.evenement.date)} — {data.lieu.nom ?? ''}
          </Heading>
          <div className="flex items-center gap-2 pt-1">
            <Badge variant={dispo ? 'success' : 'neutral'}>
              {dispo ? 'Bordereau disponible' : 'Bordereau manquant'}
            </Badge>
            {data.historique_partiel && (
              <Badge variant="warning">Historique partiel</Badge>
            )}
          </div>
        </div>
        {data.documents.bordereau_id && dispo && (
          <Button
            onClick={() => downloadBordereau(data.documents.bordereau_id!)}
          >
            Télécharger le bordereau
          </Button>
        )}
      </div>

      <Card padding="sm">
        <Heading level={2} size="inherit" tone="inherit" className="mb-3">
          Bloc 1 — Événement
        </Heading>
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Field label="Nom" value={data.evenement.nom} />
          <Field label="Date" value={dateFr(data.evenement.date)} />
          <Field label="Horaire" value={data.evenement.heure?.slice(0, 5)} />
          <Field label="Pax" value={data.evenement.pax} />
          <Field label="Type" value={data.evenement.type_evenement} />
          <Field
            label="Client organisateur"
            value={data.evenement.client_organisateur}
          />
        </dl>
      </Card>

      <Card padding="sm">
        <Heading level={2} size="inherit" tone="inherit" className="mb-3">
          Bloc 2 — Producteur de déchets
        </Heading>
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Field
            label="Raison sociale"
            value={data.producteur.raison_sociale}
          />
          <Field label="SIRET" value={data.producteur.siret} />
          <Field label="Adresse" value={data.producteur.adresse} />
        </dl>
      </Card>

      <Card padding="sm">
        <Heading level={2} size="inherit" tone="inherit" className="mb-3">
          Bloc 3 — Lieu
        </Heading>
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Field label="Nom" value={data.lieu.nom} />
          <Field
            label="Adresse"
            value={[data.lieu.adresse, data.lieu.code_postal, data.lieu.ville]
              .filter(Boolean)
              .join(' ')}
          />
        </dl>
      </Card>

      <Card padding="sm">
        <Heading level={2} size="inherit" tone="inherit" className="mb-3">
          Bloc 4 — Transporteur
        </Heading>
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Field label="Nom" value={data.transporteur.nom} />
          <Field label="SIRET" value={data.transporteur.siret} />
        </dl>
      </Card>

      <Card padding="sm">
        <Heading level={2} size="inherit" tone="inherit" className="mb-3">
          Bloc 5 — Exutoire
        </Heading>
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Field label="Nom" value={data.exutoire.nom} />
          <Field label="SIRET" value={data.exutoire.siret} />
          <Field label="Adresse" value={data.exutoire.adresse} />
        </dl>
      </Card>

      <Card padding="sm">
        <Heading level={2} size="inherit" tone="inherit" className="mb-3">
          Bloc 6 — Détail des flux
        </Heading>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-savr-neutral-500">
            <tr>
              <th className="py-1">Flux</th>
              <th className="py-1">Code</th>
              <th className="py-1">Filière</th>
              <th className="py-1">Poids réel</th>
            </tr>
          </thead>
          <tbody>
            {data.flux.map((f) => (
              <tr key={f.code} className="border-t border-savr-neutral-100">
                <td className="py-1">{f.libelle}</td>
                <td className="py-1">{f.code}</td>
                <td className="py-1">{f.filiere}</td>
                <td className="py-1">{poidsFr(f.poids_kg)}</td>
              </tr>
            ))}
            <tr className="border-t border-savr-neutral-200 font-medium">
              <td className="py-1" colSpan={3}>
                Total
              </td>
              <td className="py-1">{poidsFr(data.poids_total_kg)}</td>
            </tr>
          </tbody>
        </table>
      </Card>

      <Card padding="sm">
        <Heading level={2} size="inherit" tone="inherit" className="mb-3">
          Bloc 7 — Documents
        </Heading>
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Field label="N° bordereau" value={data.documents.numero} />
          <Field
            label="Date émission"
            value={dateFr(data.documents.date_emission)}
          />
          <Field label="Version" value={data.documents.version} />
        </dl>
      </Card>

      <Card padding="sm">
        <Heading level={2} size="inherit" tone="inherit" className="mb-3">
          Bloc 8 — Historique
        </Heading>
        {data.historique.length === 0 ? (
          <Text>Aucun événement d&apos;audit visible.</Text>
        ) : (
          <ul className="space-y-1 text-sm">
            {data.historique.map((h, i) => (
              <li key={i}>
                <span className="text-savr-neutral-500">
                  {dateFr(h.created_at)}
                </span>{' '}
                — {h.action} {h.table_name ? `(${h.table_name})` : ''}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
