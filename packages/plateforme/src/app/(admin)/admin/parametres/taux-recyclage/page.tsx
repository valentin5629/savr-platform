'use client';

import { fmtPct } from '@/lib/format';
import { useEffect, useState } from 'react';
import { Recycle, Edit, History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Card } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { DataGrid, type ColumnDef } from '@/components/ui/data-grid';
import { useUserRole } from '@/lib/use-user-role';
import { OpsReadOnlyBanner } from '@/components/ui/ops-read-only-banner';
import { Heading } from '@/components/ui/heading';
import { Text } from '@/components/ui/text';
import { AlertBar } from '@/components/ui/alert-bar';
import { EmptyState } from '@/components/ui/empty-state';
import { FormActions } from '@/components/ui/form-actions';

interface TauxRecyclage {
  id: string;
  code_filiere: string;
  nom_filiere: string;
  taux_captation: number;
  prestataire: string | null;
  source_donnee: string | null;
  actif: boolean;
}

interface HistoryRow {
  id: string;
  taux_captation_avant: number;
  taux_captation_apres: number;
  prestataire_avant: string | null;
  prestataire_apres: string | null;
  source_donnee_avant: string | null;
  source_donnee_apres: string | null;
  commentaire_modif: string;
  modifie_par_nom: string;
  modifie_le: string;
}

interface ModalState {
  open: boolean;
  filiere: TauxRecyclage | null;
  taux: string;
  commentaire: string;
  saving: boolean;
  error: string | null;
}

interface HistState {
  open: boolean;
  filiere: TauxRecyclage | null;
  rows: HistoryRow[];
  loading: boolean;
}

const pct = (v: number) => fmtPct(v * 100, 2);

// Valeur avant → après seulement si elle a changé.
const avantApres = (avant: string | null, apres: string | null): string =>
  avant !== apres ? `${avant ?? '—'} → ${apres ?? '—'}` : (apres ?? '—');

// Historique des modifications d'une filière (lecture seule, CDC §9 l.796-800).
const COLONNES_HISTORIQUE: ColumnDef<HistoryRow, unknown>[] = [
  {
    id: 'date',
    header: 'Date',
    accessorFn: (r) => r.modifie_le,
    meta: { className: 'whitespace-nowrap text-savr-neutral-600' },
    cell: ({ row: { original: r } }) =>
      new Date(r.modifie_le).toLocaleDateString('fr-FR', {
        timeZone: 'Europe/Paris',
      }),
  },
  {
    id: 'modifie_par',
    header: 'Modifié par',
    accessorFn: (r) => r.modifie_par_nom,
    meta: { className: 'text-savr-neutral-700' },
    cell: ({ row: { original: r } }) => r.modifie_par_nom,
  },
  {
    id: 'taux',
    header: 'Taux',
    accessorFn: (r) => r.taux_captation_apres,
    meta: { className: 'whitespace-nowrap text-savr-neutral-700' },
    cell: ({ row: { original: r } }) => (
      <>
        {pct(r.taux_captation_avant)} → {pct(r.taux_captation_apres)}
      </>
    ),
  },
  {
    id: 'prestataire',
    header: 'Prestataire',
    accessorFn: (r) => r.prestataire_apres ?? '',
    meta: { className: 'text-savr-neutral-600' },
    cell: ({ row: { original: r } }) =>
      avantApres(r.prestataire_avant, r.prestataire_apres),
  },
  {
    id: 'source',
    header: 'Source',
    accessorFn: (r) => r.source_donnee_apres ?? '',
    meta: { className: 'text-savr-neutral-600' },
    cell: ({ row: { original: r } }) =>
      avantApres(r.source_donnee_avant, r.source_donnee_apres),
  },
  {
    id: 'commentaire',
    header: 'Commentaire',
    accessorFn: (r) => r.commentaire_modif,
    meta: { className: 'text-savr-neutral-600' },
    cell: ({ row: { original: r } }) => r.commentaire_modif,
  },
];

