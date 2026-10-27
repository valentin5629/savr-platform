'use client';

import { useEffect, useState, type ComponentProps } from 'react';
import {
  CheckIcon,
  ClockIcon,
  FilePlusIcon,
  FileTextIcon,
  InfoIcon,
  MinusCircleIcon,
  ProhibitIcon,
} from '@/components/ui/icones';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
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
export const SOUS_TITRE_RADAR =
  'Déchets par convive (kg/pax), flux par flux, comparés à la moyenne anonymisée ' +
  'des événements Savr des 24 derniers mois. À l’intérieur du repère, vous ' +
  'produisez moins que la moyenne.';

// Sous-titre court du radar compact (deux graphes sur une ligne, variante B) ;
// la phrase « à l'intérieur du repère… » reste dans le rapport et les dashboards.
const SOUS_TITRE_RADAR_COMPACT =
  'Déchets par convive (kg/pax) face à la moyenne Savr sur 24 mois.';

interface BenchmarkFlux {
  ratio_user: number | null;
  benchmark_kg_pax: number | null;
}

export function Estompe({
  actif,
  children,
  large = false,
}: {
  actif: boolean;
  children: React.ReactNode;
  /** Espacement de la variante B (fiche client). */
  large?: boolean;
}) {
  return (
    <div
      className={cn(large ? 'space-y-4' : 'space-y-3', actif && 'opacity-40')}
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
      <ClockIcon
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
  /** Accepté pour la variante B (ChiffreCle) ; sans effet sur la carte. */
  ton?: 'succes';
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
              <InfoIcon className="h-4 w-4" />
            </span>
          </Tooltip>
        ) : undefined
      }
    />
  );
}

// Chiffre clé de la variante B (décision Val 2026-10-27) : bandeau ouvert,
// sans carte, libellé en capitales, grand chiffre Archivo et unité plus
// petite sur la même ligne, filets entre les chiffres.
function ChiffreCle({
  label,
  nombre,
  unite,
  aide,
  ton,
}: {
  label: string;
  nombre: string;
  unite?: string;
  aide?: string;
  ton?: 'succes';
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 border-savr-sable-200 sm:border-l sm:pl-6 sm:first:border-l-0 sm:first:pl-0 lg:pl-8">
      <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-savr-neutral-500">
        {label}
        {aide && (
          <Tooltip content={aide}>
            <span
              tabIndex={0}
              aria-label={aide}
              className="inline-flex cursor-help normal-case tracking-normal"
            >
              <InfoIcon className="h-3.5 w-3.5" />
            </span>
          </Tooltip>
        )}
      </span>
      <span className="flex items-baseline gap-1.5 whitespace-nowrap">
        <span
          className={
            ton === 'succes'
              ? 'font-display text-[30px] font-semibold leading-none tracking-[-0.045em] text-savr-success-strong tabular-nums'
              : 'font-display text-[30px] font-semibold leading-none tracking-[-0.045em] text-savr-primary-900 tabular-nums'
          }
        >
          {nombre}
        </span>
        {unite && (
          <span className="text-[15px] font-medium text-savr-neutral-600">
            {unite}
          </span>
        )}
      </span>
    </div>
  );
}

