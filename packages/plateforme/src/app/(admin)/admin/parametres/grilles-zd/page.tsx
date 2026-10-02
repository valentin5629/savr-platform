'use client';

import { useEffect, useState } from 'react';
import { Table2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DataGrid, type ColumnDef } from '@/components/ui/data-grid';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { DatePicker } from '@/components/ui/date-picker';
import { useUserRole } from '@/lib/use-user-role';
import { OpsReadOnlyBanner } from '@/components/ui/ops-read-only-banner';
import { jourParis } from '@savr/shared/src/temps/index.js';
import { PageHeader } from '@/components/ui/page-header';
import { Text } from '@/components/ui/text';

type Mode = 'paliers' | 'fixe_variable';

interface Palier {
  id: string;
  pax_min: number;
  pax_max: number | null;
  prix_base_ht: number;
  prix_par_couvert_ht: number | null;
}

interface Grille {
  id: string;
  nom: string;
  description: string | null;
  mode: Mode;
  est_defaut: boolean;
  actif: boolean;
  valide_du: string;
  valide_jusqu: string | null;
  nb_organisations: number;
  tarifs_zero_dechet: Palier[];
}

interface PalierForm {
  pax_min: string;
  pax_max: string;
  prix_base_ht: string;
  prix_par_couvert_ht: string;
}

const MODE_LABELS: Record<Mode, string> = {
  paliers: 'Paliers (montant fixe)',
  fixe_variable: 'Fixe + variable (€/pax)',
};

const COLONNES_GRILLES: ColumnDef<Grille, unknown>[] = [
  {
    id: 'nom',
    header: 'Nom',
    accessorFn: (g) => g.nom,
    meta: { className: 'font-medium text-savr-neutral-800' },
    cell: ({ row: { original: g } }) => g.nom,
  },
  {
    id: 'mode',
    header: 'Mode',
    accessorFn: (g) => MODE_LABELS[g.mode],
    meta: { className: 'text-savr-neutral-600' },
    cell: ({ row: { original: g } }) => MODE_LABELS[g.mode],
  },
  {
    id: 'defaut',
    header: 'Défaut',
    // Grilles par défaut regroupées en tête au tri décroissant.
    accessorFn: (g) => (g.est_defaut ? 1 : 0),
    cell: ({ row: { original: g } }) =>
      g.est_defaut ? <Badge variant="success">Par défaut</Badge> : null,
  },
  {
    id: 'validite',
    header: 'Validité',
    accessorFn: (g) => g.valide_du,
    meta: { className: 'text-savr-neutral-600' },
    cell: ({ row: { original: g } }) => (
      <>
        {g.valide_du}
        {g.valide_jusqu ? ` → ${g.valide_jusqu}` : ' → …'}
      </>
    ),
  },
  {
    id: 'organisations',
    header: 'Organisations',
    accessorFn: (g) => g.nb_organisations,
    meta: { className: 'text-right text-savr-neutral-700' },
    cell: ({ row: { original: g } }) => g.nb_organisations,
  },
];

const emptyPalier = (): PalierForm => ({
  pax_min: '',
  pax_max: '',
  prix_base_ht: '',
  prix_par_couvert_ht: '',
});

