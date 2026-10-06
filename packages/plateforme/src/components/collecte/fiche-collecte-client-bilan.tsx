'use client';

import { useEffect, useState } from 'react';
import { Ban, Clock3, FileText, Info, MinusCircle } from 'lucide-react';
import { AlertBar } from '@/components/ui/alert-bar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { StatCard } from '@/components/ui/stat-card';
import { Tooltip } from '@/components/ui/tooltip';
import { SectionHeader } from '@/components/ui/section-header';
import { InfoItem } from '@/components/ui/info-item';
import {
  BlocAssociation,
  type FicheClientDonnees,
} from '@/components/collecte/fiche-collecte-client-onglets';
import {
  BenchmarkFilterBar,
  FLUX_ZD,
  type BenchmarkFilters,
} from '@/components/dashboards';
import { BenchmarkRadar } from '@/components/dashboards/charts/cockpit/BenchmarkRadar';
import { TonnagesDonut } from '@/components/dashboards/charts/cockpit/TonnagesDonut';
import {
  fmtDec,
  fmtInt,
  fmtMasse,
} from '@/components/dashboards/charts/cockpit/fmt';
import { UNITE_KG_CO2E } from '@/lib/format';
import {
  LIBELLE_ETAT_RAPPORT,
  STATUTS_ANNULES,
  STATUT_BILAN,
  type EspaceClient,
} from '@/lib/collectes/fiche-client-types';
import { Text } from '@/components/ui/text';

// Onglet « Bilan & documents » du pop-up fiche collecte CLIENT (§06.04 refonte
// Val 2026-09-29). Valeurs FIGÉES à la clôture (taux de recyclage, CO₂) : lues,
// jamais recalculées ici. Avant « Réalisée » : mêmes blocs estompés, sans
// valeurs, sous le bandeau « Votre bilan sera disponible après la collecte ».

// Tooltip méthode UE (§06.04 Bloc 2bis) — texte figé.
const TOOLTIP_TAUX_UE =
  'Taux de recyclage net (méthode UE 2019/1004) — calculé avec les taux de captation ' +
  'effectifs par filière (verre, carton, biodéchets, emballages). L’OMR (déchet ' +
  'résiduel) entre uniquement au dénominateur. Voir Méthodologie.';

const TITRE_RADAR = 'Votre collecte face aux événements comparables';
const SOUS_TITRE_RADAR =
  'Déchets par convive (kg/pax), flux par flux, comparés à la moyenne anonymisée ' +
  'des événements Savr des 24 derniers mois. À l’intérieur du repère, vous ' +
  'produisez moins que la moyenne.';

interface BenchmarkFlux {
  ratio_user: number | null;
  benchmark_kg_pax: number | null;
}

function Estompe({
  actif,
  children,
}: {
  actif: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={actif ? 'space-y-3 opacity-40' : 'space-y-3'}
      aria-hidden={actif || undefined}
      data-testid={actif ? 'bilan-estompe' : undefined}
    >
      {children}
    </div>
  );
}

// Carte de graphe sans valeur (bilan à venir) : même titre que le graphe réel.
function GrapheEnAttente({ titre }: { titre: string }) {
  return (
    <Card padding="md" className="space-y-3">
      <Text
        size="base"
        tone="ink"
        className="font-extrabold tracking-[-0.01em]"
      >
        {titre}
      </Text>
      <p className="py-8 text-center text-2xl font-extrabold text-savr-neutral-300">
        —
      </p>
    </Card>
  );
}

// Carte KPI : chiffre en grand + unité plus petite, sur UNE seule ligne
// (retour Val 2026-09-30 : « −100 kg CO₂e » ne doit jamais passer à la ligne).
function Kpi({
  label,
  nombre,
  unite,
  aide,
}: {
  label: string;
  // « — » tant que la valeur n'existe pas.
  nombre: string;
  unite?: string;
  aide?: string;
}) {
  return (
    <StatCard
      label={label}
      value={nombre}
      unit={unite}
      headerRight={
        aide ? (
          <Tooltip content={aide}>
            <span
              tabIndex={0}
              aria-label={aide}
              className="inline-flex cursor-help"
            >
              <Info className="h-4 w-4" />
            </span>
          </Tooltip>
        ) : undefined
      }
    />
  );
}

