'use client';

import { useEffect, useState } from 'react';
import { Table2, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useUserRole } from '@/lib/use-user-role';
import { OpsReadOnlyBanner } from '@/components/ui/ops-read-only-banner';

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
    setFValideDu(new Date().toISOString().slice(0, 10));
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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Table2 className="h-6 w-6 text-savr-neutral-600" />
          <h1 className="text-2xl font-bold text-savr-neutral-900">
            Paramètres — Grilles tarifaires ZD
          </h1>
        </div>
        {canEdit && (
          <Button onClick={openModal}>
            <Plus className="h-4 w-4 mr-1" />
            Créer une grille
          </Button>
        )}
      </div>

      {!canEdit && <OpsReadOnlyBanner />}

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : grilles.length === 0 ? (
        <Card className="p-8 text-center text-savr-neutral-500">
          Aucune grille tarifaire ZD.
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-savr-neutral-50 text-savr-neutral-500">
              <tr className="text-left">
                <th className="px-4 py-3 font-medium">Nom</th>
                <th className="px-4 py-3 font-medium">Mode</th>
                <th className="px-4 py-3 font-medium">Défaut</th>
                <th className="px-4 py-3 font-medium">Validité</th>
                <th className="px-4 py-3 font-medium text-right">
                  Organisations
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-savr-neutral-100">
              {grilles.map((g) => (
                <tr key={g.id} className={g.actif ? '' : 'opacity-60'}>
                  <td className="px-4 py-3 font-medium text-savr-neutral-800">
                    {g.nom}
                  </td>
                  <td className="px-4 py-3 text-savr-neutral-600">
                    {MODE_LABELS[g.mode]}
                  </td>
                  <td className="px-4 py-3">
                    {g.est_defaut && (
                      <Badge variant="success">Par défaut</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-savr-neutral-600">
                    {g.valide_du}
                    {g.valide_jusqu ? ` → ${g.valide_jusqu}` : ' → …'}
                  </td>
                  <td className="px-4 py-3 text-right text-savr-neutral-700">
                    {g.nb_organisations}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <form
              onSubmit={(e) => void handleSubmit(e)}
              className="p-6 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-savr-neutral-900">
                  Nouvelle grille tarifaire ZD
                </h2>
                <button
                  type="button"
                  onClick={() => setModal(false)}
                  aria-label="Fermer"
                >
                  <X className="h-5 w-5 text-savr-neutral-400" />
                </button>
              </div>

              <div>
                <label className="text-sm text-savr-neutral-600 block mb-1">
                  Nom
                </label>
                <input
                  className="w-full border border-savr-neutral-200 rounded-lg px-3 py-2 text-sm"
                  value={fNom}
                  onChange={(e) => setFNom(e.target.value)}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm text-savr-neutral-600 block mb-1">
                    Mode
                  </label>
                  <select
                    className="w-full border border-savr-neutral-200 rounded-lg px-3 py-2 text-sm"
                    value={fMode}
                    onChange={(e) => setFMode(e.target.value as Mode)}
                  >
                    <option value="paliers">{MODE_LABELS.paliers}</option>
                    <option value="fixe_variable">
                      {MODE_LABELS.fixe_variable}
                    </option>
                  </select>
                </div>
                <div>
                  <label className="text-sm text-savr-neutral-600 block mb-1">
                    Valide à partir du
                  </label>
                  <input
                    type="date"
                    className="w-full border border-savr-neutral-200 rounded-lg px-3 py-2 text-sm"
                    value={fValideDu}
                    onChange={(e) => setFValideDu(e.target.value)}
                    required
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm text-savr-neutral-700">
                <input
                  type="checkbox"
                  checked={fDefaut}
                  onChange={(e) => setFDefaut(e.target.checked)}
                />
                Définir comme grille par défaut (ferme la grille par défaut
                actuelle — non rétroactif)
              </label>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-savr-neutral-700">
                    Paliers
                  </span>
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
                    <div className="flex-1">
                      <label className="text-xs text-savr-neutral-500">
                        Pax min
                      </label>
                      <input
                        type="number"
                        min="0"
                        className="w-full border border-savr-neutral-200 rounded-lg px-2 py-1.5 text-sm"
                        value={pl.pax_min}
                        onChange={(e) =>
                          setPalier(i, 'pax_min', e.target.value)
                        }
                        required
                      />
                    </div>
                    <div className="flex-1">
                      <label className="text-xs text-savr-neutral-500">
                        Pax max
                      </label>
                      <input
                        type="number"
                        placeholder="∞"
                        className="w-full border border-savr-neutral-200 rounded-lg px-2 py-1.5 text-sm"
                        value={pl.pax_max}
                        onChange={(e) =>
                          setPalier(i, 'pax_max', e.target.value)
                        }
                      />
                    </div>
                    <div className="flex-1">
                      <label className="text-xs text-savr-neutral-500">
                        Prix fixe HT
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        className="w-full border border-savr-neutral-200 rounded-lg px-2 py-1.5 text-sm"
                        value={pl.prix_base_ht}
                        onChange={(e) =>
                          setPalier(i, 'prix_base_ht', e.target.value)
                        }
                        required
                      />
                    </div>
                    {fMode === 'fixe_variable' && (
                      <div className="flex-1">
                        <label className="text-xs text-savr-neutral-500">
                          €/pax HT
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          className="w-full border border-savr-neutral-200 rounded-lg px-2 py-1.5 text-sm"
                          value={pl.prix_par_couvert_ht}
                          onChange={(e) =>
                            setPalier(i, 'prix_par_couvert_ht', e.target.value)
                          }
                        />
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removePalier(i)}
                      aria-label="Supprimer le palier"
                      className="p-2 text-savr-neutral-400 hover:text-savr-error-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>

              {formError && (
                <p className="text-savr-error-600 text-sm">{formError}</p>
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
          </div>
        </div>
      )}
    </div>
  );
}
