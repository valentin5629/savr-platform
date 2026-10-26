'use client';

import { useEffect, useState, type ComponentProps } from 'react';
import { Ban, Clock3, FileText, Info, MinusCircle } from 'lucide-react';
import { AlertBar } from '@/components/ui/alert-bar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
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
import { facturationPlateformeActive } from '@/lib/facturation-plateforme';
import { UNITE_KG_CO2E } from '@/lib/format';
import {
  LIBELLE_ETAT_RAPPORT,
  STATUTS_ANNULES,
  STATUT_BILAN,
  type EspaceClient,
  type FicheCollecteClient,
} from '@/lib/collectes/fiche-client-types';
import { Text } from '@/components/ui/text';
import {
  ouvrirRapportDeDon,
  telechargerRapportRecyclage,
} from '@/lib/collectes/rapport-telechargement-client';

// Onglet « Bilan & documents » du pop-up fiche collecte CLIENT (§06.04 refonte
// Val 2026-09-29). Valeurs FIGÉES à la clôture (taux de recyclage, CO₂) : lues,
// jamais recalculées ici. Avant « Réalisée » : mêmes blocs estompés, sans
// valeurs, sous le bandeau « Votre bilan sera disponible après la collecte ».
// Le bilan (BilanCollecte) est aussi celui de l'onglet Documents de la fiche
// Admin : l'équipe Savr voit ce que voit le client (décision Val 2026-10-16).

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