const BANDE_CHIFFRES =
  'grid grid-cols-1 gap-y-4 border-b border-savr-sable-200 pb-4 sm:grid-cols-2 lg:grid-cols-4';

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
  presentation = 'standard',
  actionRadar,
}: {
  c: BilanFiche;
  radar: RadarFiche;
  /**
   * Action posée à côté du radar compact (variante B) : le bouton « Intégrer
   * la comparaison au rapport à télécharger » de la fiche client.
   */
  actionRadar?: React.ReactNode;
  /**
   * `variante-b` : fiche collecte client (décision Val 2026-10-27) — chiffres
   * en bandeau ouvert, répartition et radar compact sur une ligne, filtres en
   * pastilles. `standard` (défaut) : fiche Admin, inchangée (C1).
   */
  presentation?: 'standard' | 'variante-b';
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
  const vb = presentation === 'variante-b';
  const Chiffre = vb ? ChiffreCle : Kpi;

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

  const radarAffiche = radar.visible && !radar.indisponible;

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
          <SectionHeader icon={MinusCircleIcon} title="Aucun repas collecté" />
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
        <Estompe actif={!realisee} large={vb}>
          <div
            className={
              vb
                ? 'grid grid-cols-1 gap-y-4 border-b border-savr-sable-200 pb-4 sm:grid-cols-3'
                : 'grid grid-cols-1 gap-3 sm:grid-cols-3'
            }
            data-testid="kpi-ag"
          >
            <Chiffre
              label="Repas donnés"
              nombre={repas != null ? fmtInt(repas) : '—'}
              unite="repas"
            />
            <Chiffre
              label="Repas par pax"
              nombre={repas != null && pax ? fmtDec(repas / pax, 2) : '—'}
            />
            <Chiffre
              ton="succes"
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
        <Estompe actif={!realisee} large={vb}>
          <div
            className={
              vb
                ? BANDE_CHIFFRES
                : 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4'
            }
            data-testid="kpi-zd"
          >
            <Chiffre
              label="Poids total collecté"
              nombre={masse ? masse.value : '—'}
              unite={masse ? masse.unit : 'kg'}
            />
            <Chiffre
              ton="succes"
              label="CO₂ évité"
              nombre={
                realisee && c.co2_evite_kg != null
                  ? fmtInt(c.co2_evite_kg)
                  : '—'
              }
              unite={UNITE_KG_CO2E}
            />
            <Chiffre
              label="Taux de recyclage"
              aide={TOOLTIP_TAUX_UE}
              nombre={
                realisee && c.taux_recyclage != null
                  ? fmtDec(c.taux_recyclage, 1)
                  : '—'
              }
              unite="%"
            />
            <Chiffre
              label="Pesée par pax"
              nombre={
                poidsTotal != null && pax
                  ? fmtInt((poidsTotal / pax) * 1000)
                  : '—'
              }
              unite="g"
            />
          </div>
          {/* Variante B : répartition et radar sur la même ligne. */}
          <div
            className={
              vb && (radarAffiche || !realisee)
                ? 'grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2'
                : vb
                  ? 'grid grid-cols-1 gap-5'
                  : 'space-y-3'
            }
          >
            {realisee ? (
              <TonnagesDonut
                series={serieDonut}
                disposition="ligne"
                className={vb ? 'h-full p-5' : 'h-full'}
              />
            ) : (
              <GrapheEnAttente titre="Répartition des tonnages" />
            )}
            {!realisee ? (
              <GrapheEnAttente titre={TITRE_RADAR} />
            ) : (
              radarAffiche && (
                <div
                  data-testid="bloc-3-zd-fiche"
                  key={c.id}
                  className="h-full"
                >
                  <BenchmarkRadar
                    title={TITRE_RADAR}
                    subtitle={vb ? SOUS_TITRE_RADAR_COMPACT : SOUS_TITRE_RADAR}
                    items={gaugeItems}
                    disposition={vb ? 'compacte' : 'standard'}
                    referenceLabel={
                      vb ? 'Moyenne des événements comparables' : undefined
                    }
                    className={vb ? 'h-full p-5' : undefined}
                    actionSlot={vb ? actionRadar : undefined}
                    filtersSlot={
                      <BenchmarkFilterBar
                        masquerTraiteurs
                        disposition={vb ? 'pastilles' : 'barre'}
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
          </div>
        </Estompe>
      )}
    </>
  );
}

/**
 * Téléchargement du rapport de la collecte (« Rapport RSE » ZD fabriqué au
 * clic, « Rapport de don » AG déjà fabriqué). Porté par le panneau : le bouton
 * « Télécharger le rapport » est dans le pied de la fiche, visible sans
 * défiler (décision Val 2026-10-27) ; le bouton « Intégrer la comparaison au
 * rapport » est à côté du radar, l'état du rapport en infobulle du bouton grisé.
 */
export function useRapportCollecte(
  c: FicheClientDonnees | null,
  base: string,
  radar: RadarFiche,
) {
  const [erreur, setErreur] = useState<string | null>(null);
  const [fabrication, setFabrication] = useState(false);
  // Rapport de recyclage ZD : fabriqué au clic, avec ou sans le radar de
  // comparaison, au choix de celui qui le télécharge (décision Val 2026-10-16).
  // Le choix n'existe que là où le radar existe à l'écran (même garde côté
  // serveur) ; il part désactivé.
  const [avecRadar, setAvecRadar] = useState(false);
  const isAg = c?.type === 'anti_gaspi';
  const choixRadarPossible = radar.visible && !radar.indisponible;
  const benchFilters = radar.filtres;
  // Bouton présent sauf sur une collecte annulée ou pour un rapport réservé au
  // donneur d'ordre (D12 2026-09-30) ; grisé tant que le rapport n'est pas
  // disponible (arbitrage Val 2026-09-30).
  const visible =
    c != null &&
    !STATUTS_ANNULES.includes(c.statut) &&
    !c.rapport_reserve_donneur_ordre;
  // Radar demandé : on attend les filtres de la fiche (sans eux, le serveur
  // comparerait à « Tous », pas à ce que l'écran affiche).
  const desactive =
    !c?.rapport_rse_disponible ||
    (choixRadarPossible && avecRadar && !benchFilters);

  async function telecharger() {
    setErreur(null);
    if (!isAg) {
      // ZD : le PDF est fabriqué par la route, avec les filtres affichés si le
      // radar est demandé.
      const radarDemande = choixRadarPossible && avecRadar;
      setFabrication(true);
      const e = await telechargerRapportRecyclage(`${base}/rapport-rse`, {
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
      setErreur(e);
      return;
    }
    // AG : le « Rapport de don » est un fichier déjà fabriqué (URL pré-signée).
    setErreur(await ouvrirRapportDeDon(base));
  }

  return {
    visible,
    desactive,
    fabrication,
    erreur,
    avecRadar,
    setAvecRadar,
    choixRadarPossible,
    telecharger,
  };
}

export type RapportCollecte = ReturnType<typeof useRapportCollecte>;

export function OngletBilan({
  c,
  espace,
  radar,
  rapport,
}: {
  c: FicheClientDonnees;
  espace: EspaceClient;
  radar: RadarFiche;
  rapport: RapportCollecte;
}) {
  const isAg = c.type === 'anti_gaspi';
  const annulee = STATUTS_ANNULES.includes(c.statut);
  const { avecRadar, setAvecRadar, choixRadarPossible } = rapport;

  if (annulee) {
    return (
      <Card
        padding="md"
        className="flex items-start gap-3"
        data-testid="bilan-annulee"
      >
        <ProhibitIcon
          className="mt-0.5 h-5 w-5 shrink-0 text-savr-neutral-400"
          aria-hidden="true"
        />
        <Text variant="body">Collecte annulée : aucun bilan ni document.</Text>
      </Card>
    );
  }

  // Factures masquées tant que la facturation se fait hors plateforme
  // (décision Val 2026-10-22).
  const factures = facturationPlateformeActive()
    ? (c.factures ?? []).filter(
        (f) =>
          f.statut !== 'brouillon' && (f.pdf_url_pennylane || f.pdf_url_savr),
      )
    : [];

  const reserve = c.rapport_reserve_donneur_ordre;

  // Rapport RSE fabriqué avec ou sans le radar, au choix de celui qui le
  // télécharge (Val 2026-10-16). Variante B (Val 2026-10-27) : le choix est un
  // bouton à côté du radar ; le rapport se télécharge depuis le pied de la
  // fiche (plus d'encadré « Rapport RSE » dans l'onglet).
  const actionRadar =
    !isAg && !c.rapport_reserve_donneur_ordre && choixRadarPossible ? (
      // Visible dès que le radar l'est ; grisé, comme « Télécharger le
      // rapport », tant que le rapport n'est pas disponible (Val 2026-10-27).
      <Button
        variant="sable"
        size="sm"
        aria-pressed={avecRadar}
        data-testid="option-rapport-radar"
        disabled={!c.rapport_rse_disponible}
        title="Le radar du rapport reprend les filtres de comparaison réglés ici."
        onClick={() => setAvecRadar(!avecRadar)}
        className={cn(
          'h-auto min-h-9 w-full justify-start whitespace-normal rounded-savr-lg px-3 py-2 text-left',
          avecRadar &&
            'bg-savr-primary-50 text-savr-primary-900 hover:bg-savr-primary-100',
        )}
      >
        {avecRadar ? (
          <CheckIcon aria-hidden="true" />
        ) : (
          <FilePlusIcon aria-hidden="true" />
        )}
        Intégrer la comparaison au rapport à télécharger
      </Button>
    ) : undefined;

  return (
    <div className="space-y-3">
      <BilanCollecte
        c={c}
        radar={radar}
        barre={{ perimetre: espace === 'gestionnaire' ? 'rattache' : 'parc' }}
        presentation="variante-b"
        actionRadar={actionRadar}
      />

      {/* Le rapport se télécharge depuis le pied. Restent ici : le rapport
          réservé au donneur d'ordre (pas de bouton, D12) et les factures. */}
      {(reserve || factures.length > 0) && (
        <Card
          className="divide-y divide-savr-neutral-100 p-0"
          data-testid="bloc-documents"
        >
          {reserve && (
            <div className="flex items-center gap-3 px-5 py-3.5">
              <FileTextIcon
                className="h-5 w-5 shrink-0 text-savr-primary-700"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-savr-neutral-900">
                  {isAg ? 'Rapport de don' : 'Rapport RSE'}
                </p>
                <Text>{LIBELLE_ETAT_RAPPORT.reserve}</Text>
              </div>
            </div>
          )}
          {factures.map((f) => (
            <div
              key={f.id}
              className="flex flex-wrap items-center gap-3 px-5 py-3.5"
              data-testid="document-facture"
            >
              <FileTextIcon
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
        </Card>
      )}
    </div>
  );
}
