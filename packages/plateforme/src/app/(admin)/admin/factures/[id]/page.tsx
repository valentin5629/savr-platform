'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Send,
  RotateCcw,
  FileX,
  Plus,
  Trash2,
  Save,
} from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface Ligne {
  id: string;
  designation: string | null;
  libelle_ligne: string | null;
  quantite: number;
  montant_ligne_ht: number;
  taux_tva: number;
  collectes?: {
    id: string;
    statut: string;
    evenements?: { reference_affaire: string | null } | null;
  } | null;
}

interface FactureDetail {
  id: string;
  numero_facture: string | null;
  type: string;
  mode_facturation: string;
  statut: string;
  pennylane_statut: string | null;
  montant_ht: number;
  montant_tva: number;
  montant_ttc: number;
  devise: string;
  date_emission: string | null;
  date_echeance: string | null;
  date_paiement: string | null;
  notes: string | null;
  erreur_synchro: string | null;
  pdf_url_pennylane: string | null;
  organisations: { raison_sociale: string; siret: string | null } | null;
  entites_facturation: {
    raison_sociale: string;
    siret: string | null;
    siret_verification: string;
    tva_intracom: string | null;
    adresse_facturation: string | null;
    code_postal: string | null;
    ville: string | null;
  } | null;
  factures_collectes: Ligne[];
}

const STATUT_LABELS: Record<string, string> = {
  brouillon: 'Brouillon',
  en_attente_pennylane: 'En attente Pennylane',
  emise: 'Émise',
  payee: 'Payée',
  annulee: 'Annulée',
};

const TYPE_LABELS: Record<string, string> = {
  zero_dechet: 'Zéro Déchet',
  collecte_antigaspi: 'Anti-Gaspi',
  achat_pack_antigaspi: 'Achat Pack AG',
  avoir: 'Avoir',
};

