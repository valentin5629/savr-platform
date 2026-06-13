'use client';

import { useEffect, useState } from 'react';
import { Leaf, Save, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

interface FacteurCo2 {
  id: string;
  code_flux: string;
  facteur_co2_kg_par_kg: number;
}

interface MixEmballage {
  id: string;
  materiau: string;
  part_pct: number;
}

interface FacteurAg {
  id: string;
  facteur_co2_kg_par_repas: number;
}

export default function ParametresCo2Page() {
  const [facteurAg, setFacteurAg] = useState<FacteurAg | null>(null);
  const [loading, setLoading] = useState(true);
  const [mixDraft, setMixDraft] = useState<MixEmballage[]>([]);
  const [mixError, setMixError] = useState<string | null>(null);
  const [savingMix, setSavingMix] = useState(false);
  const [savingFacteurs, setSavingFacteurs] = useState(false);
  const [facteursDraft, setFacteursDraft] = useState<FacteurCo2[]>([]);

  useEffect(() => {
    Promise.all([
      fetch('/api/v1/admin/parametres/facteurs-co2').then((r) => r.json()),
      fetch('/api/v1/admin/parametres/mix-emballages').then((r) => r.json()),
      fetch('/api/v1/admin/parametres/facteurs-co2-ag').then((r) => r.json()),
    ])
      .then(
        ([fc, mx, ag]: [
          { data: FacteurCo2[] },
          { data: MixEmballage[] },
          { data: FacteurAg | null },
        ]) => {
          setFacteursDraft(fc.data.map((f) => ({ ...f })));
          setMixDraft(mx.data.map((m) => ({ ...m })));
          setFacteurAg(ag.data);
        },
      )
      .finally(() => setLoading(false));
  }, []);

  const mixTotal = mixDraft.reduce((acc, m) => acc + Number(m.part_pct), 0);
  const mixValid = Math.abs(mixTotal - 100) < 0.01;

  const handleSaveMix = async () => {
    if (!mixValid) return;
    setSavingMix(true);
    setMixError(null);
    const res = await fetch('/api/v1/admin/parametres/mix-emballages', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mix: mixDraft.map((m) => ({ id: m.id, part_pct: Number(m.part_pct) })),
      }),
    });
    if (res.ok) {
      const updated = (await res.json()) as { data: MixEmballage[] };
      setMixDraft(updated.data.map((m) => ({ ...m })));
    } else {
      const body = (await res.json()) as { error: string };
      setMixError(body.error);
    }
    setSavingMix(false);
  };

  const handleSaveFacteurs = async () => {
    setSavingFacteurs(true);
    const res = await fetch('/api/v1/admin/parametres/facteurs-co2', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        facteurs: facteursDraft.map((f) => ({
          id: f.id,
          facteur_co2_kg_par_kg: Number(f.facteur_co2_kg_par_kg),
        })),
      }),
    });
    if (res.ok) {
      const updated = (await res.json()) as { data: FacteurCo2[] };
      setFacteursDraft(updated.data.map((f) => ({ ...f })));
    }
    setSavingFacteurs(false);
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <Leaf className="h-6 w-6 text-savr-neutral-600" />
        <h1 className="text-2xl font-bold text-savr-neutral-900">
          Paramètres — CO₂
        </h1>
      </div>

      {/* Facteurs CO2 par flux */}
      <Card className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-savr-neutral-800">
            Facteurs CO₂ par flux (kg CO₂ / kg déchet)
          </h2>
          <Button
            size="sm"
            onClick={() => void handleSaveFacteurs()}
            disabled={savingFacteurs}
          >
            <Save className="h-4 w-4 mr-2" />
            {savingFacteurs ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </div>
        <p className="text-xs text-savr-neutral-500">
          La ligne &ldquo;emballage&rdquo; est dérivée automatiquement du mix
          emballages ci-dessous.
        </p>
        <div className="space-y-2">
          {facteursDraft.map((f, i) => (
            <div key={f.id} className="flex items-center gap-4">
              <span className="w-40 text-sm font-medium text-savr-neutral-700">
                {f.code_flux}
              </span>
              {f.code_flux === 'emballage' ? (
                <span className="text-sm text-savr-neutral-400 italic">
                  {f.facteur_co2_kg_par_kg} (calculé)
                </span>
              ) : (
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  className="w-32 border border-savr-neutral-200 rounded px-2 py-1 text-sm"
                  value={f.facteur_co2_kg_par_kg}
                  onChange={(e) => {
                    const next = [...facteursDraft];
                    next[i] = {
                      ...f,
                      facteur_co2_kg_par_kg: parseFloat(e.target.value) || 0,
                    };
                    setFacteursDraft(next);
                  }}
                />
              )}
              <span className="text-xs text-savr-neutral-400">kg CO₂ / kg</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Mix emballages */}
      <Card className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-savr-neutral-800">
            Mix emballages (7 matériaux)
          </h2>
          <Button
            size="sm"
            onClick={() => void handleSaveMix()}
            disabled={savingMix || !mixValid}
          >
            <Save className="h-4 w-4 mr-2" />
            {savingMix ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </div>

        {/* Contrôle live somme */}
        <div
          className={`flex items-center gap-2 text-sm font-medium ${mixValid ? 'text-savr-success-600' : 'text-savr-error-600'}`}
        >
          {!mixValid && <AlertCircle className="h-4 w-4" />}
          Total : {mixTotal.toFixed(2)} %{' '}
          {mixValid ? '✓' : `— doit être égal à 100 %`}
        </div>

        {mixError && <p className="text-savr-error-600 text-sm">{mixError}</p>}

        <div className="space-y-2">
          {mixDraft.map((m, i) => (
            <div key={m.id} className="flex items-center gap-4">
              <span className="w-40 text-sm font-medium text-savr-neutral-700">
                {m.materiau}
              </span>
              <input
                type="number"
                step="0.1"
                min="0"
                max="100"
                className="w-24 border border-savr-neutral-200 rounded px-2 py-1 text-sm"
                value={m.part_pct}
                onChange={(e) => {
                  const next = [...mixDraft];
                  next[i] = { ...m, part_pct: parseFloat(e.target.value) || 0 };
                  setMixDraft(next);
                }}
              />
              <span className="text-xs text-savr-neutral-400">%</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Facteur AG */}
      {facteurAg && (
        <Card className="p-6 space-y-4">
          <h2 className="font-semibold text-savr-neutral-800">
            Facteur CO₂ évité AG (kg CO₂ / repas)
          </h2>
          <div className="flex items-center gap-4">
            <input
              type="number"
              step="0.01"
              min="0"
              className="w-32 border border-savr-neutral-200 rounded px-2 py-1 text-sm"
              defaultValue={facteurAg.facteur_co2_kg_par_repas}
              onBlur={async (e) => {
                const val = parseFloat(e.target.value);
                if (!isNaN(val)) {
                  await fetch('/api/v1/admin/parametres/facteurs-co2-ag', {
                    method: 'PUT',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                      id: facteurAg.id,
                      facteur_co2_kg_par_repas: val,
                    }),
                  });
                }
              }}
            />
            <span className="text-sm text-savr-neutral-500">
              kg CO₂ / repas
            </span>
            <span className="text-xs text-savr-neutral-400">
              (source ADEME)
            </span>
          </div>
        </Card>
      )}
    </div>
  );
}