export default function TauxRecyclagePage() {
  const role = useUserRole();
  const canEdit = role === 'admin_savr';

  const [filieres, setFilieres] = useState<TauxRecyclage[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<ModalState>({
    open: false,
    filiere: null,
    taux: '',
    commentaire: '',
    saving: false,
    error: null,
  });
  const [hist, setHist] = useState<HistState>({
    open: false,
    filiere: null,
    rows: [],
    loading: false,
  });

  useEffect(() => {
    fetch('/api/v1/admin/parametres/taux-recyclage')
      .then((r) => r.json())
      .then((d: { data: TauxRecyclage[] }) => setFilieres(d.data))
      .finally(() => setLoading(false));
  }, []);

  const openModal = (filiere: TauxRecyclage) => {
    setModal({
      open: true,
      filiere,
      taux: String(filiere.taux_captation * 100),
      commentaire: '',
      saving: false,
      error: null,
    });
  };

  const closeModal = () =>
    setModal((m) => ({ ...m, open: false, filiere: null }));

  const openHistory = (filiere: TauxRecyclage) => {
    setHist({ open: true, filiere, rows: [], loading: true });
    fetch(
      `/api/v1/admin/parametres/taux-recyclage/${encodeURIComponent(filiere.id)}`,
    )
      .then((r) => r.json())
      .then((d: { data: HistoryRow[] }) =>
        setHist((h) => ({ ...h, rows: d.data ?? [], loading: false })),
      )
      .catch(() => setHist((h) => ({ ...h, loading: false })));
  };

  const closeHistory = () =>
    setHist((h) => ({ ...h, open: false, filiere: null }));

  const handleSave = async () => {
    if (!modal.filiere) return;
    setModal((m) => ({ ...m, saving: true, error: null }));

    const taux = parseFloat(modal.taux) / 100;
    const res = await fetch(
      `/api/v1/admin/parametres/taux-recyclage/${encodeURIComponent(modal.filiere.id)}`,
      {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          // CDC §9 l.783 : Idempotency-Key UUID v4 généré côté front.
          'idempotency-key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          taux_captation: taux,
          commentaire_modif: modal.commentaire,
        }),
      },
    );

    if (res.ok) {
      const updated = (await res.json()) as TauxRecyclage;
      setFilieres((prev) =>
        prev.map((f) => (f.id === updated.id ? updated : f)),
      );
      closeModal();
    } else {
      const body = (await res.json()) as { error: string };
      setModal((m) => ({ ...m, saving: false, error: body.error }));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Recycle className="h-6 w-6 text-savr-neutral-600" />
        <Heading level={1}>Paramètres — Taux de recyclage</Heading>
      </div>

      {!canEdit && <OpsReadOnlyBanner />}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filieres.map((f) => (
            <Card key={f.id} padding="lg" className="space-y-3">
              <div className="flex items-center justify-between">
                <Heading level={3} size="inherit" tone="strong">
                  {f.nom_filiere}
                </Heading>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => openHistory(f)}
                  >
                    <History />
                    Historique
                  </Button>
                  {canEdit && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => openModal(f)}
                    >
                      <Edit />
                      Modifier
                    </Button>
                  )}
                </div>
              </div>
              <div className="flex items-end gap-2">
                <span className="text-3xl font-bold text-savr-neutral-900">
                  {fmtPct(f.taux_captation * 100, 1)}
                </span>
                <Text as="span" className="mb-1">
                  taux de captation
                </Text>
              </div>
              {f.prestataire && <Text>Prestataire : {f.prestataire}</Text>}
              {f.source_donnee && (
                <Text variant="faint">Source : {f.source_donnee}</Text>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Modal modification */}
      {/* Modale DS (§10 §6) : croix, Échap et clic extérieur ferment. */}
      <Modal
        open={modal.open && modal.filiere !== null}
        title={`Modifier — ${modal.filiere?.nom_filiere ?? ''}`}
        onClose={closeModal}
        footer={
          <FormActions
            cancel={{ label: 'Annuler', onClick: closeModal }}
            submit={{
              label: 'Enregistrer',
              onClick: () => void handleSave(),
              disabled: modal.commentaire.length < 5,
            }}
            loading={modal.saving}
            loadingText="Enregistrement…"
          />
        }
      >
        <div className="space-y-3">
          <FormField
            label="Taux de captation (%)"
            htmlFor="taux-recyclage-captation"
          >
            <Input
              id="taux-recyclage-captation"
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={modal.taux}
              onChange={(e) =>
                setModal((m) => ({ ...m, taux: e.target.value }))
              }
            />
          </FormField>
          <FormField
            label="Commentaire de modification (obligatoire)"
            htmlFor="taux-recyclage-commentaire"
          >
            <Textarea
              id="taux-recyclage-commentaire"
              className="resize-none"
              rows={3}
              placeholder="Motif de la modification…"
              value={modal.commentaire}
              onChange={(e) =>
                setModal((m) => ({ ...m, commentaire: e.target.value }))
              }
            />
          </FormField>
          {modal.error && (
            <AlertBar variant="err" className="font-normal">
              {modal.error}
            </AlertBar>
          )}
        </div>
      </Modal>

      {/* Modal historique (lecture seule — CDC §9 l.796-800) */}
      <Modal
        open={hist.open && hist.filiere !== null}
        title={`Historique — ${hist.filiere?.nom_filiere ?? ''}`}
        onClose={closeHistory}
        wide
      >
        {/* Historique complet d'une filière (route sans pagination,
                  triée par date desc) → tri navigateur. */}
        <DataGrid
          columnsToggle={false}
          columns={COLONNES_HISTORIQUE}
          data={hist.rows}
          getRowId={(r) => r.id}
          loading={hist.loading}
          empty={
            <EmptyState
              size="inline"
              title="Aucune modification enregistrée."
            />
          }
        />
      </Modal>
    </div>
  );
}
