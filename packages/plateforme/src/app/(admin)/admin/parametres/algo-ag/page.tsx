'use client';

import { useEffect, useState, useCallback } from 'react';
import { Settings, AlertTriangle, CheckCircle2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

interface ParamAlgo {
  cle: string;
  valeur: unknown;
  type_valeur: string;
  description: string;
  updated_at: string;
}

const CLE_LABELS: Record<string, string> = {
  regle_ag_plage_velo_debut: 'Début plage vélo (heure)',
  regle_ag_plage_velo_fin: 'Fin plage vélo (heure)',
  regle_ag_seuil_pax_velo: 'Seuil PAX grand volume',
  regle_ag_seuil_h2_minutes: 'Seuil délai express (min)',
  poids_par_repas_kg: 'Poids par repas (kg)',
  a_toutes_indisponible: 'A Toutes! indisponible',
  everest_codes_postaux: 'Codes postaux Everest',
};

const AG_CLES = Object.keys(CLE_LABELS);

export default function AlgoAgParamsPage() {
  const [params, setParams] = useState<ParamAlgo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const loadParams = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/admin/parametres-algo');
      if (!res.ok) throw new Error('Erreur chargement paramètres');
      const json = (await res.json()) as { data: ParamAlgo[] };
      const agParams = json.data.filter((p) => AG_CLES.includes(p.cle));
      setParams(agParams);
      const initial: Record<string, string> = {};
      for (const p of agParams) {
        initial[p.cle] =
          typeof p.valeur === 'string' ? p.valeur : JSON.stringify(p.valeur);
      }
      setEditing(initial);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadParams();
  }, [loadParams]);

  const handleSave = async (cle: string, type_valeur: string) => {
    setSaving(cle);
    setError(null);
    setSuccessMsg(null);
    try {
      let valeur: unknown = editing[cle];
      if (type_valeur === 'bool') valeur = editing[cle] === 'true';
      else if (type_valeur === 'int')
        valeur = parseInt(editing[cle] ?? '0', 10);
      else if (type_valeur === 'decimal')
        valeur = parseFloat(editing[cle] ?? '0');
      else if (type_valeur === 'json')
        valeur = JSON.parse(editing[cle] ?? '[]');

      const res = await fetch('/api/v1/admin/parametres-algo', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cle, valeur }),
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        throw new Error(json.error ?? 'Erreur sauvegarde');
      }
      setSuccessMsg(`Paramètre « ${CLE_LABELS[cle] ?? cle} » mis à jour.`);
      await loadParams();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue');
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Settings className="h-6 w-6 text-savr-neutral-600" />
        <div>
          <h1 className="text-xl font-semibold text-savr-neutral-900">
            Paramètres algorithme AG
          </h1>
          <p className="text-sm text-savr-neutral-500">
            Plages horaires, seuils et coefficients du moteur d'attribution
            Anti-Gaspi
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}
      {successMsg && (
        <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {successMsg}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[...Array(7)].map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {params.map((p) => (
            <Card key={p.cle} className="border border-savr-neutral-200 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-savr-neutral-900">
                    {CLE_LABELS[p.cle] ?? p.cle}
                  </p>
                  <p className="text-xs text-savr-neutral-500">
                    {p.description}
                  </p>
                  <p className="mt-0.5 font-mono text-xs text-savr-neutral-400">
                    clé: {p.cle} · type: {p.type_valeur}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {p.type_valeur === 'bool' ? (
                    <select
                      className="rounded border border-savr-neutral-200 px-2 py-1 text-sm"
                      value={editing[p.cle] ?? 'false'}
                      onChange={(e) =>
                        setEditing((prev) => ({
                          ...prev,
                          [p.cle]: e.target.value,
                        }))
                      }
                    >
                      <option value="true">Oui (true)</option>
                      <option value="false">Non (false)</option>
                    </select>
                  ) : (
                    <input
                      type="text"
                      className="w-40 rounded border border-savr-neutral-200 px-2 py-1 text-sm font-mono"
                      value={editing[p.cle] ?? ''}
                      onChange={(e) =>
                        setEditing((prev) => ({
                          ...prev,
                          [p.cle]: e.target.value,
                        }))
                      }
                    />
                  )}
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={saving === p.cle}
                    onClick={() => handleSave(p.cle, p.type_valeur)}
                  >
                    <Save className="mr-1 h-3 w-3" />
                    {saving === p.cle ? '…' : 'Sauvegarder'}
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
