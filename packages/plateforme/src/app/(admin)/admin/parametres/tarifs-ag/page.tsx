'use client';

import { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { DataGrid, type ColumnDef } from '@/components/ui/data-grid';
import { Badge } from '@/components/ui/badge';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { DatePicker } from '@/components/ui/date-picker';
import { useUserRole } from '@/lib/use-user-role';
import { OpsReadOnlyBanner } from '@/components/ui/ops-read-only-banner';
import { formatDateParis, jourParis } from '@savr/shared/src/temps/index.js';
import { Heading } from '@/components/ui/heading';
import { Text } from '@/components/ui/text';

interface TarifPackAG {
  id: string;
  type_pack: string;
  credits: number;
  prix_unitaire_ht: number;
  montant_total_ht: number;
  mensualisable: boolean;
  nb_mensualites: number | null;
  valide_du: string;
  valide_jusqu_au: string | null;
}

interface TarifHistoryRow extends TarifPackAG {
  modifie_par_nom: string;
  date_modif: string;
}

interface HistState {
  open: boolean;
  type: string | null;
  rows: TarifHistoryRow[];
  loading: boolean;
}

const TYPE_LABELS: Record<string, string> = {
  unitaire: 'Unitaire (1 collecte)',
  pack_10: 'Pack 10 collectes',
  pack_30: 'Pack 30 collectes',
  pack_60: 'Pack 60 collectes',
};

const TYPES_PACK = ['unitaire', 'pack_10', 'pack_30', 'pack_60'] as const;

const eurosHt = (v: number): string =>
  `${v.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} €`;

// Versions d'une grille de tarif pack AG (lecture seule, CDC §9 l.726-729).
const COLONNES_HISTORIQUE: ColumnDef<TarifHistoryRow, unknown>[] = [
  {
    id: 'credits',
    header: 'Crédits',
    accessorFn: (r) => r.credits,
    cell: ({ row: { original: r } }) => r.credits,
  },
  {
    id: 'prix_unitaire_ht',
    header: 'Prix unit. HT',
    accessorFn: (r) => r.prix_unitaire_ht,
    cell: ({ row: { original: r } }) => eurosHt(r.prix_unitaire_ht),
  },
  {
    id: 'montant_total_ht',
    header: 'Total HT',
    accessorFn: (r) => r.montant_total_ht,
    cell: ({ row: { original: r } }) => eurosHt(r.montant_total_ht),
  },
  {
    id: 'mensualisable',
    header: 'Mensualisable',
    accessorFn: (r) => (r.mensualisable ? 1 : 0),
    cell: ({ row: { original: r } }) =>
      r.mensualisable
        ? `Oui${r.nb_mensualites ? ` (${r.nb_mensualites}×)` : ''}`
        : 'Non',
  },
  {
    id: 'validite',
    header: 'Validité',
    accessorFn: (r) => r.valide_du,
    meta: { className: 'whitespace-nowrap' },
    cell: ({ row: { original: r } }) =>
      `${formatDateParis(r.valide_du)}${r.valide_jusqu_au ? ` → ${formatDateParis(r.valide_jusqu_au)}` : ' → …'}`,
  },
  {
    id: 'modifie_par',
    header: 'Modifié par',
    accessorFn: (r) => r.modifie_par_nom,
    cell: ({ row: { original: r } }) => r.modifie_par_nom,
  },
  {
    id: 'date_modif',
    header: 'Date modif',
    accessorFn: (r) => r.date_modif,
    meta: { className: 'whitespace-nowrap' },
    cell: ({ row: { original: r } }) => formatDateParis(r.date_modif),
  },
];

export default function TarifsPacksAGPage() {
  const role = useUserRole();
  const canEdit = role === 'admin_savr';

  const [tarifs, setTarifs] = useState<TarifPackAG[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [hist, setHist] = useState<HistState>({
    open: false,
    type: null,
    rows: [],
    loading: false,
  });

  const openHistory = (type: string) => {
    setHist({ open: true, type, rows: [], loading: true });
    fetch(`/api/v1/admin/tarifs-packs-ag/history?type_pack=${type}`)
      .then((r) => r.json())
      .then((d: { data: TarifHistoryRow[] }) =>
        setHist((h) => ({ ...h, rows: d.data ?? [], loading: false })),
      )
      .catch(() => setHist((h) => ({ ...h, loading: false })));
  };
  const closeHistory = () =>
    setHist((h) => ({ ...h, open: false, type: null }));

  // Form state
  const [fType, setFType] = useState<string>('pack_10');
  const [fCredits, setFCredits] = useState(10);
  const [fPrix, setFPrix] = useState('');
  const [fMensualisable, setFMensualisable] = useState(false);
  const [fNbMensualites, setFNbMensualites] = useState(12);
  const [fValideDu, setFValideDu] = useState('');

  async function loadTarifs() {
    setLoading(true);
    const r = await fetch('/api/v1/admin/tarifs-packs-ag');
    const d = (await r.json()) as { data: TarifPackAG[] };
    setTarifs(d.data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void loadTarifs();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      const r = await fetch('/api/v1/admin/tarifs-packs-ag', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type_pack: fType,
          credits: fCredits,
          prix_unitaire_ht: parseFloat(fPrix),
          mensualisable: fMensualisable,
          nb_mensualites: fMensualisable ? fNbMensualites : undefined,
          valide_du: fValideDu,
        }),
      });
      const data = (await r.json()) as { error?: string };
      if (!r.ok) {
        setFormError(data.error ?? 'Erreur');
        return;
      }
      setModal(false);
      await loadTarifs();
    } finally {
      setSubmitting(false);
    }
  }

  const openModal = (type?: string) => {
    const preset: Record<string, number> = {
      unitaire: 1,
      pack_10: 10,
      pack_30: 30,
      pack_60: 60,
    };
    const t = type ?? 'pack_10';
    setFType(t);
    setFCredits(preset[t] ?? 10);
    setFPrix('');
    setFMensualisable(false);
    setFNbMensualites(12);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setFValideDu(jourParis(tomorrow));
    setFormError(null);
    setModal(true);
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  // Grouper par type_pack pour affichage
  const byType = TYPES_PACK.map((t) => ({
    type: t,
    label: TYPE_LABELS[t] ?? t,
    tarif: tarifs.find((ta) => ta.type_pack === t),
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Heading level={1} weight="semibold" tone="primary-deep">
            Tarifs packs AG
          </Heading>
          <Text className="mt-1">
            Tarifs actifs par type de pack. La modification ferme la ligne
            précédente et ouvre une nouvelle version.
          </Text>
        </div>
        {canEdit && <Button onClick={() => openModal()}>Nouveau tarif</Button>}
      </div>

      {!canEdit && <OpsReadOnlyBanner />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {byType.map(({ type, label, tarif }) => (
          <Card key={type} className="p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <Heading
                  level={3}
                  size="inherit"
                  weight="medium"
                  tone="inherit"
                >
                  {label}
                </Heading>
                <Text variant="faint" className="mt-0.5">
                  {type}
                </Text>
              </div>
              {tarif ? (
                <Badge variant="success" className="text-xs">
                  Actif depuis{' '}
                  {new Date(tarif.valide_du).toLocaleDateString('fr-FR', {
                    timeZone: 'Europe/Paris',
                  })}
                </Badge>
              ) : (
                <Badge variant="neutral" className="text-xs">
                  Aucun tarif
                </Badge>
              )}
            </div>
            {tarif ? (
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-savr-neutral-500">Crédits</span>
                  <span className="font-medium">{tarif.credits}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-savr-neutral-500">
                    Prix unitaire HT
                  </span>
                  <span className="font-medium">
                    {tarif.prix_unitaire_ht.toLocaleString('fr-FR', {
                      minimumFractionDigits: 2,
                    })}{' '}
                    €
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-savr-neutral-500">
                    Montant total HT
                  </span>
                  <span className="font-medium text-savr-primary-700">
                    {tarif.montant_total_ht.toLocaleString('fr-FR', {
                      minimumFractionDigits: 2,
                    })}{' '}
                    €
                  </span>
                </div>
                {tarif.mensualisable && tarif.nb_mensualites && (
                  <div className="flex justify-between">
                    <span className="text-savr-neutral-500">
                      Mensualisation
                    </span>
                    <span>
                      {tarif.nb_mensualites} ×{' '}
                      {(
                        tarif.montant_total_ht / tarif.nb_mensualites
                      ).toLocaleString('fr-FR', {
                        minimumFractionDigits: 2,
                      })}{' '}
                      €
                    </span>
                  </div>
                )}
                <div className="pt-2 flex gap-2">
                  {canEdit && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => openModal(type)}
                    >
                      Modifier le tarif
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => openHistory(type)}
                  >
                    <History className="h-4 w-4 mr-1" />
                    Historique
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                {canEdit && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => openModal(type)}
                  >
                    Définir un tarif
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => openHistory(type)}
                >
                  <History className="h-4 w-4 mr-1" />
                  Historique
                </Button>
              </div>
            )}
          </Card>
        ))}
      </div>

      {/* Modale de création (DS §10 §6) : croix, Échap et clic extérieur
          ferment ; le formulaire (boutons inclus) reste dans le corps. */}
      <Modal
        open={modal}
        title={`Nouveau tarif — ${TYPE_LABELS[fType] ?? fType}`}
        onClose={() => setModal(false)}
      >
        {formError && (
          <div className="mb-4 rounded-savr-md border border-savr-error/40 bg-savr-error-subtle px-4 py-2 text-sm text-savr-error-strong">
            {formError}
          </div>
        )}

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <FormField label="Type de pack" htmlFor="tarif-ag-type">
            <Combobox
              id="tarif-ag-type"
              icon={null}
              options={TYPES_PACK.map((t) => ({
                value: t,
                label: TYPE_LABELS[t] ?? t,
              }))}
              value={fType}
              onChange={(t) => {
                const preset: Record<string, number> = {
                  unitaire: 1,
                  pack_10: 10,
                  pack_30: 30,
                  pack_60: 60,
                };
                setFType(t);
                if (preset[t]) setFCredits(preset[t]);
              }}
            />
          </FormField>
          <FormField
            label="Nombre de crédits"
            htmlFor="tarif-ag-credits"
            required
          >
            <Input
              id="tarif-ag-credits"
              type="number"
              min={1}
              value={fCredits}
              onChange={(e) => setFCredits(parseInt(e.target.value) || 1)}
              required
            />
          </FormField>
          <FormField
            label="Prix unitaire HT (€ / collecte)"
            htmlFor="tarif-ag-prix"
            required
            hint={
              fPrix && fCredits > 0
                ? `Total HT : ${(parseFloat(fPrix) * fCredits).toLocaleString(
                    'fr-FR',
                    {
                      minimumFractionDigits: 2,
                    },
                  )} €`
                : undefined
            }
          >
            <Input
              id="tarif-ag-prix"
              type="number"
              min={0}
              step="0.01"
              value={fPrix}
              onChange={(e) => setFPrix(e.target.value)}
              placeholder="ex : 130.00"
              required
            />
          </FormField>
          <FormField
            label="Date d'entrée en vigueur"
            htmlFor="tarif-ag-valide-du"
            required
          >
            <DatePicker
              id="tarif-ag-valide-du"
              value={fValideDu}
              onChange={setFValideDu}
              required
            />
          </FormField>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="mensualisable"
              checked={fMensualisable}
              onChange={(e) => setFMensualisable(e.target.checked)}
              className="rounded-savr-sm"
            />
            <label htmlFor="mensualisable" className="text-sm">
              Mensualisation disponible
            </label>
          </div>
          {fMensualisable && (
            <FormField
              label="Nombre de mensualités"
              htmlFor="tarif-ag-mensualites"
            >
              <Input
                id="tarif-ag-mensualites"
                type="number"
                min={2}
                max={24}
                value={fNbMensualites}
                onChange={(e) =>
                  setFNbMensualites(parseInt(e.target.value) || 12)
                }
              />
            </FormField>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setModal(false)}
              disabled={submitting}
            >
              Annuler
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Enregistrement…' : 'Publier le tarif'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modale historique (versions de la grille — lecture seule, CDC §9 l.726-729) */}
      <Modal
        open={hist.open && hist.type !== null}
        title={`Historique — ${hist.type ? (TYPE_LABELS[hist.type] ?? hist.type) : ''}`}
        onClose={closeHistory}
        wide
      >
        {/* Historique complet d'un type de pack (route sans pagination,
                  triée par date de validité desc) → tri navigateur. */}
        <DataGrid
          columns={COLONNES_HISTORIQUE}
          data={hist.rows}
          getRowId={(r) => r.id}
          loading={hist.loading}
          empty={<Text>Aucune version enregistrée.</Text>}
        />
      </Modal>
    </div>
  );
}
