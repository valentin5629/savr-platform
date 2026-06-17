'use client';

import { use, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Lieu {
  nom: string;
  adresse_acces: string | null;
  code_postal: string | null;
  ville: string | null;
}
interface Evenement {
  nom_evenement: string | null;
  pax: number | null;
  nom_client_organisateur: string | null;
  contact_principal_nom: string | null;
  contact_principal_telephone: string | null;
  lieu: Lieu | Lieu[] | null;
}
interface TraiteurOperationnel {
  id: string;
  nom: string | null;
  est_shadow: boolean;
  siret: string | null;
}
interface Collecte {
  id: string;
  type: string;
  statut: string;
  date_collecte: string;
  heure_collecte: string | null;
  controle_acces_requis: boolean;
  informations_completes: boolean;
  taux_recyclage: number | null;
  aucun_repas_motif: string | null;
  evenement: Evenement | Evenement[] | null;
  traiteur_operationnel: TraiteurOperationnel | null;
}

function one<T>(v: T | T[] | null): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

const STATUTS_EDITABLES = ['programmee', 'validee'];
const STATUTS_ANNULABLES = ['brouillon', 'programmee', 'validee'];

export default function FicheCollecteAgencePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [c, setC] = useState<Collecte | null>(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [siret, setSiret] = useState('');
  const [siretError, setSiretError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function load() {
    setLoading(true);
    fetch(`/api/v1/agence/collectes/${id}`)
      .then((r) => r.json())
      .then((j) => setC(j.data ?? null))
      .finally(() => setLoading(false));
  }

  useEffect(load, [id]);

  async function submitSiret() {
    setSaving(true);
    setSiretError(null);
    const traiteur = c?.traiteur_operationnel;
    if (!traiteur) return;
    const res = await fetch(`/api/v1/agence/shadow/${traiteur.id}/siret`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siret }),
    });
    setSaving(false);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setSiretError(j.error ?? 'Erreur lors de la complétion du SIRET');
      return;
    }
    setModalOpen(false);
    setSiret('');
    load();
  }

  if (loading) return <p className="p-4 text-sm">Chargement…</p>;
  if (!c) return <p className="p-4 text-sm">Collecte introuvable.</p>;

  const evt = one(c.evenement);
  const lieu = one(evt?.lieu ?? null);
  const pax = evt?.pax != null ? `${evt.pax} pax` : '— pax';
  const titre = [c.date_collecte, lieu?.nom, evt?.nom_client_organisateur, pax]
    .filter(Boolean)
    .join(' - ');
  const traiteur = c.traiteur_operationnel;

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
          {/* §06.11 diff #3 — traiteur opérationnel (badge « Hors référentiel » si shadow) */}
          <div data-testid="traiteur-operationnel">
            <span className="text-savr-neutral-500">
              Traiteur opérationnel :{' '}
            </span>
            {traiteur?.nom ?? '—'}{' '}
            {traiteur?.est_shadow && (
              <button
                type="button"
                onClick={() => setModalOpen(true)}
                className="ml-1 align-middle"
                data-testid="badge-hors-referentiel"
              >
                <Badge variant="warning">Hors référentiel</Badge>
              </button>
            )}
          </div>
          <div>
            <span className="text-savr-neutral-500">Contact principal : </span>
            {evt?.contact_principal_nom ?? '—'}{' '}
            {evt?.contact_principal_telephone ?? ''}
          </div>
          <div>
            <span className="text-savr-neutral-500">Statut : </span>
            <Badge variant="neutral">{c.statut}</Badge>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={!STATUTS_EDITABLES.includes(c.statut)}
          title={
            STATUTS_EDITABLES.includes(c.statut)
              ? ''
              : 'Édition impossible à ce statut'
          }
        >
          Éditer la collecte
        </Button>
        <Button
          variant="ghost"
          disabled={!STATUTS_ANNULABLES.includes(c.statut)}
          onClick={() =>
            fetch(`/api/v1/agence/collectes/${id}/annulation`, {
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

      {/* Modal complétion SIRET (§06.11 F2) */}
      {modalOpen && traiteur && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          data-testid="modal-siret"
        >
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Compléter le SIRET — {traiteur.nom}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-savr-neutral-500">
                Le SIRET du traiteur opérationnel est requis pour finaliser le
                bordereau Cerfa.
              </p>
              <input
                type="text"
                inputMode="numeric"
                maxLength={14}
                value={siret}
                onChange={(e) =>
                  setSiret(e.target.value.replace(/\D/g, '').slice(0, 14))
                }
                placeholder="14 chiffres"
                className="w-full rounded-savr-md border border-savr-neutral-300 px-3 py-2 text-sm"
              />
              {siretError && (
                <p className="text-sm text-savr-error">{siretError}</p>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setModalOpen(false)}>
                  Annuler
                </Button>
                <Button
                  disabled={saving || siret.length !== 14}
                  onClick={submitSiret}
                >
                  Enregistrer
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