export function Estompe({
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
export function GrapheEnAttente({ titre }: { titre: string }) {
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

/** Bandeau « bilan à venir » (repris par la fiche événement du gestionnaire). */
export function BandeauBilanAttente({
  titre,
  children,
}: {
  titre: string;
  children: React.ReactNode;
}) {
  return (
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
          {titre}
        </Text>
        <Text tone="soft">{children}</Text>
      </div>
    </div>
  );
}

// Carte KPI : chiffre en grand + unité plus petite, sur UNE seule ligne
// (retour Val 2026-09-30 : « −100 kg CO₂e » ne doit jamais passer à la ligne).
// Reprise par le bilan consolidé de la fiche événement du gestionnaire.
export function Kpi({
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

/** Ce que le bilan lit d'une collecte : fiche client, ou fiche Admin. */
export type BilanFiche = Pick<
  FicheCollecteClient,
  | 'id'
  | 'type'
  | 'statut'
  | 'date_collecte'
  | 'taux_recyclage'
  | 'co2_evite_kg'
  | 'realisee_at'
  | 'aucun_repas_motif'
  | 'taille_bracket'
  | 'bilan_flux'
  | 'repas_donnes'
  | 'association'
  // Type d'événement de LA collecte (lot B1) : filtre du radar par défaut.
  | 'type_evenement_id'
  // Convives de LA collecte (lot C1, C4 du 2026-10-20) : « Repas par pax » et
  // « Pesée par pax » se divisent par eux, jamais par le total de l'événement.
  | 'pax'
>;

/**
 * Radar de la fiche (ZD réalisée) : repère parc recalculé à chaque changement
 * de filtre, lu sur `benchmarkUrl` (route `…/collectes/<id>/benchmark` de
 * l'espace). `null` renvoyé par la route = pas de radar pour cette collecte
 * (visible, mais refusée par la garde de la fonction SQL) → bloc masqué. Les
 * filtres réglés servent aussi la régénération du rapport avec radar.
 */
export function useRadarFiche(
  benchmarkUrl: string,
  c: Pick<BilanFiche, 'type' | 'statut'> | null,
) {
  const visible =
    c != null && c.type !== 'anti_gaspi' && c.statut === STATUT_BILAN;
  const [bench, setBench] = useState<Record<string, BenchmarkFlux> | null>(
    null,
  );
  const [indisponible, setIndisponible] = useState(false);
  const [filtres, setFiltres] = useState<BenchmarkFilters | null>(null);
  useEffect(() => {
    if (!visible || !filtres) return;
    const qs = new URLSearchParams();
    if (filtres.type_evenement_ids.length)
      qs.set('type_evenement_ids', filtres.type_evenement_ids.join(','));
    if (filtres.taille_evenement_codes.length)
      qs.set(
        'taille_evenement_codes',
        filtres.taille_evenement_codes.join(','),
      );
    if (filtres.lieu_ids.length) qs.set('lieu_ids', filtres.lieu_ids.join(','));
    let annule = false;
    fetch(`${benchmarkUrl}?${qs.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { data?: { flux?: Record<string, BenchmarkFlux> } | null }) => {
        if (annule) return;
        if (j && j.data === null) {
          setIndisponible(true);
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
  }, [benchmarkUrl, visible, filtres]);
  return { visible, bench, indisponible, filtres, setFiltres };
}

export type RadarFiche = ReturnType<typeof useRadarFiche>;

/**
 * Bilan d'une collecte : chiffres clés, répartition des tonnages et radar de
 * comparaison avec sa barre « Comparer avec » (ZD), ou repas donnés et
 * association (AG). Rien pour une collecte annulée.
 */
export function BilanCollecte({
  c,
  radar,
  barre,
}: {
  c: BilanFiche;
  radar: RadarFiche;
  // Réglages de la barre « Comparer avec » propres à l'espace.
  barre?: Pick<
    ComponentProps<typeof BenchmarkFilterBar>,
    'perimetre' | 'filtresEndpoint' | 'avertissementComparaisonSoi'
  >;
}) {
  if (STATUTS_ANNULES.includes(c.statut)) return null;
  const isAg = c.type === 'anti_gaspi';
  const sansExcedent = c.statut === 'realisee_sans_collecte';
  const realisee = c.statut === STATUT_BILAN;
  const bilanDispo = realisee || sansExcedent;
  const pax = c.pax ?? null;
  const bench = radar.bench;

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
    <>
      {!bilanDispo && (
        <BandeauBilanAttente titre="Votre bilan sera disponible après la collecte">
          {isAg
            ? 'Repas donnés, CO₂ évité et association bénéficiaire s’afficheront ici le lendemain de la collecte.'
            : 'Poids collectés, CO₂ évité, répartition par flux et comparaison avec des événements similaires s’afficheront ici le lendemain de la collecte.'}
        </BandeauBilanAttente>
      )}

      {sansExcedent ? (
        <Card padding="md" className="space-y-4" data-testid="bloc-aucun-repas">
          <SectionHeader icon={MinusCircle} title="Aucun repas collecté" />
          <Text tone="soft" className="leading-relaxed">
            Notre chauffeur s’est présenté sur place, mais il n’y avait pas
            d’excédent alimentaire à donner. Votre rapport de don atteste que
            cet événement était sans excédent.
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
              label="CO₂ évité"
              nombre={
                realisee && c.co2_evite_kg != null
                  ? fmtInt(c.co2_evite_kg)
                  : '—'
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
            radar.visible &&
            !radar.indisponible && (
              <div data-testid="bloc-3-zd-fiche" key={c.id}>
                <BenchmarkRadar
                  title={TITRE_RADAR}
                  subtitle={SOUS_TITRE_RADAR}
                  items={gaugeItems}
                  filtersSlot={
                    <BenchmarkFilterBar
                      masquerTraiteurs
                      {...barre}
                      onChange={radar.setFiltres}
                      // Barre remontée (retour sur l'onglet Admin, dont l'état
                      // du radar survit à l'onglet) : elle reprend les filtres
                      // réglés. Fiche client : null au montage, sans effet.
                      initialFilters={radar.filtres ?? undefined}
                      initialTypeEvenementIds={
                        c.type_evenement_id ? [c.type_evenement_id] : []
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
    </>
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
  const radar = useRadarFiche(`${base}/benchmark`, c);

  // Documents
  const [telechargement, setTelechargement] = useState<string | null>(null);
  const [fabrication, setFabrication] = useState(false);
  // Rapport de recyclage ZD : fabriqué au clic, avec ou sans le radar de
  // comparaison, au choix de celui qui le télécharge (décision Val 2026-10-16).
  // La case n'existe que là où le radar existe à l'écran (même garde côté
  // serveur) ; elle part décochée.
  const [avecRadar, setAvecRadar] = useState(false);
  const choixRadarPossible = radar.visible && !radar.indisponible;
  const benchFilters = radar.filtres;

  async function telechargerRapport() {
    setTelechargement(null);
    if (!isAg) {
      // ZD : le PDF est fabriqué par la route, avec les filtres affichés au-dessus
      // si le radar est demandé.
      const radarDemande = choixRadarPossible && avecRadar;
      setFabrication(true);
      const erreur = await telechargerRapportRecyclage(`${base}/rapport-rse`, {
        options: { benchmark: radarDemande },
        ...(radarDemande && benchFilters
          ? {
              benchmark_filters: {
                lieu_ids: benchFilters.lieu_ids,
                type_evenement_ids: benchFilters.type_evenement_ids,
                taille_evenement_codes: benchFilters.taille_evenement_codes,
              },
            }
          : {}),
      });
      setFabrication(false);
      setTelechargement(erreur);
      return;
    }
    // AG : le « Rapport de don » est un fichier déjà fabriqué (URL pré-signée).
    setTelechargement(await ouvrirRapportDeDon(base));
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

  // Collecte AG : un seul nom de document, « Rapport de don », avec ou sans
  // excédents (décision Val 2026-10-09). Deux PDF distincts derrière ce nom :
  // l'attestation de don, ou le rapport « Événement sans excédent alimentaire ».
  const rapportNom = isAg ? 'Rapport de don' : 'Rapport RSE';
  // Factures masquées tant que la facturation se fait hors plateforme
  // (décision Val 2026-10-22).
  const factures = facturationPlateformeActive()
    ? (c.factures ?? []).filter(
        (f) =>
          f.statut !== 'brouillon' && (f.pdf_url_pennylane || f.pdf_url_savr),
      )
    : [];

  return (
    <div className="space-y-3">
      <BilanCollecte
        c={c}
        radar={radar}
        barre={{ perimetre: espace === 'gestionnaire' ? 'rattache' : 'parc' }}
      />

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
          {!c.rapport_reserve_donneur_ordre && (
            <Button
              variant="secondary"
              // Radar demandé : on attend les filtres de la fiche (sans eux, le
              // serveur comparerait à « Tous », pas à ce que l'écran affiche).
              disabled={
                !c.rapport_rse_disponible ||
                (choixRadarPossible && avecRadar && !benchFilters)
              }
              loading={fabrication}
              loadingText="Préparation du PDF…"
              onClick={() => void telechargerRapport()}
            >
              Télécharger
            </Button>
          )}
          {!isAg &&
            !c.rapport_reserve_donneur_ordre &&
            c.rapport_rse_disponible &&
            choixRadarPossible && (
              <div className="basis-full" data-testid="option-rapport-radar">
                <Label
                  variant="choice"
                  htmlFor="rapport-avec-radar"
                  className="flex items-center gap-2"
                >
                  <Checkbox
                    id="rapport-avec-radar"
                    checked={avecRadar}
                    onCheckedChange={(v) => setAvecRadar(v === true)}
                  />
                  Inclure le radar de comparaison dans le rapport
                </Label>
                <Text className="mt-1">
                  Le radar du rapport reprend les filtres de comparaison réglés
                  ci-dessus.
                </Text>
              </div>
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
