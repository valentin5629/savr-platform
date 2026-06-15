'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';

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

const TYPE_LABELS: Record<string, string> = {
  unitaire: 'Unitaire (1 collecte)',
  pack_10: 'Pack 10 collectes',
  pack_30: 'Pack 30 collectes',
  pack_60: 'Pack 60 collectes',
};

const TYPES_PACK = ['unitaire', 'pack_10', 'pack_30', 'pack_60'] as const;

export default function TarifsPacksAGPage() {
  const [tarifs, setTarifs] = useState<TarifPackAG[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

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
    setFValideDu(tomorrow.toISOString().slice(0, 10));
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
          <h1 className="text-2xl font-semibold text-primary-950">
            Tarifs packs AG
          </h1>
          <p className="text-sm text-neutral-500 mt-1">
            Tarifs actifs par type de pack. La modification ferme la ligne
            précédente et ouvre une nouvelle version.
          </p>
        </div>
        <Button onClick={() => openModal()}>Nouveau tarif</Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {byType.map(({ type, label, tarif }) => (
          <Card key={type} className="p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-medium">{label}</h3>
                <p className="text-xs text-neutral-400 mt-0.5">{type}</p>
              </div>
              {tarif ? (
                <Badge variant="success" className="text-xs">
                  Actif depuis{' '}
                  {new Date(tarif.valide_du).toLocaleDateString('fr-FR')}
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
                  <span className="text-neutral-500">Crédits</span>
                  <span className="font-medium">{tarif.credits}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-500">Prix unitaire HT</span>
                  <span className="font-medium">
                    {tarif.prix_unitaire_ht.toLocaleString('fr-FR', {
                      minimumFractionDigits: 2,
                    })}{' '}
                    €
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-500">Montant total HT</span>
                  <span className="font-medium text-primary-700">
                    {tarif.montant_total_ht.toLocaleString('fr-FR', {
                      minimumFractionDigits: 2,
                    })}{' '}
                    €
                  </span>
                </div>
                {tarif.mensualisable && tarif.nb_mensualites && (
                  <div className="flex justify-between">
                    <span className="text-neutral-500">Mensualisation</span>
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
                <div className="pt-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => openModal(type)}
                  >
                    Modifier le tarif
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => openModal(type)}
              >
                Définir un tarif
              </Button>
            )}
          </Card>
        ))}
      </div>

      {/* Modale */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">
                Nouveau tarif — {TYPE_LABELS[fType] ?? fType}
              </h2>
              <button
                onClick={() => setModal(false)}
                className="text-neutral-400 hover:text-neutral-900"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="mb-4 rounded-lg bg-red-50 border border-red-200 text-red-700 px-4 py-2 text-sm">
                {formError}
              </div>
            )}

            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Type de pack
                </label>
                <select
                  value={fType}
                  onChange={(e) => {
                    const t = e.target.value;
                    const preset: Record<string, number> = {
                      unitaire: 1,
                      pack_10: 10,
                      pack_30: 30,
                      pack_60: 60,
                    };
                    setFType(t);
                    if (preset[t]) setFCredits(preset[t]);
                  }}
                  className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
                >
                  {TYPES_PACK.map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Nombre de crédits
                </label>
                <input
                  type="number"
                  min={1}
                  value={fCredits}
                  onChange={(e) => setFCredits(parseInt(e.target.value) || 1)}
                  className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Prix unitaire HT (€ / collecte)
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={fPrix}
                  onChange={(e) => setFPrix(e.target.value)}
                  className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="ex : 130.00"
                  required
                />
                {fPrix && fCredits > 0 && (
                  <p className="text-xs text-neutral-500 mt-1">
                    Total HT :{' '}
                    {(parseFloat(fPrix) * fCredits).toLocaleString('fr-FR', {
                      minimumFractionDigits: 2,
                    })}{' '}
                    €
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Date d'entrée en vigueur
                </label>
                <input
                  type="date"
                  value={fValideDu}
                  onChange={(e) => setFValideDu(e.target.value)}
                  className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
                  required
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="mensualisable"
                  checked={fMensualisable}
                  onChange={(e) => setFMensualisable(e.target.checked)}
                  className="rounded"
                />
                <label htmlFor="mensualisable" className="text-sm">
                  Mensualisation disponible
                </label>
              </div>
              {fMensualisable && (
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Nombre de mensualités
                  </label>
                  <input
                    type="number"
                    min={2}
                    max={24}
                    value={fNbMensualites}
                    onChange={(e) =>
                      setFNbMensualites(parseInt(e.target.value) || 12)
                    }
                    className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
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
          </div>
        </div>
      )}
    </div>
  );
}
