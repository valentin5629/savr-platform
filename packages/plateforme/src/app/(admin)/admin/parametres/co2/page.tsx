'use client';

import { useEffect, useState } from 'react';
import { Leaf, Save, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

interface FacteurCo2 {
  id: string;
  code_flux: string;
  fe_induit_kg_t: number;
  fe_evite_kg_t: number;
  energie_primaire_evitee_kwh_t: number;
}

interface MixEmballage {
  id: string;
  code_materiau: string;
  nom_materiau?: string;
  part_pct: number;
  fe_induit_kg_t: number;
  fe_evite_kg_t: number;
}

interface FacteurAg {
  id: string;
  facteur_co2_evite_par_repas_kg: number;
}

interface Co2Divers {
  id: string;
  cle: string;
  valeur: number;
  unite: string;
  description: string;
}

const MIN_COMMENT = 5;

export default function ParametresCo2Page() {
  const [facteurAg, setFacteurAg] = useState<FacteurAg | null>(null);
  const [loading, setLoading] = useState(true);
  const [mixDraft, setMixDraft] = useState<MixEmballage[]>([]);
  const [mixError, setMixError] = useState<string | null>(null);
  const [savingMix, setSavingMix] = useState(false);
  const [savingFacteurs, setSavingFacteurs] = useState(false);
  const [savingAg, setSavingAg] = useState(false);
  const [savingDivers, setSavingDivers] = useState(false);
  const [facteursDraft, setFacteursDraft] = useState<FacteurCo2[]>([]);
  const [agDraft, setAgDraft] = useState<number>(0);
  const [diversDraft, setDiversDraft] = useState<Co2Divers[]>([]);

  // Commentaire obligatoire par section (CDC §R_co2_snapshot_fige).
  const [commentFacteurs, setCommentFacteurs] = useState('');
  const [commentMix, setCommentMix] = useState('');
  const [commentAg, setCommentAg] = useState('');
  const [commentDivers, setCommentDivers] = useState('');

  useEffect(() => {
    Promise.all([
      fetch('/api/v1/admin/parametres/facteurs-co2').then((r) => r.json()),
      fetch('/api/v1/admin/parametres/mix-emballages').then((r) => r.json()),
      fetch('/api/v1/admin/parametres/facteurs-co2-ag').then((r) => r.json()),
      fetch('/api/v1/admin/parametres/co2-divers').then((r) => r.json()),
    ])
      .then(
        ([fc, mx, ag, dv]: [
          { data: FacteurCo2[] },
          { data: MixEmballage[] },
          { data: FacteurAg | null },
          { data: Co2Divers[] },
        ]) => {
          setFacteursDraft(fc.data.map((f) => ({ ...f })));
          setMixDraft(mx.data.map((m) => ({ ...m })));
          setFacteurAg(ag.data);
          setAgDraft(ag.data?.facteur_co2_evite_par_repas_kg ?? 0);
          setDiversDraft(dv.data.map((d) => ({ ...d })));
        },
      )
      .finally(() => setLoading(false));
  }, []);

  const mixTotal = mixDraft.reduce((acc, m) => acc + Number(m.part_pct), 0);
  const mixValid = Math.abs(mixTotal - 100) < 0.05;

  const handleSaveMix = async () => {
    if (!mixValid || commentMix.trim().length < MIN_COMMENT) return;
    setSavingMix(true);
    setMixError(null);
    const res = await fetch('/api/v1/admin/parametres/mix-emballages', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        // CDC §9ter.6 : Idempotency-Key UUID v4 obligatoire sur PUT (dédup 24h).
        'idempotency-key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        mix: mixDraft.map((m) => ({
          id: m.id,
          part_pct: Number(m.part_pct),
          fe_induit_kg_t: Number(m.fe_induit_kg_t),
          fe_evite_kg_t: Number(m.fe_evite_kg_t),
        })),
        commentaire_modif: commentMix.trim(),
      }),
    });
    if (res.ok) {
      const updated = (await res.json()) as { data: MixEmballage[] };
      setMixDraft(updated.data.map((m) => ({ ...m })));
      setCommentMix('');
    } else {
      const body = (await res.json()) as { error: string };
      setMixError(body.error);
    }
    setSavingMix(false);
  };

  const handleSaveFacteurs = async () => {
    if (commentFacteurs.trim().length < MIN_COMMENT) return;
    setSavingFacteurs(true);
    const res = await fetch('/api/v1/admin/parametres/facteurs-co2', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        // CDC §9ter.6 : Idempotency-Key UUID v4 obligatoire sur PUT (dédup 24h).
        'idempotency-key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        // emballage inclus : seule son énergie primaire est prise en compte
        // (FE induit/évité dérivés du mix, protégés par la RPC).
        facteurs: facteursDraft.map((f) => ({
          id: f.id,
          fe_induit_kg_t: Number(f.fe_induit_kg_t),
          fe_evite_kg_t: Number(f.fe_evite_kg_t),
          energie_primaire_evitee_kwh_t: Number(
            f.energie_primaire_evitee_kwh_t,
          ),
        })),
        commentaire_modif: commentFacteurs.trim(),
      }),
    });
    if (res.ok) {
      const updated = (await res.json()) as { data: FacteurCo2[] };
      setFacteursDraft(updated.data.map((f) => ({ ...f })));
      setCommentFacteurs('');
    }
    setSavingFacteurs(false);
  };

  const handleSaveAg = async () => {
    if (!facteurAg || commentAg.trim().length < MIN_COMMENT) return;
    setSavingAg(true);
    const res = await fetch('/api/v1/admin/parametres/facteurs-co2-ag', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        // CDC §9ter.6 : Idempotency-Key UUID v4 obligatoire sur PUT (dédup 24h).
        'idempotency-key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        id: facteurAg.id,
        facteur_co2_evite_par_repas_kg: Number(agDraft),
        commentaire_modif: commentAg.trim(),
      }),
    });
    if (res.ok) {
      const updated = (await res.json()) as { data: FacteurAg };
      setFacteurAg(updated.data);
      setAgDraft(updated.data.facteur_co2_evite_par_repas_kg);
      setCommentAg('');
    }
    setSavingAg(false);
  };

  const handleSaveDivers = async () => {
    if (commentDivers.trim().length < MIN_COMMENT) return;
    setSavingDivers(true);
    const res = await fetch('/api/v1/admin/parametres/co2-divers', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        // CDC §9ter.6 : Idempotency-Key UUID v4 obligatoire sur PUT (dédup 24h).
        'idempotency-key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        divers: diversDraft.map((d) => ({
          id: d.id,
          valeur: Number(d.valeur),
        })),
        commentaire_modif: commentDivers.trim(),
      }),
    });
    if (res.ok) {
      const updated = (await res.json()) as { data: Co2Divers[] };
      setDiversDraft(updated.data.map((d) => ({ ...d })));
      setCommentDivers('');
    }
    setSavingDivers(false);
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
            Facteurs CO₂ par flux (kg CO₂e / tonne)
          </h2>
          <Button
            size="sm"
            onClick={() => void handleSaveFacteurs()}
            disabled={
              savingFacteurs || commentFacteurs.trim().length < MIN_COMMENT
            }
          >
            <Save className="h-4 w-4 mr-2" />
            {savingFacteurs ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </div>
        <p className="text-xs text-savr-neutral-500">
          La ligne &ldquo;emballage&rdquo; a ses FE induit/évité dérivés du mix
          (lecture seule) ; seule son énergie primaire est éditable.
        </p>
        <div className="grid grid-cols-[10rem_repeat(3,8rem)] items-center gap-2 text-xs font-medium text-savr-neutral-400">
          <span>Flux</span>
          <span>FE induit</span>
          <span>FE évité</span>
          <span>Énergie évitée</span>
        </div>
        <div className="space-y-2">
          {facteursDraft.map((f, i) => {
            const derive = f.code_flux === 'emballage';
            return (
              <div
                key={f.id}
                className="grid grid-cols-[10rem_repeat(3,8rem)] items-center gap-2"
              >
                <span className="text-sm font-medium text-savr-neutral-700">
                  {f.code_flux}
                </span>
                {derive ? (
                  <>
                    <span className="text-sm text-savr-neutral-400 italic">
                      {f.fe_induit_kg_t} (calculé)
                    </span>
                    <span className="text-sm text-savr-neutral-400 italic">
                      {f.fe_evite_kg_t} (calculé)
                    </span>
                  </>
                ) : (
                  <>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="w-28 border border-savr-neutral-200 rounded px-2 py-1 text-sm"
                      value={f.fe_induit_kg_t}
                      onChange={(e) => {
                        const next = [...facteursDraft];
                        next[i] = {
                          ...f,
                          fe_induit_kg_t: parseFloat(e.target.value) || 0,
                        };
                        setFacteursDraft(next);
                      }}
                    />
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="w-28 border border-savr-neutral-200 rounded px-2 py-1 text-sm"
                      value={f.fe_evite_kg_t}
                      onChange={(e) => {
                        const next = [...facteursDraft];
                        next[i] = {
                          ...f,
                          fe_evite_kg_t: parseFloat(e.target.value) || 0,
                        };
                        setFacteursDraft(next);
                      }}
                    />
                  </>
                )}
                {/* Énergie primaire : éditable pour tous les flux, emballage inclus. */}
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="w-28 border border-savr-neutral-200 rounded px-2 py-1 text-sm"
                  value={f.energie_primaire_evitee_kwh_t}
                  onChange={(e) => {
                    const next = [...facteursDraft];
                    next[i] = {
                      ...f,
                      energie_primaire_evitee_kwh_t:
                        parseFloat(e.target.value) || 0,
                    };
                    setFacteursDraft(next);
                  }}
                />
              </div>
            );
          })}
        </div>
        <CommentaireInput
          value={commentFacteurs}
          onChange={setCommentFacteurs}
        />
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
            disabled={
              savingMix || !mixValid || commentMix.trim().length < MIN_COMMENT
            }
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

        <div className="grid grid-cols-[10rem_5rem_8rem_8rem] items-center gap-2 text-xs font-medium text-savr-neutral-400">
          <span>Matériau</span>
          <span>Part %</span>
          <span>FE induit</span>
          <span>FE évité</span>
        </div>
        <div className="space-y-2">
          {mixDraft.map((m, i) => (
            <div
              key={m.id}
              className="grid grid-cols-[10rem_5rem_8rem_8rem] items-center gap-2"
            >
              <span className="text-sm font-medium text-savr-neutral-700">
                {m.nom_materiau ?? m.code_materiau}
              </span>
              <input
                type="number"
                step="0.1"
                min="0"
                max="100"
                className="w-20 border border-savr-neutral-200 rounded px-2 py-1 text-sm"
                value={m.part_pct}
                onChange={(e) => {
                  const next = [...mixDraft];
                  next[i] = { ...m, part_pct: parseFloat(e.target.value) || 0 };
                  setMixDraft(next);
                }}
              />
              <input
                type="number"
                step="0.01"
                min="0"
                className="w-28 border border-savr-neutral-200 rounded px-2 py-1 text-sm"
                value={m.fe_induit_kg_t}
                onChange={(e) => {
                  const next = [...mixDraft];
                  next[i] = {
                    ...m,
                    fe_induit_kg_t: parseFloat(e.target.value) || 0,
                  };
                  setMixDraft(next);
                }}
              />
              <input
                type="number"
                step="0.01"
                min="0"
                className="w-28 border border-savr-neutral-200 rounded px-2 py-1 text-sm"
                value={m.fe_evite_kg_t}
                onChange={(e) => {
                  const next = [...mixDraft];
                  next[i] = {
                    ...m,
                    fe_evite_kg_t: parseFloat(e.target.value) || 0,
                  };
                  setMixDraft(next);
                }}
              />
            </div>
          ))}
        </div>
        <CommentaireInput value={commentMix} onChange={setCommentMix} />
      </Card>

      {/* Facteur AG */}
      {facteurAg && (
        <Card className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-savr-neutral-800">
              Facteur CO₂ évité AG (kg CO₂ / repas)
            </h2>
            <Button
              size="sm"
              onClick={() => void handleSaveAg()}
              disabled={savingAg || commentAg.trim().length < MIN_COMMENT}
            >
              <Save className="h-4 w-4 mr-2" />
              {savingAg ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          </div>
          <div className="flex items-center gap-4">
            <input
              type="number"
              step="0.01"
              min="0"
              className="w-32 border border-savr-neutral-200 rounded px-2 py-1 text-sm"
              value={agDraft}
              onChange={(e) => setAgDraft(parseFloat(e.target.value) || 0)}
            />
            <span className="text-sm text-savr-neutral-500">
              kg CO₂ / repas
            </span>
            <span className="text-xs text-savr-neutral-400">(source FAO)</span>
          </div>
          <CommentaireInput value={commentAg} onChange={setCommentAg} />
        </Card>
      )}

      {/* Paramètres CO₂ divers (forfait collecte + équivalences) */}
      {diversDraft.length > 0 && (
        <Card className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-savr-neutral-800">
              Paramètres divers (forfait collecte + équivalences)
            </h2>
            <Button
              size="sm"
              onClick={() => void handleSaveDivers()}
              disabled={
                savingDivers || commentDivers.trim().length < MIN_COMMENT
              }
            >
              <Save className="h-4 w-4 mr-2" />
              {savingDivers ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          </div>
          <div className="space-y-2">
            {diversDraft.map((d, i) => (
              <div key={d.id} className="flex items-center gap-4">
                <span className="w-72 text-sm text-savr-neutral-700">
                  {d.description}
                </span>
                <input
                  type="number"
                  step="0.0001"
                  className="w-32 border border-savr-neutral-200 rounded px-2 py-1 text-sm"
                  value={d.valeur}
                  onChange={(e) => {
                    const next = [...diversDraft];
                    next[i] = { ...d, valeur: parseFloat(e.target.value) || 0 };
                    setDiversDraft(next);
                  }}
                />
                <span className="text-xs text-savr-neutral-400">{d.unite}</span>
              </div>
            ))}
          </div>
          <CommentaireInput value={commentDivers} onChange={setCommentDivers} />
        </Card>
      )}
    </div>
  );
}

// Champ commentaire de modification — obligatoire (≥ 5 caractères) avant tout
// enregistrement de paramètre CO₂ (CDC §R_co2_snapshot_fige).
function CommentaireInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-savr-neutral-600">
        Commentaire de modification (obligatoire)
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Motif / source de la mise à jour"
        className="w-full border border-savr-neutral-200 rounded px-2 py-1 text-sm"
      />
    </div>
  );
}
