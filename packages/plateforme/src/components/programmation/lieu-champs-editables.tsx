'use client';

import type { LieuOption } from './lieu-combobox';

// PROG-01 (CDC §06.01 l.104-114) : à la sélection d'un lieu, tous les champs du lieu
// SAUF le nom s'affichent pré-remplis et ÉDITABLES. Toute valeur modifiée est stockée
// dans collectes.lieu_overrides (le référentiel lieu n'est PAS mis à jour). Les champs
// admin/ops-only (commentaire_lieu, siren, email_gestionnaire, reference_citeo) ne sont
// jamais exposés. `flux_acceptes` n'est pas une colonne lieu V1 (flux peuplés aux pesées).

const DIFFICULTE = [
  { v: 'facile', l: 'Facile' },
  { v: 'difficile', l: 'Difficile' },
  { v: 'tres_difficile', l: 'Très difficile' },
];
const VEHICULES = [
  { v: 'velo_cargo', l: 'Vélo cargo' },
  { v: 'camionnette', l: 'Camionnette' },
  { v: 'fourgon', l: 'Fourgon' },
  { v: 'vul', l: 'VUL' },
  { v: 'poids_lourd', l: 'Poids lourd' },
];

export interface LieuEdits {
  adresse_acces: string;
  code_postal: string;
  ville: string;
  acces_details: string;
  stationnement: string;
  type_vehicule_max: string;
  acces_office: string;
  contraintes_horaires: string;
}

export function lieuToEdits(lieu: LieuOption): LieuEdits {
  return {
    adresse_acces: lieu.adresse_acces ?? '',
    code_postal: lieu.code_postal ?? '',
    ville: lieu.ville ?? '',
    acces_details: lieu.acces_details ?? '',
    stationnement: lieu.stationnement ?? '',
    type_vehicule_max: lieu.type_vehicule_max ?? '',
    acces_office: lieu.acces_office ?? '',
    contraintes_horaires: lieu.contraintes_horaires ?? '',
  };
}

/** Diff des éditions vs valeurs de référence du lieu → override (clés modifiées seules). */
export function computeLieuOverrides(
  base: LieuEdits,
  edits: LieuEdits,
): Record<string, string> {
  const overrides: Record<string, string> = {};
  (Object.keys(edits) as (keyof LieuEdits)[]).forEach((k) => {
    if (edits[k] !== base[k]) overrides[k] = edits[k];
  });
  return overrides;
}

const inputCls =
  'w-full rounded-savr-md border border-savr-neutral-300 px-3 py-2 text-sm focus:outline-2 focus:outline-savr-primary-500';
const labelCls = 'text-sm font-medium text-savr-neutral-700';

export function LieuChampsEditables({
  edits,
  onChange,
}: {
  edits: LieuEdits;
  onChange: (e: LieuEdits) => void;
}) {
  const set = (k: keyof LieuEdits, v: string) => onChange({ ...edits, [k]: v });

  return (
    <div className="rounded-savr-lg border border-savr-neutral-200 bg-savr-neutral-50 p-4 space-y-4">
      <p className="text-sm text-savr-neutral-600">
        Champs du lieu (modifiables pour cette collecte uniquement — le
        référentiel n'est pas mis à jour).
      </p>

      <div className="space-y-1">
        <label className={labelCls}>Adresse d'accès livraison</label>
        <input
          type="text"
          value={edits.adresse_acces}
          onChange={(e) => set('adresse_acces', e.target.value)}
          className={inputCls}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className={labelCls}>Code postal</label>
          <input
            type="text"
            value={edits.code_postal}
            onChange={(e) => set('code_postal', e.target.value)}
            className={inputCls}
          />
        </div>
        <div className="space-y-1">
          <label className={labelCls}>Ville</label>
          <input
            type="text"
            value={edits.ville}
            onChange={(e) => set('ville', e.target.value)}
            className={inputCls}
          />
        </div>
      </div>

      <div className="space-y-1">
        <label className={labelCls}>Détails d'accès</label>
        <input
          type="text"
          value={edits.acces_details}
          onChange={(e) => set('acces_details', e.target.value)}
          placeholder="Ex : quai N°2, sonner interphone B"
          className={inputCls}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label className={labelCls}>Stationnement</label>
          <select
            value={edits.stationnement}
            onChange={(e) => set('stationnement', e.target.value)}
            className={`${inputCls} bg-savr-white`}
          >
            <option value="">Non renseigné</option>
            {DIFFICULTE.map((d) => (
              <option key={d.v} value={d.v}>
                {d.l}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className={labelCls}>Accès office</label>
          <select
            value={edits.acces_office}
            onChange={(e) => set('acces_office', e.target.value)}
            className={`${inputCls} bg-savr-white`}
          >
            <option value="">Non renseigné</option>
            {DIFFICULTE.map((d) => (
              <option key={d.v} value={d.v}>
                {d.l}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1">
        <label className={labelCls}>Type de véhicule max</label>
        <select
          value={edits.type_vehicule_max}
          onChange={(e) => set('type_vehicule_max', e.target.value)}
          className={`${inputCls} bg-savr-white`}
        >
          <option value="">Non renseigné</option>
          {VEHICULES.map((v) => (
            <option key={v.v} value={v.v}>
              {v.l}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label className={labelCls}>Contraintes horaires</label>
        <input
          type="text"
          value={edits.contraintes_horaires}
          onChange={(e) => set('contraintes_horaires', e.target.value)}
          placeholder="Ex : livraison avant 9h uniquement"
          className={inputCls}
        />
      </div>
    </div>
  );
}
