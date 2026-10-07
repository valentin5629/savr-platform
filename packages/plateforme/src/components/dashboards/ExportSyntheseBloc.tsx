'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox } from '@/components/ui/combobox';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { FilterChips } from '@/components/ui/filter-chips';
import { FormError } from '@/components/ui/form-error';
import { FormField } from '@/components/ui/form-field';
import type { OptionFiltre } from '@/components/ui/filtre-en-ligne';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import type { CollecteType } from '@/components/collecte/toggle-type-collecte';
import type { DashboardFilters } from './DashboardFilterBar.js';
import { jourParis } from '@savr/shared/src/temps/index.js';
import { Text } from '@/components/ui/text';
import { raccourciDe, raccourcisPeriode } from '@/lib/periodes-raccourcis';
import { libelleCompletTypeCollecte } from '@/lib/libelles/type-collecte';

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

// Raccourcis de période de l'étape 1 : la liste STANDARD des filtres de date
// (`lib/periodes-raccourcis`, jours parisiens, « Année civile » = 1er janvier →
// 31 décembre), en `FilterChips` + « Personnalisée » (= toute autre période,
// posée dans le calendrier). Le chip actif se DÉDUIT de la période courante.
const CHIP_PERSONNALISEE = 'perso';

interface Props {
  filters: DashboardFilters | null;
  tab: CollecteType;
}

export function ExportSyntheseBloc({ filters, tab }: Props) {
  const [open, setOpen] = useState(false);
  // Ouverture directe en étape 3 (§06.05 Bloc 8 l.214), retour 1-2 possible.
  const [step, setStep] = useState(2);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [includeBoth, setIncludeBoth] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Filtres modale-natifs (§1.6 étape 2, absents de la barre dashboard traiteur/agence) :
  // options chargées à l'ouverture depuis /synthese-pdf/filtres (scopées par rôle).
  const [clientOptions, setClientOptions] = useState<OptionFiltre[]>([]);
  const [commercialOptions, setCommercialOptions] = useState<OptionFiltre[]>(
    [],
  );
  const [clientIds, setClientIds] = useState<string[]>([]);
  const [commercialIds, setCommercialIds] = useState<string[]>([]);

  const openModal = () => {
    // Pré-remplissage depuis les filtres globaux du dashboard.
    setFrom(filters?.from ?? '');
    setTo(filters?.to ?? '');
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
          data?: { clients?: OptionFiltre[]; commerciaux?: OptionFiltre[] };
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

  // Recalculés à chaque rendu : « 7 derniers jours » se lit par rapport à aujourd'hui.
  const raccourcis = raccourcisPeriode();
  const chipActif =
    raccourciDe({ from, to }, raccourcis)?.cle ?? CHIP_PERSONNALISEE;
  const choisirRaccourci = (cle: string) => {
    const r = raccourcis.find((x) => x.cle === cle);
    if (!r) return; // « Personnalisée » : la période se pose dans le calendrier.
    setFrom(r.periode.from);
    setTo(r.periode.to);
  };

  const typeLabel = libelleCompletTypeCollecte(tab);

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
        ref?: string;
      };
      if (!res.ok || !json.url) {
        const message = json.error ?? 'La génération a échoué. Réessayez.';
        // Ref du renderer : permet au support de retrouver la trace.
        setError(json.ref ? `${message} (référence : ${json.ref})` : message);
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
                loading={generating}
                loadingText="Génération en cours…"
              >
                Générer le rapport
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
            <Text tone="soft">Choisissez la période du rapport.</Text>
            <FilterChips
              ariaLabel="Raccourcis de période"
              chips={[
                ...raccourcis.map((r) => ({ key: r.cle, label: r.libelle })),
                { key: CHIP_PERSONNALISEE, label: 'Personnalisée' },
              ]}
              activeKey={chipActif}
              onSelect={choisirRaccourci}
            />
            <FormField label="Période" htmlFor="synthese-periode">
              <DateRangePicker
                id="synthese-periode"
                data-testid="synthese-periode"
                value={{ from, to }}
                max={jourParis(new Date())}
                onChange={(p) => {
                  setFrom(p.from);
                  setTo(p.to);
                }}
              />
            </FormField>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <div>
              <Text tone="strong" className="font-medium">
                Type de collecte
              </Text>
              <Text tone="soft">
                Figé sur <strong>{typeLabel}</strong> (onglet actif).
              </Text>
              <Label variant="choice" className="mt-1 flex items-center gap-2">
                <Checkbox
                  checked={includeBoth}
                  onCheckedChange={(v) => setIncludeBoth(v === true)}
                />
                Inclure les deux types (Zéro Déchet + Anti-Gaspi)
              </Label>
            </div>
            {/* Filtres modale-natifs au format en ligne « Titre  valeur ▾ »
                (`Combobox titre` multiple, R-UI-4b D9) ; vide = « Tous ». */}
            {(clientOptions.length > 0 || commercialOptions.length > 0) && (
              <div className="flex flex-wrap items-center gap-1">
                {clientOptions.length > 0 && (
                  <Combobox
                    multiple
                    titre="Client organisateur"
                    id="synthese-filtre-clients"
                    data-testid="synthese-filtre-clients"
                    icon={null}
                    placeholder="Tous les clients"
                    emptyText="Aucune option."
                    options={clientOptions.map((o) => ({
                      value: o.id,
                      label: o.nom,
                    }))}
                    value={clientIds}
                    onChange={setClientIds}
                  />
                )}
                {commercialOptions.length > 0 && (
                  <Combobox
                    multiple
                    titre="Commercial"
                    id="synthese-filtre-commerciaux"
                    data-testid="synthese-filtre-commerciaux"
                    icon={null}
                    placeholder="Tous les commerciaux"
                    emptyText="Aucune option."
                    options={commercialOptions.map((o) => ({
                      value: o.id,
                      label: o.nom,
                    }))}
                    value={commercialIds}
                    onChange={setCommercialIds}
                  />
                )}
              </div>
            )}
            <div>
              <Text tone="strong" className="font-medium">
                Filtres hérités du tableau de bord
              </Text>
              <Text tone="soft">
                {inheritedFilters.length > 0
                  ? inheritedFilters.join(' · ')
                  : 'Aucun filtre — toutes les collectes du périmètre.'}
              </Text>
              <Text variant="faint" className="mt-1">
                Ajustez les lieux et types depuis les filtres du tableau de bord
                avant de générer.
              </Text>
            </div>
          </div>
        )}

        {step === 2 && (
          <Text as="div" variant="body" className="space-y-2">
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
            <Text variant="faint">
              Seules les collectes clôturées depuis plus de 24 h sont incluses.
              Le rapport n'est pas archivé.
            </Text>
            {generating && (
              <p className="text-sm text-savr-primary-700">
                Génération en cours… (jusqu'à 2 min)
              </p>
            )}
            <FormError>{error}</FormError>
          </Text>
        )}
      </Modal>
    </div>
  );
}