export default function FactureDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [facture, setFacture] = useState<FactureDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Buffers d'édition (Bloc 1/5)
  const [dateEmission, setDateEmission] = useState('');
  const [dateEcheance, setDateEcheance] = useState('');
  const [notes, setNotes] = useState('');
  // Ajout ligne libre (Bloc 3)
  const [newDesignation, setNewDesignation] = useState('');
  const [newMontant, setNewMontant] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/v1/admin/factures/${id}`)
      .then((r) => r.json())
      .then((d: { data: FactureDetail }) => {
        setFacture(d.data);
        setDateEmission(d.data?.date_emission ?? '');
        setDateEcheance(d.data?.date_echeance ?? '');
        setNotes(d.data?.notes ?? '');
      })
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const isBrouillon = facture?.statut === 'brouillon';

  async function doAction(action: string, body?: Record<string, unknown>) {
    setActionLoading(action);
    setError(null);
    try {
      const res = await fetch(`/api/v1/admin/factures/${id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = (await res.json()) as {
        ok?: boolean;
        erreur?: string;
        avoir_id?: string;
      };
      if (action === 'avoir' && data.avoir_id) {
        router.push(`/admin/factures/${data.avoir_id}`);
      } else {
        load();
      }
      if (!data.ok && data.erreur) setError(data.erreur);
    } catch (err) {
      setError(String(err));
    } finally {
      setActionLoading(null);
    }
  }

  // Appels d'édition (PATCH/POST/DELETE) — affichent l'erreur API + rechargent.
  async function callEdit(
    path: string,
    method: 'PATCH' | 'POST' | 'DELETE',
    body?: Record<string, unknown>,
    key = 'edit',
  ) {
    setActionLoading(key);
    setError(null);
    try {
      const res = await fetch(`/api/v1/admin/factures/${id}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        setError(d.error ?? `Erreur ${res.status}`);
        return false;
      }
      load();
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    } finally {
      setActionLoading(null);
    }
  }

  async function saveHeader() {
    await callEdit(
      '',
      'PATCH',
      {
        date_emission: dateEmission || null,
        date_echeance: dateEcheance || null,
        notes: notes || null,
      },
      'header',
    );
  }

  async function saveLigne(ligne: Ligne, patch: Record<string, unknown>) {
    await callEdit(`/lignes/${ligne.id}`, 'PATCH', patch, `ligne-${ligne.id}`);
  }

  async function deleteLigne(ligne: Ligne) {
    if (!window.confirm('Supprimer cette ligne ?')) return;
    await callEdit(
      `/lignes/${ligne.id}`,
      'DELETE',
      undefined,
      `del-${ligne.id}`,
    );
  }

  async function addLigne() {
    const montant = Number(newMontant);
    if (!newDesignation.trim() || Number.isNaN(montant)) {
      setError('Désignation et montant HT requis pour une ligne libre');
      return;
    }
    const ok = await callEdit(
      '/lignes',
      'POST',
      { designation: newDesignation.trim(), montant_ligne_ht: montant },
      'add',
    );
    if (ok) {
      setNewDesignation('');
      setNewMontant('');
    }
  }

  async function creerAvoir() {
    const motif = window.prompt("Motif de l'avoir :");
    if (!motif?.trim()) return;
    await doAction('avoir', { motif });
  }

  if (loading)
    return <div className="text-neutral-500 text-sm">Chargement…</div>;
  if (!facture)
    return <div className="text-neutral-500 text-sm">Facture introuvable.</div>;

  const fmt = new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: facture.devise,
  });
  const inputCls =
    'rounded-md border border-neutral-300 px-2 py-1 text-sm disabled:bg-neutral-50 disabled:text-neutral-500';
  const factureReference =
    facture.factures_collectes.find(
      (fc) => fc.collectes?.evenements?.reference_affaire,
    )?.collectes?.evenements?.reference_affaire ?? null;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Link
          href="/admin/factures"
          className="text-neutral-500 hover:text-neutral-700"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-xl font-semibold">
          {facture.numero_facture ?? '— brouillon (numéro à attribuer) —'}
        </h1>
        <Badge variant="neutral">
          {STATUT_LABELS[facture.statut] ?? facture.statut}
        </Badge>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {facture.erreur_synchro && (
        <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          <strong>Erreur Pennylane :</strong> {facture.erreur_synchro}
        </div>
      )}

      {/* Bloc 1 — En-tête */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-neutral-700">
          Bloc 1 — En-tête
        </h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-neutral-500">Type</div>
            <div className="font-medium">
              {TYPE_LABELS[facture.type] ?? facture.type}
            </div>
          </div>
          <div>
            <div className="text-neutral-500">Organisation</div>
            <div className="font-medium">
              {facture.organisations?.raison_sociale ?? '—'}
            </div>
          </div>
          <div>
            <div className="text-neutral-500">Entité de facturation</div>
            <div className="font-medium">
              {facture.entites_facturation?.raison_sociale ?? '—'} ·{' '}
              {facture.entites_facturation?.siret ?? 'SIRET —'}
            </div>
          </div>
          <div>
            <div className="text-neutral-500">SIRET vérification</div>
            <div className="font-medium">
              {facture.entites_facturation?.siret_verification ?? '—'}
            </div>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-neutral-500">Date d’émission</span>
            <input
              type="date"
              className={inputCls}
              value={dateEmission}
              disabled={!isBrouillon}
              onChange={(e) => setDateEmission(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-neutral-500">Date d’échéance</span>
            <input
              type="date"
              className={inputCls}
              value={dateEcheance}
              disabled={!isBrouillon}
              onChange={(e) => setDateEcheance(e.target.value)}
            />
          </label>
        </div>
      </section>

      {/* Bloc 2 — Lignes */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-neutral-700">
          Bloc 2 — Lignes
        </h2>
        <div className="rounded-md border divide-y text-sm">
          {facture.factures_collectes.length === 0 && (
            <div className="px-4 py-3 text-neutral-500">Aucune ligne.</div>
          )}
          {facture.factures_collectes.map((fc) => (
            <LigneRow
              key={fc.id}
              ligne={fc}
              editable={isBrouillon}
              busy={actionLoading === `ligne-${fc.id}`}
              deleting={actionLoading === `del-${fc.id}`}
              onSave={(patch) => saveLigne(fc, patch)}
              onDelete={() => deleteLigne(fc)}
              fmt={fmt}
              inputCls={inputCls}
            />
          ))}
        </div>

        {/* Bloc 3 — Ajout de ligne libre */}
        {isBrouillon && (
          <div className="flex items-end gap-2 pt-2">
            <label className="flex flex-1 flex-col gap-1 text-sm">
              <span className="text-neutral-500">
                Désignation (ligne libre)
              </span>
              <input
                className={inputCls}
                value={newDesignation}
                onChange={(e) => setNewDesignation(e.target.value)}
                placeholder="Frais divers, remise…"
              />
            </label>
            <label className="flex w-32 flex-col gap-1 text-sm">
              <span className="text-neutral-500">Montant HT</span>
              <input
                type="number"
                step="0.01"
                className={inputCls}
                value={newMontant}
                onChange={(e) => setNewMontant(e.target.value)}
              />
            </label>
            <Button
              variant="secondary"
              onClick={addLigne}
              disabled={actionLoading === 'add'}
            >
              <Plus className="h-4 w-4 mr-1" /> Ajouter
            </Button>
          </div>
        )}
      </section>

      {/* Bloc 4 — Totaux */}
      <section className="space-y-1 text-sm">
        <h2 className="text-sm font-semibold text-neutral-700">
          Bloc 4 — Totaux
        </h2>
        <div className="flex justify-between">
          <span className="text-neutral-500">Total HT</span>
          <span className="font-medium">{fmt.format(facture.montant_ht)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-neutral-500">TVA</span>
          <span className="font-medium">{fmt.format(facture.montant_tva)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-neutral-500">Total TTC</span>
          <span className="font-semibold">
            {fmt.format(facture.montant_ttc)}
          </span>
        </div>
      </section>

      {/* Bloc 5 — Conditions / notes */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-neutral-700">
          Bloc 5 — Référence et conditions
        </h2>
        {/* Référence client = evenements.reference_affaire (transmise à Pennylane).
            Affichage seul en V1 : aucune colonne facture-level pour un override
            (ni schéma V1 ni DDL cible) — l'override serait une divergence à
            arbitrer avec Val. */}
        <div className="text-sm">
          <span className="text-neutral-500">Référence client : </span>
          <span className="font-medium">{factureReference ?? '—'}</span>
        </div>
        <textarea
          className={`${inputCls} w-full`}
          rows={3}
          value={notes}
          disabled={!isBrouillon}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Conditions de paiement, pénalités de retard, escompte…"
        />
        {isBrouillon && (
          <Button
            variant="secondary"
            onClick={saveHeader}
            disabled={actionLoading === 'header'}
          >
            <Save className="h-4 w-4 mr-1" />
            {actionLoading === 'header'
              ? 'Enregistrement…'
              : 'Enregistrer l’en-tête'}
          </Button>
        )}
      </section>

      {facture.pdf_url_pennylane && (
        <a
          href={facture.pdf_url_pennylane}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 text-sm text-primary-700 hover:underline"
        >
          Télécharger le PDF Pennylane
        </a>
      )}

      {/* Bloc 6 — Actions */}
      <section className="flex gap-3 border-t pt-4">
        {facture.statut === 'brouillon' && (
          <Button
            onClick={() => doAction('valider')}
            disabled={actionLoading !== null}
          >
            <Send className="h-4 w-4 mr-2" />
            {actionLoading === 'valider'
              ? 'Envoi…'
              : 'Valider et envoyer à Pennylane'}
          </Button>
        )}

        {facture.statut === 'en_attente_pennylane' && (
          <Button
            variant="secondary"
            onClick={() => doAction('renvoyer')}
            disabled={actionLoading !== null}
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            {actionLoading === 'renvoyer' ? 'Envoi…' : 'Renvoyer manuellement'}
          </Button>
        )}

        {['emise', 'payee'].includes(facture.statut) && (
          <Button
            variant="destructive"
            onClick={creerAvoir}
            disabled={actionLoading !== null}
          >
            <FileX className="h-4 w-4 mr-2" />
            {actionLoading === 'avoir' ? 'Création…' : 'Générer un avoir'}
          </Button>
        )}
      </section>
    </div>
  );
}

function LigneRow({
  ligne,
  editable,
  busy,
  deleting,
  onSave,
  onDelete,
  fmt,
  inputCls,
}: {
  ligne: Ligne;
  editable: boolean;
  busy: boolean;
  deleting: boolean;
  onSave: (patch: Record<string, unknown>) => void;
  onDelete: () => void;
  fmt: Intl.NumberFormat;
  inputCls: string;
}) {
  const [designation, setDesignation] = useState(
    ligne.libelle_ligne ?? ligne.designation ?? '',
  );
  const [pu, setPu] = useState(String(ligne.montant_ligne_ht));
  const [tva, setTva] = useState(String(ligne.taux_tva));

  if (!editable) {
    return (
      <div className="flex items-center justify-between px-4 py-2.5">
        <div className="text-neutral-700">
          {ligne.libelle_ligne ?? ligne.designation ?? 'Prestation Savr'}
        </div>
        <div className="font-medium text-neutral-900">
          {fmt.format(ligne.montant_ligne_ht * ligne.quantite)}
        </div>
      </div>
    );
  }

  const dirty =
    designation !== (ligne.libelle_ligne ?? ligne.designation ?? '') ||
    Number(pu) !== ligne.montant_ligne_ht ||
    Number(tva) !== ligne.taux_tva;

  return (
    <div className="flex items-end gap-2 px-4 py-2.5">
      <label className="flex flex-1 flex-col gap-1 text-xs text-neutral-500">
        Désignation
        <input
          className={inputCls}
          value={designation}
          onChange={(e) => setDesignation(e.target.value)}
        />
      </label>
      <label className="flex w-24 flex-col gap-1 text-xs text-neutral-500">
        PU HT
        <input
          type="number"
          step="0.01"
          className={inputCls}
          value={pu}
          onChange={(e) => setPu(e.target.value)}
        />
      </label>
      <label className="flex w-20 flex-col gap-1 text-xs text-neutral-500">
        TVA %
        <input
          type="number"
          step="0.1"
          className={inputCls}
          value={tva}
          onChange={(e) => setTva(e.target.value)}
        />
      </label>
      <Button
        variant="secondary"
        onClick={() =>
          onSave({
            designation,
            montant_ligne_ht: Number(pu),
            taux_tva: Number(tva),
          })
        }
        disabled={!dirty || busy}
      >
        {busy ? '…' : <Save className="h-4 w-4" />}
      </Button>
      <Button variant="ghost" onClick={onDelete} disabled={deleting}>
        <Trash2 className="h-4 w-4 text-red-600" />
      </Button>
    </div>
  );
}
