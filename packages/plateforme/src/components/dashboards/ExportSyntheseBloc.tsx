'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { MultiSelectFilter, type MultiOption } from './MultiSelectFilter.js';
import type { CollecteType } from './CollecteTypeTabs.js';
import type { DashboardFilters } from './DashboardFilterBar.js';

/**
 * Bloc 8 — « Exporter une synthèse PDF » (§06.04 / §06.05 / §06.11 Bloc 8 ZD/AG).
 *
 * Bouton du dashboard → modale de génération §06.05 §4 (3 étapes, ouverte en
 * étape 3, filtres PRÉ-REMPLIS depuis le dashboard + Type de collecte FIGÉ selon
 * l'onglet actif ; retour aux étapes 1-2 pour ajuster). « Générer » appelle la
 * route SYNCHRONE POST /api/v1/dashboards/synthese-pdf (décision Val 2026-07-07)
 * qui renvoie une URL R2 pré-signée 1h → téléchargement direct, aucun archivage.
 *
 * Composant PARTAGÉ par les 3 rôles (traiteur/agence/gestionnaire) : le périmètre
 * et la visibilité des filtres sont appliqués côté serveur selon le JWT du rôle.
 */

type Preset = '7j' | '30j' | 'trimestre' | '12mois' | 'annee' | 'perso';

const PRESET_LABELS: { key: Preset; label: string }[] = [
  { key: '7j', label: '7 jours' },
  { key: '30j', label: '30 jours' },
  { key: 'trimestre', label: 'Trimestre en cours' },
  { key: '12mois', label: '12 derniers mois' },
  { key: 'annee', label: 'Année civile' },
  { key: 'perso', label: 'Personnalisée' },
];

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function presetRange(
  preset: Preset,
  current: { from: string; to: string },
): {
  from: string;
  to: string;
} {
  const today = new Date();
  const to = iso(today);
  const start = new Date(today);
  switch (preset) {
    case '7j':
      start.setDate(start.getDate() - 7);
      return { from: iso(start), to };
    case '30j':
      start.setDate(start.getDate() - 30);
      return { from: iso(start), to };
    case 'trimestre': {
      const q = Math.floor(today.getMonth() / 3) * 3;
      return { from: iso(new Date(today.getFullYear(), q, 1)), to };
    }
    case '12mois':
      start.setFullYear(start.getFullYear() - 1);
      return { from: iso(start), to };
    case 'annee':
      return { from: iso(new Date(today.getFullYear(), 0, 1)), to };
    case 'perso':
    default:
      return current;
  }
}

interface Props {
  filters: DashboardFilters | null;
  tab: CollecteType;
}