export function OngletBilan({
  c,
  base,
  espace,
}: {
  c: FicheClientDonnees;
  // Préfixe déjà encodé : /api/v1/<espace>/collectes/<id>.
  base: string;
  espace: EspaceClient;
}) {
  const isAg = c.type === 'anti_gaspi';
  const annulee = STATUTS_ANNULES.includes(c.statut);
  const sansExcedent = c.statut === 'realisee_sans_collecte';
  const realisee = c.statut === STATUT_BILAN;
  const pax = c.evenement?.pax ?? null;

  // Radar (ZD réalisée) : repère parc recalculé à chaque changement de filtre ;
  // `null` renvoyé par la route = pas de radar pour cette collecte (collecte
  // d'un traiteur tiers vue par un gestionnaire) → bloc masqué.
  const radarVisible = !isAg && realisee;
  const [bench, setBench] = useState<Record<string, BenchmarkFlux> | null>(
    null,
  );
  const [benchIndisponible, setBenchIndisponible] = useState(false);
  const [benchFilters, setBenchFilters] = useState<BenchmarkFilters | null>(
    null,
  );
  useEffect(() => {
    if (!radarVisible || !benchFilters) return;
    const qs = new URLSearchParams();
    if (benchFilters.type_evenement_ids.length)
      qs.set('type_evenement_ids', benchFilters.type_evenement_ids.join(','));
    if (benchFilters.taille_evenement_codes.length)
      qs.set(
        'taille_evenement_codes',
        benchFilters.taille_evenement_codes.join(','),
      );
    if (benchFilters.lieu_ids.length)
      qs.set('lieu_ids', benchFilters.lieu_ids.join(','));
    let annule = false;
    fetch(`${base}/benchmark?${qs.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { data?: { flux?: Record<string, BenchmarkFlux> } | null }) => {
        if (annule) return;
        if (j && j.data === null) {
          setBenchIndisponible(true);
          return;
        }
        // Échec du recalcul ⇒ on RETIRE le repère plutôt que de laisser celui
        // des filtres précédents (un chiffre périmé sans signal est pire).
        setBench(j?.data?.flux ?? null);
      })
      .catch(() => {
        if (!annule) setBench(null);
      });
    return () => {
      annule = true;
    };
  }, [base, radarVisible, benchFilters]);

  // Documents
  const [telechargement, setTelechargement] = useState<string | null>(null);
  const [regenEnCours, setRegenEnCours] = useState(false);
  const [regenFait, setRegenFait] = useState(false);

  async function telechargerRapport() {
    setTelechargement(null);
    const res = await fetch(`${base}/rapport-rse/download`);
    const j = (await res.json().catch(() => ({}))) as { url?: string };
    if (res.ok && j.url) {
      window.open(j.url, '_blank');
      return;
    }
    setTelechargement(
      res.status === 425 || res.status === 202
        ? 'Le rapport n’est pas encore disponible.'
        : 'Le téléchargement a échoué. Réessayez dans un instant.',
    );
  }

  // Régénération manuelle du rapport RSE (RPT-04 — manager traiteur, ZD).
  async function regenererRapport() {
    setRegenEnCours(true);
    try {
      const res = await fetch(
        `${base}/documents/rapport-recyclage-zd/regenerate`,
        { method: 'POST' },
      );
      if (res.ok) setRegenFait(true);
    } finally {
      setRegenEnCours(false);
    }
  }

  if (annulee) {
    return (
      <Card
        padding="md"
        className="flex items-start gap-3"
        data-testid="bilan-annulee"
      >
        <Ban
          className="mt-0.5 h-5 w-5 shrink-0 text-savr-neutral-400"
          aria-hidden="true"
        />
        <Text variant="body">Collecte annulée : aucun bilan ni document.</Text>
      </Card>
    );
  }

  const rapportNom = sansExcedent
    ? 'Rapport « Événement sans excédent alimentaire »'
    : isAg
      ? 'Rapport de don'
      : 'Rapport RSE';
  const bilanDispo = realisee || sansExcedent;
  const factures = (c.factures ?? []).filter(
    (f) => f.statut !== 'brouillon' && (f.pdf_url_pennylane || f.pdf_url_savr),
  );

  // ── Bilan ZD ────────────────────────────────────────────────────────────
  const flux = c.bilan_flux ?? {};
  const poidsTotal = realisee
    ? Object.values(flux).reduce((s, v) => s + v, 0)
    : null;
  const masse = poidsTotal != null ? fmtMasse(poidsTotal) : null;
  const serieDonut = [
    {
      periode: c.date_collecte,
      biodechet: flux.biodechet ?? 0,
      emballage: flux.emballage ?? 0,
      carton: flux.carton ?? 0,
      verre: flux.verre ?? 0,
      dechet_residuel: flux.dechet_residuel ?? 0,
      tonnage_total: poidsTotal ?? 0,
      taux_recyclage: c.taux_recyclage,
    },
  ];
  const gaugeItems = FLUX_ZD.map((f) => ({
    label: f.label,
    value: bench?.[f.code]?.ratio_user ?? null,
    benchmark: bench?.[f.code]?.benchmark_kg_pax ?? null,
  }));

  // ── Bilan AG ────────────────────────────────────────────────────────────
  const repas = realisee ? c.repas_donnes : null;

  return (
    <div className="space-y-3">
      {!bilanDispo && (
        <div
          data-testid="bandeau-bilan-attente"
          className="flex items-start gap-3 rounded-savr-lg bg-savr-primary-50 px-5 py-4"
        >
          <Clock3
            className="mt-0.5 h-5 w-5 shrink-0 text-savr-primary-700"
            aria-hidden="true"
          />
          <div>
            <Text size="base" tone="ink" className="font-bold">
              Votre bilan sera disponible après la collecte
            </Text>
            <Text tone="soft">
              {isAg
                ? 'Repas donnés, CO₂ évité et association bénéficiaire s’afficheront ici le lendemain de la collecte.'
                : 'Poids collectés, CO₂ évité, répartition par flux et comparaison avec des événements similaires s’afficheront ici le lendemain de la collecte.'}
            </Text>
          </div>
        </div>
      )}

      {sansExcedent ? (
        <Card padding="md" className="space-y-4" data-testid="bloc-aucun-repas">
          <SectionHeader icon={MinusCircle} title="Aucun repas collecté" />
          <Text tone="soft" className="leading-relaxed">
            Notre chauffeur s’est présenté sur place, mais il n’y avait pas
            d’excédent alimentaire à donner. Aucune attestation de don n’est
            émise pour cette collecte.
          </Text>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 border-t border-dashed border-savr-neutral-200 pt-4 text-sm sm:grid-cols-2">
            <InfoItem label="Motif">
              {c.aucun_repas_motif?.trim() || (
                <span className="text-savr-neutral-400">—</span>
              )}
            </InfoItem>
            <InfoItem label="Constaté le">
              {c.realisee_at ? (
                new Date(c.realisee_at).toLocaleString('fr-FR', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                  timeZone: 'Europe/Paris',
                })
              ) : (
                <span className="text-savr-neutral-400">—</span>
              )}
            </InfoItem>
          </dl>
        </Card>
      ) : isAg ? (
        <Estompe actif={!realisee}>
          <div
            className="grid grid-cols-1 gap-3 sm:grid-cols-3"
            data-testid="kpi-ag"
          >
            <Kpi
              label="Repas donnés"
              nombre={repas != null ? fmtInt(repas) : '—'}
              unite="repas"
            />
            <Kpi
              label="Repas par pax"
              nombre={repas != null && pax ? fmtDec(repas / pax, 2) : '—'}
            />
            <Kpi
              label="CO₂ évité"
              nombre={
                realisee && c.co2_evite_kg != null
                  ? fmtInt(c.co2_evite_kg)
                  : '—'
              }
              unite={UNITE_KG_CO2E}
            />
          </div>
          {realisee && c.association && (
            <BlocAssociation association={c.association} />
          )}
        </Estompe>
      ) : (
        <Estompe actif={!realisee}>
          <div
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
            data-testid="kpi-zd"
          >
            <Kpi
              label="Poids total collecté"
              nombre={masse ? masse.value : '—'}
              unite={masse ? masse.unit : 'kg'}
            />
            <Kpi
              label="CO₂ évité (net)"
              nombre={
                realisee && c.co2_net_kg != null ? fmtInt(c.co2_net_kg) : '—'
              }
              unite={UNITE_KG_CO2E}
            />
            <Kpi
              label="Taux de recyclage"
              aide={TOOLTIP_TAUX_UE}
              nombre={
                realisee && c.taux_recyclage != null
                  ? fmtDec(c.taux_recyclage, 1)
                  : '—'
              }
              unite="%"
            />
            <Kpi
              label="Pesée par pax"
              nombre={
                poidsTotal != null && pax
                  ? fmtInt((poidsTotal / pax) * 1000)
                  : '—'
              }
              unite="g"
            />
          </div>
          {realisee ? (
            <TonnagesDonut series={serieDonut} disposition="ligne" />
          ) : (
            <GrapheEnAttente titre="Répartition des tonnages" />
          )}
          {!realisee ? (
            <GrapheEnAttente titre={TITRE_RADAR} />
          ) : (
            radarVisible &&
            !benchIndisponible && (
              <div data-testid="bloc-3-zd-fiche" key={c.id}>
                <BenchmarkRadar
                  title={TITRE_RADAR}
                  subtitle={SOUS_TITRE_RADAR}
                  items={gaugeItems}
                  filtersSlot={
                    <BenchmarkFilterBar
                      masquerTraiteurs
                      onChange={setBenchFilters}
                      initialTypeEvenementIds={
                        c.evenement?.type_evenement_id
                          ? [c.evenement.type_evenement_id]
                          : []
                      }
                      initialTailleCodes={
                        c.taille_bracket ? [c.taille_bracket] : []
                      }
                    />
                  }
                />
              </div>
            )
          )}
        </Estompe>
      )}

      {/* Documents : un seul rapport (bordereau ZD intégré au PDF) + facture
          côté traiteur. */}
      <Card
        className="divide-y divide-savr-neutral-100 p-0"
        data-testid="bloc-documents"
      >
        <div className="flex flex-wrap items-center gap-3 px-5 py-3.5">
          <FileText
            className="h-5 w-5 shrink-0 text-savr-primary-700"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold text-savr-neutral-900">
              {rapportNom}
            </p>
            <Text>
              {LIBELLE_ETAT_RAPPORT[c.rapport_etat]}
              {c.rapport_rse_regenere && (
                <span data-testid="rapport-regenere">
                  {' '}
                  · Rapport mis à jour
                </span>
              )}
            </Text>
          </div>
          {espace === 'traiteur' &&
            c.can_regenerate &&
            c.rapport_rse_disponible && (
              <Button
                variant="ghost"
                size="sm"
                disabled={regenFait}
                loading={regenEnCours}
                loadingText="Régénération…"
                onClick={() => void regenererRapport()}
              >
                {regenFait ? 'Régénération demandée' : 'Régénérer le rapport'}
              </Button>
            )}
          {!c.rapport_reserve_donneur_ordre && (
            <Button
              variant="secondary"
              disabled={!c.rapport_rse_disponible}
              onClick={() => void telechargerRapport()}
            >
              Télécharger
            </Button>
          )}
        </div>
        {factures.map((f) => (
          <div
            key={f.id}
            className="flex flex-wrap items-center gap-3 px-5 py-3.5"
            data-testid="document-facture"
          >
            <FileText
              className="h-5 w-5 shrink-0 text-savr-primary-700"
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold text-savr-neutral-900">
                Facture {f.numero_facture}
              </p>
              <Text>PDF</Text>
            </div>
            <Button
              variant="secondary"
              onClick={() =>
                window.open(
                  f.pdf_url_pennylane ?? f.pdf_url_savr ?? '',
                  '_blank',
                )
              }
            >
              Télécharger
            </Button>
          </div>
        ))}
        {telechargement && (
          <AlertBar variant="err" role="alert" className="mx-5 my-3">
            {telechargement}
          </AlertBar>
        )}
      </Card>
    </div>
  );
}
