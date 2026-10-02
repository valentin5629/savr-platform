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
  Download,
} from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { DatePicker } from '@/components/ui/date-picker';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { tempsEcouleFr } from '@/lib/facturation/facture-ui';
import { Heading } from '@/components/ui/heading';
import { Text } from '@/components/ui/text';
import { fmtMontant } from '@/lib/format';
import { TextLink } from '@/components/ui/text-link';
import { useConfirm } from '@/components/ui/confirm-dialog';

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
  derniere_tentative_pennylane_at: string | null;
  pdf_url_pennylane: string | null;
  pdf_url_savr: string | null;
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
    fetch(`/api/v1/admin/factures/${encodeURIComponent(id)}`)
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
      const res = await fetch(
        `/api/v1/admin/factures/${encodeURIComponent(id)}/${encodeURIComponent(action)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
        },
      );
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

  // Télécharge la copie de travail PDF (§06.08 §1) via URL pré-signée R2.
  async function downloadPdfSavr() {
    setError(null);
    const res = await fetch(
      `/api/v1/admin/factures/${encodeURIComponent(id)}/pdf-savr/download`,
    );
    if (!res.ok) {
      setError('PDF de travail indisponible.');
      return;
    }
    const { url } = (await res.json()) as { url?: string };
    if (url) window.open(url, '_blank');
  }

  // Appels d'édition (PATCH/POST/DELETE) — affichent l'erreur API + rechargent.
  // `segments` = les segments de chemin APRÈS l'id de facture, jamais un chemin
  // déjà composé : c'est ici — et ici seulement — qu'ils sont encodés, sinon un
  // `../` dans un id adresserait un autre endpoint same-origin (cf. gate
  // `pnpm check:fetch-path-encoding`).
  async function callEdit(
    segments: string[],
    method: 'PATCH' | 'POST' | 'DELETE',
    body?: Record<string, unknown>,
    key = 'edit',
  ) {
    setActionLoading(key);
    setError(null);
    const suffixe = segments.map((s) => `/${encodeURIComponent(s)}`).join('');
    try {
      const res = await fetch(
        `/api/v1/admin/factures/${encodeURIComponent(id)}${suffixe}`,
        {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
        },
      );
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
      [],
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
    await callEdit(['lignes', ligne.id], 'PATCH', patch, `ligne-${ligne.id}`);
  }

  const { confirmer, dialogue } = useConfirm();
  async function deleteLigne(ligne: Ligne) {
    if (
      !(await confirmer({
        title: 'Supprimer cette ligne ?',
        confirmLabel: 'Supprimer',
        variant: 'destructive',
      }))
    )
      return;
    await callEdit(
      ['lignes', ligne.id],
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
      ['lignes'],
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

  if (loading) return <Text as="div">Chargement…</Text>;
  if (!facture) return <Text as="div">Facture introuvable.</Text>;

  const fmt = (n: number): string => fmtMontant(n, facture.devise);
  const factureReference =
    facture.factures_collectes.find(
      (fc) => fc.collectes?.evenements?.reference_affaire,
    )?.collectes?.evenements?.reference_affaire ?? null;

  return (
    <div className="space-y-6 max-w-3xl">
      {dialogue}
      <div className="flex items-center gap-3">
        <Link
          href="/admin/factures"
          className="text-savr-neutral-500 hover:text-savr-neutral-700"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <Heading level={1} size="xl" weight="semibold" tone="inherit">
          {facture.numero_facture ?? '— brouillon (numéro à attribuer) —'}
        </Heading>
        <Badge variant="neutral">
          {STATUT_LABELS[facture.statut] ?? facture.statut}
        </Badge>
      </div>

      {error && (
        <div className="rounded-savr-md bg-savr-error-subtle border border-savr-error-soft px-4 py-3 text-sm text-savr-error-strong">
          {error}
        </div>
      )}

      {/* Bandeau SLA Pennylane §06.08 §2.3 — en_attente_pennylane : « dernier essai
          il y a Xmin » + bouton Renvoyer. echec_final (retry épuisé) = intervention. */}
      {/* ds-classes: valeur unique (orange-50/300/800, hors sémantique warning), à arbitrer — encart remplacé par AlertBar en R-UI-1 */}
      {facture.statut === 'en_attente_pennylane' && (
        <div className="rounded-savr-md bg-orange-50 border border-orange-300 px-4 py-3 text-sm text-orange-800 flex items-start justify-between gap-4">
          <div>
            <strong>En attente d’envoi Pennylane</strong>
            {facture.derniere_tentative_pennylane_at && (
              <>
                {' '}
                — dernier essai :{' '}
                {tempsEcouleFr(
                  facture.derniere_tentative_pennylane_at,
                  Date.now(),
                )}
              </>
            )}
            {facture.pennylane_statut === 'echec_final' && (
              <div className="mt-1 font-medium">
                Échec après 3 tentatives — renvoi manuel requis.
              </div>
            )}
            {/* ds-classes: valeur unique (orange-700), à arbitrer */}
            {facture.erreur_synchro && (
              <div className="mt-1 text-orange-700">
                {facture.erreur_synchro}
              </div>
            )}
          </div>
          <Button
            variant="secondary"
            onClick={() => doAction('renvoyer')}
            disabled={actionLoading !== null}
            loading={actionLoading === 'renvoyer'}
            loadingText="Envoi…"
          >
            <RotateCcw /> Renvoyer
          </Button>
        </div>
      )}

      {/* ds-classes: valeur unique (border amber-200), à arbitrer — encart remplacé par AlertBar en R-UI-1 */}
      {facture.statut !== 'en_attente_pennylane' && facture.erreur_synchro && (
        <div className="rounded-savr-md bg-savr-warning-subtle border border-amber-200 px-4 py-3 text-sm text-savr-warning-deep">
          <strong>Erreur Pennylane :</strong> {facture.erreur_synchro}
        </div>
      )}

      {/* Bloc 1 — En-tête */}
      <section className="space-y-3">
        <Heading level={2} size="sm" tone="muted">
          Bloc 1 — En-tête
        </Heading>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-savr-neutral-500">Type</div>
            <div className="font-medium">
              {TYPE_LABELS[facture.type] ?? facture.type}
            </div>
          </div>
          <div>
            <div className="text-savr-neutral-500">Organisation</div>
            <div className="font-medium">
              {facture.organisations?.raison_sociale ?? '—'}
            </div>
          </div>
          <div>
            <div className="text-savr-neutral-500">Entité de facturation</div>
            <div className="font-medium">
              {facture.entites_facturation?.raison_sociale ?? '—'} ·{' '}
              {facture.entites_facturation?.siret ?? 'SIRET —'}
            </div>
          </div>
          <div>
            <div className="text-savr-neutral-500">SIRET vérification</div>
            <div className="font-medium">
              {facture.entites_facturation?.siret_verification ?? '—'}
            </div>
          </div>
          <FormField label="Date d’émission" htmlFor="facture-date-emission">
            <DatePicker
              id="facture-date-emission"
              data-testid="facture-date-emission"
              value={dateEmission}
              disabled={!isBrouillon}
              onChange={setDateEmission}
            />
          </FormField>
          <FormField label="Date d’échéance" htmlFor="facture-date-echeance">
            <DatePicker
              id="facture-date-echeance"
              data-testid="facture-date-echeance"
              value={dateEcheance}
              disabled={!isBrouillon}
              onChange={setDateEcheance}
            />
          </FormField>
        </div>
      </section>

      {/* Bloc 2 — Lignes */}
      <section className="space-y-2">
        <Heading level={2} size="sm" tone="muted">
          Bloc 2 — Lignes
        </Heading>
        <div className="rounded-savr-md border divide-y text-sm">
          {facture.factures_collectes.length === 0 && (
            <div className="px-4 py-3 text-savr-neutral-500">Aucune ligne.</div>
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
            />
          ))}
        </div>

        {/* Bloc 3 — Ajout de ligne libre */}
        {isBrouillon && (
          <div className="flex items-end gap-2 pt-2">
            <FormField
              label="Désignation (ligne libre)"
              htmlFor="nouvelle-ligne-designation"
              className="flex-1"
            >
              <Input
                id="nouvelle-ligne-designation"
                value={newDesignation}
                onChange={(e) => setNewDesignation(e.target.value)}
                placeholder="Frais divers, remise…"
              />
            </FormField>
            <FormField
              label="Montant HT"
              htmlFor="nouvelle-ligne-montant"
              className="w-32"
            >
              <Input
                id="nouvelle-ligne-montant"
                type="number"
                step="0.01"
                value={newMontant}
                onChange={(e) => setNewMontant(e.target.value)}
              />
            </FormField>
            <Button
              variant="secondary"
              onClick={addLigne}
              loading={actionLoading === 'add'}
            >
              <Plus /> Ajouter
            </Button>
          </div>
        )}
      </section>

      {/* Bloc 4 — Totaux */}
      <section className="space-y-1 text-sm">
        <Heading level={2} size="sm" tone="muted">
          Bloc 4 — Totaux
        </Heading>
        <div className="flex justify-between">
          <span className="text-savr-neutral-500">Total HT</span>
          <span className="font-medium">{fmt(facture.montant_ht)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-savr-neutral-500">TVA</span>
          <span className="font-medium">{fmt(facture.montant_tva)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-savr-neutral-500">Total TTC</span>
          <span className="font-semibold">{fmt(facture.montant_ttc)}</span>
        </div>
      </section>

      {/* Bloc 5 — Conditions / notes */}
      <section className="space-y-2">
        <Heading level={2} size="sm" tone="muted">
          Bloc 5 — Référence et conditions
        </Heading>
        {/* Référence client = evenements.reference_affaire (transmise à Pennylane).
            Affichage seul en V1 : aucune colonne facture-level pour un override
            (ni schéma V1 ni DDL cible) — l'override serait une divergence à
            arbitrer avec Val. */}
        <div className="text-sm">
          <span className="text-savr-neutral-500">Référence client : </span>
          <span className="font-medium">{factureReference ?? '—'}</span>
        </div>
        <FormField label="Conditions et notes" htmlFor="facture-notes">
          <Textarea
            id="facture-notes"
            rows={3}
            value={notes}
            disabled={!isBrouillon}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Conditions de paiement, pénalités de retard, escompte…"
          />
        </FormField>
        {isBrouillon && (
          <Button
            variant="secondary"
            onClick={saveHeader}
            loading={actionLoading === 'header'}
            loadingText="Enregistrement…"
          >
            <Save /> Enregistrer l’en-tête
          </Button>
        )}
      </section>

      <div className="flex flex-wrap gap-4">
        {facture.pdf_url_pennylane && (
          <TextLink
            href={facture.pdf_url_pennylane}
            external
            target="_blank"
            rel="noreferrer"
            className="gap-2 text-sm"
          >
            Télécharger le PDF Pennylane
          </TextLink>
        )}
        {/* Copie de travail §06.08 §1 — clé R2 pré-signée à la volée. */}
        {facture.pdf_url_savr && (
          <TextLink onClick={downloadPdfSavr} className="gap-2 text-sm">
            <Download className="h-4 w-4" />
            Télécharger le PDF Savr (copie de travail)
          </TextLink>
        )}
      </div>

      {/* Bloc 6 — Actions */}
      <section className="flex gap-3 border-t pt-4">
        {facture.statut === 'brouillon' && (
          <Button
            onClick={() => doAction('valider')}
            disabled={actionLoading !== null}
            loading={actionLoading === 'valider'}
            loadingText="Envoi…"
          >
            <Send /> Valider et envoyer à Pennylane
          </Button>
        )}

        {/* Renvoi manuel §06.08 §2.3 : porté par le bandeau orange en_attente_pennylane
            (ci-dessus), pas de doublon dans le Bloc Actions. */}

        {['emise', 'payee'].includes(facture.statut) && (
          <Button
            variant="destructive"
            onClick={creerAvoir}
            disabled={actionLoading !== null}
            loading={actionLoading === 'avoir'}
            loadingText="Création…"
          >
            <FileX /> Générer un avoir
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
}: {
  ligne: Ligne;
  editable: boolean;
  busy: boolean;
  deleting: boolean;
  onSave: (patch: Record<string, unknown>) => void;
  onDelete: () => void;
  fmt: (n: number) => string;
}) {
  const [designation, setDesignation] = useState(
    ligne.libelle_ligne ?? ligne.designation ?? '',
  );
  const [pu, setPu] = useState(String(ligne.montant_ligne_ht));
  const [tva, setTva] = useState(String(ligne.taux_tva));

  if (!editable) {
    return (
      <div className="flex items-center justify-between px-4 py-2.5">
        <div className="text-savr-neutral-700">
          {ligne.libelle_ligne ?? ligne.designation ?? 'Prestation Savr'}
        </div>
        <div className="font-medium text-savr-neutral-900">
          {fmt(ligne.montant_ligne_ht * ligne.quantite)}
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
      <FormField
        label="Désignation"
        htmlFor={`ligne-${ligne.id}-designation`}
        className="flex-1"
      >
        <Input
          id={`ligne-${ligne.id}-designation`}
          value={designation}
          onChange={(e) => setDesignation(e.target.value)}
        />
      </FormField>
      <FormField
        label="PU HT"
        htmlFor={`ligne-${ligne.id}-pu`}
        className="w-24"
      >
        <Input
          id={`ligne-${ligne.id}-pu`}
          type="number"
          step="0.01"
          value={pu}
          onChange={(e) => setPu(e.target.value)}
        />
      </FormField>
      <FormField
        label="TVA %"
        htmlFor={`ligne-${ligne.id}-tva`}
        className="w-20"
      >
        <Input
          id={`ligne-${ligne.id}-tva`}
          type="number"
          step="0.1"
          value={tva}
          onChange={(e) => setTva(e.target.value)}
        />
      </FormField>
      <IconButton
        size="sm"
        aria-label="Enregistrer la ligne"
        onClick={() =>
          onSave({
            designation,
            montant_ligne_ht: Number(pu),
            taux_tva: Number(tva),
          })
        }
        disabled={!dirty}
        loading={busy}
      >
        <Save />
      </IconButton>
      <IconButton
        size="sm"
        variant="destructive"
        aria-label="Supprimer la ligne"
        onClick={onDelete}
        loading={deleting}
      >
        <Trash2 />
      </IconButton>
    </div>
  );
}