export function ExportSyntheseBloc({ filters, tab }: Props) {
  const [open, setOpen] = useState(false);
  // Ouverture directe en étape 3 (§06.05 Bloc 8 l.214), retour 1-2 possible.
  const [step, setStep] = useState(2);
  const [preset, setPreset] = useState<Preset>('perso');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [includeBoth, setIncludeBoth] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Filtres modale-natifs (§1.6 étape 2, absents de la barre dashboard traiteur/agence) :
  // options chargées à l'ouverture depuis /synthese-pdf/filtres (scopées par rôle).
  const [clientOptions, setClientOptions] = useState<MultiOption[]>([]);
  const [commercialOptions, setCommercialOptions] = useState<MultiOption[]>([]);
  const [clientIds, setClientIds] = useState<string[]>([]);
  const [commercialIds, setCommercialIds] = useState<string[]>([]);

  const openModal = () => {
    // Pré-remplissage depuis les filtres globaux du dashboard.
    setFrom(filters?.from ?? '');
    setTo(filters?.to ?? '');
    setPreset('perso');
    setIncludeBoth(false);
    setClientIds([]);
    setCommercialIds([]);
    setError(null);
    setStep(2);
    setOpen(true);
    // Options Client organisateur / Commercial (scopées par rôle côté serveur).
    void fetch('/api/v1/dashboards/synthese-pdf/filtres')
      .then((r) =>
        r.ok ? r.json() : { data: { clients: [], commerciaux: [] } },
      )
      .then(
        (j: {
          data?: { clients?: MultiOption[]; commerciaux?: MultiOption[] };
        }) => {
          setClientOptions(j.data?.clients ?? []);
          setCommercialOptions(j.data?.commerciaux ?? []);
        },
      )
      .catch(() => {
        setClientOptions([]);
        setCommercialOptions([]);
      });
  };

  const applyPreset = (p: Preset) => {
    setPreset(p);
    if (p !== 'perso') {
      const r = presetRange(p, { from, to });
      setFrom(r.from);
      setTo(r.to);
    }
  };

  const typeLabel =
    tab === 'zero_dechet' ? 'Zéro-Déchet (ZD)' : 'Anti-Gaspi (AG)';

  const inheritedFilters: string[] = [];
  if ((filters?.lieu_ids?.length ?? 0) > 0)
    inheritedFilters.push(`${filters?.lieu_ids?.length} lieu(x)`);
  if ((filters?.traiteur_ids?.length ?? 0) > 0)
    inheritedFilters.push(`${filters?.traiteur_ids?.length} traiteur(s)`);
  if ((filters?.type_evenement_ids?.length ?? 0) > 0)
    inheritedFilters.push(
      `${filters?.type_evenement_ids?.length} type(s) d'événement`,
    );
  if ((filters?.taille_evenement_codes?.length ?? 0) > 0)
    inheritedFilters.push(
      `tailles ${filters?.taille_evenement_codes?.join(', ')}`,
    );

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/dashboards/synthese-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: from || null,
          to: to || null,
          // Type FIGÉ selon l'onglet ; décoché → ZD + AG (§06.04 l.58).
          types: includeBoth ? [] : [tab],
          lieu_ids: filters?.lieu_ids ?? [],
          traiteur_ids: filters?.traiteur_ids ?? [],
          type_evenement_ids: filters?.type_evenement_ids ?? [],
          taille_evenements: filters?.taille_evenement_codes ?? [],
          client_organisateur_ids: clientIds,
          commercial_ids: commercialIds,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!res.ok || !json.url) {
        setError(json.error ?? 'La génération a échoué. Réessayez.');
        return;
      }
      window.open(json.url, '_blank', 'noopener');
      setOpen(false);
    } catch {
      setError('La génération a échoué. Réessayez.');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div>
      <Button variant="secondary" onClick={openModal}>
        Exporter une synthèse PDF
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Exporter une synthèse PDF"
        footer={
          <>
            {step > 0 && (
              <Button
                variant="ghost"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                disabled={generating}
              >
                Précédent
              </Button>
            )}
            {step < 2 ? (
              <Button variant="primary" onClick={() => setStep((s) => s + 1)}>
                Suivant
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={generate}
                disabled={generating}
              >
                {generating ? 'Génération en cours…' : 'Générer le rapport'}
              </Button>
            )}
          </>
        }
      >
        <ol className="mb-4 flex gap-2 text-xs font-medium text-savr-neutral-500">
          {['Période', 'Filtres', 'Générer'].map((label, i) => (
            <li
              key={label}
              className={
                i === step
                  ? 'rounded-savr-md bg-savr-primary-50 px-2 py-1 text-savr-primary-700'
                  : 'px-2 py-1'
              }
            >
              {i + 1}. {label}
            </li>
          ))}
        </ol>

        {step === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-savr-neutral-600">
              Choisissez la période du rapport.
            </p>
            <div className="flex flex-wrap gap-2">
              {PRESET_LABELS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => applyPreset(p.key)}
                  className={`rounded-savr-md border px-3 py-1.5 text-sm ${
                    preset === p.key
                      ? 'border-savr-primary-500 bg-savr-primary-50 text-savr-primary-700'
                      : 'border-savr-neutral-300 text-savr-neutral-700 hover:bg-savr-neutral-100'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <label className="text-sm text-savr-neutral-600">
                Du
                <input
                  type="date"
                  value={from}
                  max={to || undefined}
                  onChange={(e) => {
                    setPreset('perso');
                    setFrom(e.target.value);
                  }}
                  className="ml-2 rounded-savr-md border border-savr-neutral-300 px-2 py-1 text-sm"
                />
              </label>
              <label className="text-sm text-savr-neutral-600">
                au
                <input
                  type="date"
                  value={to}
                  max={iso(new Date())}
                  onChange={(e) => {
                    setPreset('perso');
                    setTo(e.target.value);
                  }}
                  className="ml-2 rounded-savr-md border border-savr-neutral-300 px-2 py-1 text-sm"
                />
              </label>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium text-savr-neutral-800">
                Type de collecte
              </p>
              <p className="text-sm text-savr-neutral-600">
                Figé sur <strong>{typeLabel}</strong> (onglet actif).
              </p>
              <label className="mt-1 flex items-center gap-2 text-sm text-savr-neutral-700">
                <input
                  type="checkbox"
                  checked={includeBoth}
                  onChange={(e) => setIncludeBoth(e.target.checked)}
                />
                Inclure les deux types (Zéro-Déchet + Anti-Gaspi)
              </label>
            </div>
            {clientOptions.length > 0 && (
              <MultiSelectFilter
                label="Client organisateur"
                options={clientOptions}
                selected={clientIds}
                onChange={setClientIds}
                allLabel="Tous les clients"
                testid="synthese-filtre-clients"
              />
            )}
            {commercialOptions.length > 0 && (
              <MultiSelectFilter
                label="Commercial"
                options={commercialOptions}
                selected={commercialIds}
                onChange={setCommercialIds}
                allLabel="Tous les commerciaux"
                testid="synthese-filtre-commerciaux"
              />
            )}
            <div>
              <p className="text-sm font-medium text-savr-neutral-800">
                Filtres hérités du tableau de bord
              </p>
              <p className="text-sm text-savr-neutral-600">
                {inheritedFilters.length > 0
                  ? inheritedFilters.join(' · ')
                  : 'Aucun filtre — toutes les collectes du périmètre.'}
              </p>
              <p className="mt-1 text-xs text-savr-neutral-400">
                Ajustez les lieux et types depuis les filtres du tableau de bord
                avant de générer.
              </p>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-2 text-sm text-savr-neutral-700">
            <p>Le rapport sera généré puis téléchargé automatiquement.</p>
            <ul className="list-disc space-y-1 pl-5 text-savr-neutral-600">
              <li>
                Période : <strong>{from || '—'}</strong> au{' '}
                <strong>{to || '—'}</strong>
              </li>
              <li>
                Type : <strong>{includeBoth ? 'ZD + AG' : typeLabel}</strong>
              </li>
              {inheritedFilters.length > 0 && (
                <li>Filtres : {inheritedFilters.join(' · ')}</li>
              )}
              {clientIds.length > 0 && (
                <li>Clients : {clientIds.length} sélectionné(s)</li>
              )}
              {commercialIds.length > 0 && (
                <li>Commerciaux : {commercialIds.length} sélectionné(s)</li>
              )}
            </ul>
            <p className="text-xs text-savr-neutral-400">
              Seules les collectes clôturées depuis plus de 24 h sont incluses.
              Le rapport n'est pas archivé.
            </p>
            {generating && (
              <p className="text-sm text-savr-primary-700">
                Génération en cours… (jusqu'à 2 min)
              </p>
            )}
            {error && <p className="text-sm text-savr-error">{error}</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}
