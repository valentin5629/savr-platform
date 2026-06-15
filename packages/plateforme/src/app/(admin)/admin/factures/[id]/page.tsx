'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Send, RotateCcw, FileX } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

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
  erreur_synchro: string | null;
  erreur_synchro_at: string | null;
  pdf_url_pennylane: string | null;
  pennylane_id: string | null;
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
  factures_collectes: Array<{
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
  }>;
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

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/v1/admin/factures/${id}`)
      .then((r) => r.json())
      .then((d: { data: FactureDetail }) => setFacture(d.data))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

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
          {facture.numero_facture ?? '— brouillon —'}
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
          <div className="text-neutral-500">SIRET facturé</div>
          <div className="font-medium">
            {facture.entites_facturation?.siret ?? '—'}
          </div>
        </div>
        <div>
          <div className="text-neutral-500">SIRET vérification</div>
          <div className="font-medium">
            {facture.entites_facturation?.siret_verification ?? '—'}
          </div>
        </div>
        <div>
          <div className="text-neutral-500">Date émission</div>
          <div className="font-medium">
            {facture.date_emission
              ? new Date(facture.date_emission).toLocaleDateString('fr-FR')
              : '—'}
          </div>
        </div>
        <div>
          <div className="text-neutral-500">Date paiement</div>
          <div className="font-medium">
            {facture.date_paiement
              ? new Date(facture.date_paiement).toLocaleDateString('fr-FR')
              : '—'}
          </div>
        </div>
        <div>
          <div className="text-neutral-500">Montant HT</div>
          <div className="font-medium">{fmt.format(facture.montant_ht)}</div>
        </div>
        <div>
          <div className="text-neutral-500">Montant TTC</div>
          <div className="font-semibold">{fmt.format(facture.montant_ttc)}</div>
        </div>
      </div>

      {facture.factures_collectes.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-neutral-700 mb-2">
            Lignes
          </h2>
          <div className="rounded-md border divide-y text-sm">
            {facture.factures_collectes.map((fc) => (
              <div
                key={fc.id}
                className="flex items-center justify-between px-4 py-2.5"
              >
                <div className="text-neutral-700">
                  {fc.libelle_ligne ?? fc.designation ?? 'Prestation Savr'}
                </div>
                <div className="text-neutral-900 font-medium">
                  {fmt.format(fc.montant_ligne_ht * fc.quantite)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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

      <div className="flex gap-3 pt-2">
        {facture.statut === 'brouillon' && (
          <Button
            onClick={() => doAction('valider')}
            disabled={actionLoading !== null}
          >
            <Send className="h-4 w-4 mr-2" />
            {actionLoading === 'valider'
              ? 'Envoi…'
              : 'Valider et envoyer Pennylane'}
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
            {actionLoading === 'avoir' ? 'Création…' : 'Créer un avoir'}
          </Button>
        )}
      </div>
    </div>
  );
}