export default function GrillesZdPage() {
  const role = useUserRole();
  const canEdit = role === 'admin_savr';

  const [grilles, setGrilles] = useState<Grille[]>([]);
  const [loading, setLoading] = useState(true);

  const [modal, setModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [fNom, setFNom] = useState('');
  const [fMode, setFMode] = useState<Mode>('paliers');
  const [fDefaut, setFDefaut] = useState(false);
  const [fValideDu, setFValideDu] = useState('');
  const [fPaliers, setFPaliers] = useState<PalierForm[]>([emptyPalier()]);

  async function load() {
    setLoading(true);
    const r = await fetch('/api/v1/admin/grilles-tarifaires-zd');
    const d = (await r.json()) as { data: Grille[] };
    setGrilles(d.data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  const openModal = () => {
    setFNom('');
    setFMode('paliers');
    setFDefaut(false);
    setFValideDu(jourParis());
    setFPaliers([emptyPalier()]);
    setFormError(null);
    setModal(true);
  };

  const addPalier = () => setFPaliers((p) => [...p, emptyPalier()]);
  const removePalier = (i: number) =>
    setFPaliers((p) => (p.length > 1 ? p.filter((_, idx) => idx !== i) : p));
  const setPalier = (i: number, key: keyof PalierForm, value: string) =>
    setFPaliers((p) =>
      p.map((pl, idx) => (idx === i ? { ...pl, [key]: value } : pl)),
    );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      const paliers = fPaliers.map((pl) => ({
        pax_min: Number(pl.pax_min),
        pax_max: pl.pax_max === '' ? null : Number(pl.pax_max),
        prix_base_ht: pl.prix_base_ht === '' ? 0 : Number(pl.prix_base_ht),
        prix_par_couvert_ht:
          fMode === 'fixe_variable' && pl.prix_par_couvert_ht !== ''
            ? Number(pl.prix_par_couvert_ht)
            : 0,
      }));
      const r = await fetch('/api/v1/admin/grilles-tarifaires-zd', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          nom: fNom,
          mode: fMode,
          est_defaut: fDefaut,
          valide_du: fValideDu,
          paliers,
        }),
      });
      const data = (await r.json()) as { error?: string };
      if (!r.ok) {
        setFormError(data.error ?? 'Erreur à la création');
        return;
      }
      setModal(false);
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Paramètres — Grilles tarifaires ZD"
        tone="neutral"
        icon={<Table2 className="h-6 w-6 text-savr-neutral-600" />}
        actions={
          <>
            {canEdit && (
              <Button onClick={openModal}>
                <Plus className="h-4 w-4 mr-1" />
                Créer une grille
              </Button>
            )}
          </>
        }
      />

      {!canEdit && <OpsReadOnlyBanner />}

      {/* Liste complète (route GET sans pagination, triée défaut puis nom)
          → tri navigateur ; sans tri initial, l'ordre de l'API est conservé. */}
      <DataGrid
        columns={COLONNES_GRILLES}
        data={grilles}
        getRowId={(g) => g.id}
        loading={loading}
        rowClassName={(g) => (g.actif ? undefined : 'opacity-60')}
        empty={
          <Card className="p-8 text-center text-savr-neutral-500">
            Aucune grille tarifaire ZD.
          </Card>
        }
      />

      {/* Modale DS (§10 §6) : croix, Échap et clic extérieur ferment. Le
          formulaire (boutons inclus) reste dans le corps → soumission native. */}
      <Modal
        open={modal}
        title="Nouvelle grille tarifaire ZD"
        onClose={() => setModal(false)}
        wide
      >
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <FormField label="Nom" htmlFor="grille-nom" required>
            <Input
              id="grille-nom"
              value={fNom}
              onChange={(e) => setFNom(e.target.value)}
              required
            />
          </FormField>

          <div className="grid grid-cols-2 gap-4">
            <FormField label="Mode" htmlFor="grille-mode">
              <Combobox
                id="grille-mode"
                icon={null}
                options={[
                  { value: 'paliers', label: MODE_LABELS.paliers },
                  {
                    value: 'fixe_variable',
                    label: MODE_LABELS.fixe_variable,
                  },
                ]}
                value={fMode}
                onChange={(v) => setFMode(v as Mode)}
              />
            </FormField>
            <FormField
              label="Valide à partir du"
              htmlFor="grille-valide-du"
              required
            >
              <DatePicker
                id="grille-valide-du"
                value={fValideDu}
                onChange={setFValideDu}
                required
              />
            </FormField>
          </div>

          <label className="text-sm text-savr-neutral-700 flex items-center gap-2">
            <input
              type="checkbox"
              checked={fDefaut}
              onChange={(e) => setFDefaut(e.target.checked)}
            />
            Définir comme grille par défaut (ferme la grille par défaut actuelle
            — non rétroactif)
          </label>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Text as="span" variant="body" className="font-medium">
                Paliers
              </Text>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={addPalier}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Ajouter un palier
              </Button>
            </div>
            {fPaliers.map((pl, i) => (
              <div key={i} className="flex items-end gap-2">
                <FormField
                  label="Pax min"
                  htmlFor={`palier-${i}-pax-min`}
                  className="flex-1"
                >
                  <Input
                    id={`palier-${i}-pax-min`}
                    type="number"
                    min="0"
                    value={pl.pax_min}
                    onChange={(e) => setPalier(i, 'pax_min', e.target.value)}
                    required
                  />
                </FormField>
                <FormField
                  label="Pax max"
                  htmlFor={`palier-${i}-pax-max`}
                  className="flex-1"
                >
                  <Input
                    id={`palier-${i}-pax-max`}
                    type="number"
                    placeholder="∞"
                    value={pl.pax_max}
                    onChange={(e) => setPalier(i, 'pax_max', e.target.value)}
                  />
                </FormField>
                <FormField
                  label="Prix fixe HT"
                  htmlFor={`palier-${i}-prix-base`}
                  className="flex-1"
                >
                  <Input
                    id={`palier-${i}-prix-base`}
                    type="number"
                    step="0.01"
                    min="0"
                    value={pl.prix_base_ht}
                    onChange={(e) =>
                      setPalier(i, 'prix_base_ht', e.target.value)
                    }
                    required
                  />
                </FormField>
                {fMode === 'fixe_variable' && (
                  <FormField
                    label="€/pax HT"
                    htmlFor={`palier-${i}-prix-couvert`}
                    className="flex-1"
                  >
                    <Input
                      id={`palier-${i}-prix-couvert`}
                      type="number"
                      step="0.01"
                      min="0"
                      value={pl.prix_par_couvert_ht}
                      onChange={(e) =>
                        setPalier(i, 'prix_par_couvert_ht', e.target.value)
                      }
                    />
                  </FormField>
                )}
                <button
                  type="button"
                  onClick={() => removePalier(i)}
                  aria-label="Supprimer le palier"
                  className="p-2 text-savr-neutral-400 hover:text-savr-error-strong"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          {formError && (
            <p className="text-savr-error-strong text-sm">{formError}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setModal(false)}
            >
              Annuler
            </Button>
            <Button type="submit" disabled={submitting || !fNom}>
              {submitting ? 'Création…' : 'Créer la grille'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
