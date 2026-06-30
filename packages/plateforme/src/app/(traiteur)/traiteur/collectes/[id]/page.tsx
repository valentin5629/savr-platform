'use client';

import { use, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { CollecteStatutBadge } from '@/components/ui/collecte-statut-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EditerCollecteForm } from '@/components/collecte/editer-collecte-form';

interface Lieu {
  nom: string;
  adresse_acces: string | null;
  code_postal: string | null;
  ville: string | null;
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
  lieu: Lieu | Lieu[] | null;
}
interface Collecte {
  id: string;
  type: string;
  statut: string;
  statut_tms: string;
  date_collecte: string;
  heure_collecte: string | null;
  controle_acces_requis: boolean;
  informations_completes: boolean;
  informations_supplementaires: string | null;
  notes_internes: string | null;
  taux_recyclage: number | null;
  aucun_repas_motif: string | null;
  evenement: Evenement | Evenement[] | null;
}

function one<T>(v: T | T[] | null): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

const STATUTS_EDITABLES = ['programmee', 'validee'];
const STATUTS_ANNULABLES = ['brouillon', 'programmee', 'validee'];

export default function FicheCollectePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [c, setC] = useState<Collecte | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  function reload() {
    fetch(`/api/v1/traiteur/collectes/${id}`)
      .then((r) => r.json())
      .then((j) => setC(j.data ?? null))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    reload();
  }, [id]);

  if (loading) return <p className="p-4 text-sm">Chargement…</p>;
  if (!c) return <p className="p-4 text-sm">Collecte introuvable.</p>;

  const evt = one(c.evenement);
  const lieu = one(evt?.lieu ?? null);
  const pax = evt?.pax != null ? `${evt.pax} pax` : '— pax';
  const titre = [c.date_collecte, lieu?.nom, evt?.nom_client_organisateur, pax]
    .filter(Boolean)
    .join(' - ');

  const controleAccesVisible =
    c.controle_acces_requis &&
    ['programmee', 'validee', 'en_cours'].includes(c.statut);

  return (
    <div className="space-y-6">
      {!c.informations_completes && (
        <div className="rounded-savr-md bg-savr-warning-subtle px-4 py-2 text-sm text-savr-warning-strong">
          Informations incomplètes — merci de compléter avant la collecte.
        </div>
      )}

      <div>
        <h1 className="text-2xl font-bold text-savr-primary-800">{titre}</h1>
        <p className="text-xs text-savr-neutral-400">Réf. {c.id}</p>
      </div>

      {/* Entête infos pilotantes */}
      <Card>
        <CardContent className="grid grid-cols-1 gap-2 pt-6 text-sm md:grid-cols-2">
          <div>
            <span className="text-savr-neutral-500">Adresse : </span>
            {[lieu?.adresse_acces, lieu?.code_postal, lieu?.ville]
              .filter(Boolean)
              .join(' ') || '—'}
          </div>
          <div>
            <span className="text-savr-neutral-500">Heure : </span>
            {c.heure_collecte?.slice(0, 5) ?? '—'}
          </div>
          <div>
            <span className="text-savr-neutral-500">Contact principal : </span>
            {evt?.contact_principal_nom ?? '—'}{' '}
            {evt?.contact_principal_telephone ?? ''}
          </div>
          {evt?.contact_secours_nom && (
            <div>
              <span className="text-savr-neutral-500">Contact secours : </span>
              {evt.contact_secours_nom} {evt.contact_secours_telephone ?? ''}
            </div>
          )}
          <div>
            <span className="text-savr-neutral-500">Statut : </span>
            <CollecteStatutBadge statut={c.statut} />
          </div>
        </CardContent>
      </Card>

      {/* Formulaire d'édition (événement + collecte) */}
      {editing && evt && (
        <EditerCollecteForm
          collecte={{
            id: c.id,
            type: c.type,
            statut: c.statut,
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
          collecteEndpoint={`/api/v1/traiteur/collectes/${c.id}`}
          onSaved={() => {
            setEditing(false);
            reload();
          }}
          onCancel={() => setEditing(false)}
        />
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={!STATUTS_EDITABLES.includes(c.statut)}
          title={
            STATUTS_EDITABLES.includes(c.statut)
              ? ''
              : 'Édition impossible à ce statut'
          }
          onClick={() => setEditing((v) => !v)}
        >
          {editing ? 'Fermer l’édition' : 'Éditer la collecte'}
        </Button>
        <Button
          variant="ghost"
          disabled={!STATUTS_ANNULABLES.includes(c.statut)}
          onClick={() =>
            fetch(`/api/v1/traiteur/collectes/${id}/annulation`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ motif: '' }),
            }).then(() => location.reload())
          }
        >
          {c.statut === 'validee'
            ? "Demander l'annulation"
            : 'Annuler la collecte'}
        </Button>
      </div>

      {/* Cas realisee_sans_collecte (AG) */}
      {c.statut === 'realisee_sans_collecte' && (
        <Card>
          <CardHeader>
            <CardTitle>Aucun repas collecté</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {c.aucun_repas_motif ?? 'Aucun excédent alimentaire sur place.'}
          </CardContent>
        </Card>
      )}

      {/* Bloc 2bis ZD — taux de recyclage (collecte cloturee) */}
      {c.type === 'zero_dechet' && c.statut === 'cloturee' && (
        <Card>
          <CardHeader>
            <CardTitle>Taux de recyclage</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold">
            {c.taux_recyclage != null
              ? `${c.taux_recyclage.toFixed(1)} %`
              : '—'}
          </CardContent>
        </Card>
      )}

      {/* Bloc Contrôle d'accès */}
      {controleAccesVisible && (
        <Card data-testid="bloc-controle-acces">
          <CardHeader>
            <CardTitle>Contrôle d&apos;accès</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-savr-neutral-500">
            Le prestataire n&apos;a pas encore communiqué la plaque + le nom du
            chauffeur.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
