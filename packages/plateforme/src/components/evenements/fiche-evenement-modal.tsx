'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CalendarDotsIcon,
  ChefHatIcon,
  FileTextIcon,
  HandHeartIcon,
  InfoIcon,
  MapPinIcon,
  PlusCircleIcon,
  TruckIcon,
  UsersIcon,
} from '@/components/ui/icones';
import Link from 'next/link';
import { AlertBar } from '@/components/ui/alert-bar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { EnTetePuce } from '@/components/ui/fiche/fiche-en-tete';
import {
  FicheGrandEnTete,
  FicheOnglet,
  FicheOnglets,
  FicheRepere,
} from '@/components/ui/fiche/fiche-grand-en-tete';
import { FicheCorps, FicheModal } from '@/components/ui/fiche/fiche-modal';
import {
  FichePastille,
  type TonPastille,
} from '@/components/ui/fiche/fiche-pastille';
import { FicheSection } from '@/components/ui/fiche/fiche-section';
import { Heading } from '@/components/ui/heading';
import { InfoItem } from '@/components/ui/info-item';
import { SectionHeader } from '@/components/ui/section-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { Text } from '@/components/ui/text';
import { Tooltip } from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/toast';
import { CollecteStatutBadge } from '@/components/ui/collecte-statut-badge';
import { TypeCollecteBadge } from '@/components/ui/type-collecte-badge';
import { TelephoneLien } from '@/components/collecte/fiche-blocs';
import {
  BandeauBilanAttente,
  Estompe,
  GrapheEnAttente,
  Kpi,
  useRadarFiche,
  type RadarFiche,
} from '@/components/collecte/fiche-collecte-client-bilan';
import { Chauffeurs } from '@/components/collecte/fiche-collecte-client-onglets';
import { FicheCollecteClientModal } from '@/components/collecte/fiche-collecte-client-modal';
import { CollecteDetailModal } from '@/components/admin/collecte-detail-modal';
import type { EspaceFiche } from '@/lib/evenements/fiche-evenement';
import type { OngletFiche } from '@/components/collecte/fiche-collecte-client-panel';
import {
  ToggleTypeCollecte,
  type CollecteType,
} from '@/components/collecte/toggle-type-collecte';
import { libelleTypeCollecte } from '@/lib/libelles/type-collecte';
import { TonnagesDonut } from '@/components/dashboards/charts/cockpit/TonnagesDonut';
import { BenchmarkRadar } from '@/components/dashboards/charts/cockpit/BenchmarkRadar';
import { BenchmarkFilterBar, FLUX_ZD } from '@/components/dashboards';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  LIBELLE_ETAT_RAPPORT,
  STATUTS_ANNULES,
  STATUT_BILAN,
  type EspaceClient,
  type FicheCollecteClient,
} from '@/lib/collectes/fiche-client-types';
import {
  ouvrirRapportDeDon,
  telechargerRapportRecyclage,
} from '@/lib/collectes/rapport-telechargement-client';
import {
  couvertureBilan,
  type BilanEvenement,
} from '@/lib/evenements-gestionnaire';
import { estUuid } from '@/lib/filtre-csv';
import { libelleDateHeure, libelleMisAJour } from '@/lib/format-date-collecte';
import {
  fmtDec,
  fmtInt,
  fmtKg,
  fmtMasse,
  fmtPax,
  UNITE_KG_CO2E,
} from '@/lib/format';
import { ROUTES } from '@/lib/routes';
import { friseStatutEvenement } from '@/lib/statut-collecte-labels';
import { EntreeGraphiques } from '@/components/dashboards/charts/entree-graphique';

// Fiche événement, en pop-up sur la liste Événements, commune aux espaces qui
// ont une fiche collecte client (gestionnaire, traiteur, agence : décision Val
// 2026-10-29, « même fiche pour tous ») ; benchmark et déchets labo estimés au
// gestionnaire seul. Née dans l'espace gestionnaire de lieux,
// au grand format de la variante B (décision Val 2026-10-27 : grand en-tête,
// onglets soulignés dans l'en-tête, seul le corps défile, sections en lignes).
// Trois onglets (décision Val 2026-10-26), au format de la fiche collecte :
// « Informations générales » (événement, lieu), « Informations collectes » (une
// carte par collecte, demande urgente comprise) et « Bilan & documents » (bilan
// consolidé, rapports de chaque collecte). En-tête : pastille d'avancement,
// dérivée des collectes, à la place de la frise (décision Val 2026-10-27).
//
// Consultation (§06.05 §2), à deux gestes près : « Ajouter une collecte » sur
// les événements que l'organisation de l'utilisateur a programmés (décision Val
// 2026-10-21), et la demande urgente des coordonnées d'un chauffeur, la même que
// sur la fiche collecte. Une fiche collecte s'ouvre par-dessus (« Voir la
// collecte », « Accéder au bilan… ») : tant qu'elle est ouverte, la fiche
// événement ne se ferme pas, et sa fermeture recharge l'événement.

interface EvenementDetail {
  id: string;
  nom_evenement: string | null;
  date_evenement: string | null;
  pax: number | null;
  taille_bracket: string;
  client_nom: string | null;
  lieu_nom: string | null;
  lieu_adresse: string | null;
  lieu_acces_details: string | null;
  traiteur: { id: string; nom: string | null; a_logo: boolean } | null;
  dechets_labo_kg: number | null;
  // Événement programmé par l'organisation de l'utilisateur (cf. la route).
  ajouter_collecte: boolean;
  bilan: BilanEvenement;
  // Fiche de chaque collecte, dans l'ordre chronologique.
  fiches: FicheCollecteClient[];
  // Staff : statut de chaque collecte en vue Admin (cf. la route).
  statuts_admin?: Record<string, string>;
}

type Etat = 'chargement' | 'erreur' | 'introuvable' | 'pret';
type Onglet = 'informations' | 'collectes' | 'bilan';
type Urgence = { etat: 'idle' | 'envoi' | 'envoyee'; erreur: string | null };

// Infobulle du taux consolidé : la règle de calcul, pour qu'un écart avec la
// moyenne simple des taux affichés sur chaque collecte ne surprenne pas.
// Titre du radar du bilan consolidé, et clé « en cours » du rapport cumulé.
const TITRE_RADAR = 'Votre événement face aux événements comparables';
const CUMUL = 'cumul';
const AIDE_TAUX =
  'Moyenne des taux de recyclage des collectes réalisées, pondérée par leur poids collecté.';
const AIDE_LABO =
  'Estimation amont, distincte des déchets collectés sur l’événement.';

const GRILLE =
  'grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3';

const VIDE = <span className="text-savr-neutral-400">—</span>;

const annulee = (f: FicheCollecteClient) => STATUTS_ANNULES.includes(f.statut);

// Avancement de l'événement en pastille, à droite du titre (décision Val
// 2026-10-27, comme les fiches collecte) : l'étape courante de l'ancienne frise
// (Créé · Validé · En cours · Réalisé, ou Annulé), mêmes tons que la pastille
// de la fiche collecte client.
const TONS_AVANCEMENT: readonly TonPastille[] = [
  'sable',
  'bleu',
  'orange',
  'vert',
];

function StatutEvenement({ statuts }: { statuts: readonly string[] }) {
  const etapes = friseStatutEvenement(statuts);
  const rang = Math.max(
    0,
    etapes.findIndex((e) => e.etat === 'courante'),
  );
  const libelle = etapes[rang]?.label ?? '';
  const annule = etapes.length === 2;
  return (
    <FichePastille
      ton={annule ? 'rouge' : (TONS_AVANCEMENT[rang] ?? 'sable')}
      data-testid="statut-evenement"
      aria-label={`Avancement de l’événement : ${libelle}`}
    >
      {libelle}
    </FichePastille>
  );
}

/** Adresse et instructions d'accès EFFECTIVES d'une collecte (lieu + surcharges
 * saisies à la programmation, telles que la fiche collecte les sert). */
const adresseDe = (f: FicheCollecteClient) => {
  const l = f.evenement?.lieu;
  return (
    [l?.adresse_acces, l?.code_postal, l?.ville].filter(Boolean).join(' ') ||
    null
  );
};
const accesDe = (f: FicheCollecteClient) =>
  f.evenement?.lieu?.acces_details?.trim() || null;

/** Valeur commune aux collectes ; `undefined` si elles diffèrent ou s'il n'y en a pas. */
function commune(
  fiches: FicheCollecteClient[],
  lire: (f: FicheCollecteClient) => string | null,
): string | null | undefined {
  const valeurs = new Set(fiches.map(lire));
  return valeurs.size === 1 ? [...valeurs][0] : undefined;
}

const SELON_LA_COLLECTE = (
  <span className="font-normal text-savr-neutral-500">
    Propre à chaque collecte, voir ci-dessous.
  </span>
);

/** « Collecte du Lun 26 Oct · 08h00 » : titre de carte d'une collecte. */
function titreCollecte(f: FicheCollecteClient): string {
  return `Collecte du ${libelleDateHeure(f.date_collecte, f.heure_collecte)}`;
}

/**
 * Liens vers le bilan de chaque collecte d'un type, quand l'événement en compte
 * plus d'une (décision Val 2026-10-26) : avec une seule, le cumul EST son bilan.
 */
function LiensBilans({
  fiches,
  onOuvrir,
}: {
  fiches: FicheCollecteClient[];
  /** Absent : aucune fiche collecte à ouvrir (client organisateur). */
  onOuvrir?: (id: string) => void;
}) {
  if (fiches.length < 2 || !onOuvrir) return null;
  return (
    <ul className="space-y-1" data-testid="liens-bilans">
      {fiches.map((f) => (
        <li key={f.id}>
          <Button
            variant="link"
            className="h-auto min-h-11 px-0 text-left sm:min-h-0"
            onClick={() => onOuvrir(f.id)}
          >
            Accéder au bilan de la collecte du{' '}
            {libelleDateHeure(f.date_collecte, f.heure_collecte)}
          </Button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Bilan consolidé : cumul des collectes réalisées de l'événement, au format de
 * l'onglet « Bilan & documents » de la fiche collecte (décision Val
 * 2026-10-26) — bandeau d'attente, chiffres clés estompés tant qu'aucune
 * collecte du type n'est réalisée, répartition des tonnages. Le radar de
 * comparaison reste propre à chaque collecte (filtres par collecte).
 */
function BilanConsolide({
  b,
  type,
  deuxTypes,
  dateEvenement,
  actives,
  onOuvrirBilan,
  radar,
  filtresInitiaux,
}: {
  b: BilanEvenement;
  // Type affiché : le seul de l'événement, ou celui du sous-onglet.
  type: CollecteType;
  deuxTypes: boolean;
  dateEvenement: string | null;
  actives: FicheCollecteClient[];
  onOuvrirBilan?: (id: string) => void;
  radar: RadarFiche;
  // Filtres sur lesquels s'ouvre la barre « Comparer avec » du radar.
  filtresInitiaux: { typeEvenementIds: string[]; tailleCodes: string[] };
}) {
  const zd = type === 'zero_dechet';
  const nbCollectes = zd ? b.nb_collectes_zd : b.nb_collectes_ag;
  const nbRealisees = zd ? b.nb_realisees_zd : b.nb_realisees_ag;
  const masse = b.tonnage_zd_kg != null ? fmtMasse(b.tonnage_zd_kg) : null;
  const serieDonut = [
    {
      periode: dateEvenement ?? '',
      ...b.flux_kg,
      tonnage_total: b.tonnage_zd_kg ?? 0,
      taux_recyclage: b.taux_recyclage,
    },
  ];
  const donutAffiche = b.tonnage_zd_kg != null && b.tonnage_zd_kg > 0;
  const radarAffiche = radar.visible && !radar.indisponible;

  return (
    <section className="space-y-3" data-testid="bilan-consolide">
      {nbCollectes > 0 && nbRealisees === 0 && (
        <BandeauBilanAttente titre="Votre bilan sera disponible après les collectes">
          Poids collectés, CO₂ évité, repas donnés et répartition par flux
          s’afficheront ici le lendemain de chaque collecte, et se cumuleront au
          fil des collectes de l’événement.
        </BandeauBilanAttente>
      )}
      <Text variant="hint" data-testid="bilan-consolide-couverture">
        {couvertureBilan(
          nbRealisees,
          nbCollectes,
          deuxTypes ? libelleTypeCollecte(type) : '',
        )}
      </Text>

      {zd && nbCollectes > 0 && (
        <div className="space-y-3" data-testid="bilan-consolide-zd">
          <Estompe actif={b.nb_realisees_zd === 0}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi
                label="Poids total collecté"
                nombre={masse ? masse.value : '—'}
                unite={masse ? masse.unit : 'kg'}
              />
              <Kpi
                label="CO₂ évité"
                nombre={
                  b.co2_evite_zd_kg != null ? fmtInt(b.co2_evite_zd_kg) : '—'
                }
                unite={UNITE_KG_CO2E}
              />
              <Kpi
                label="Taux de recyclage"
                aide={AIDE_TAUX}
                nombre={
                  b.taux_recyclage != null ? fmtDec(b.taux_recyclage, 1) : '—'
                }
                unite="%"
              />
              <Kpi
                label="Pesée par pax"
                nombre={
                  b.pesee_par_pax_kg != null
                    ? fmtInt(b.pesee_par_pax_kg * 1000)
                    : '—'
                }
                unite="g"
              />
            </div>
            {/* Comme la fiche collecte : répartition et radar sur la même
                ligne, une seule colonne quand l'un des deux manque. */}
            <div
              data-testid="ligne-graphes-evenement"
              className={
                b.nb_realisees_zd === 0 || (donutAffiche && radarAffiche)
                  ? 'grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2'
                  : 'grid grid-cols-1 gap-4'
              }
            >
              {b.nb_realisees_zd === 0 ? (
                <GrapheEnAttente titre="Répartition des tonnages" />
              ) : (
                donutAffiche && (
                  <TonnagesDonut
                    series={serieDonut}
                    disposition="ligne"
                    className="h-full p-5"
                  />
                )
              )}
              {b.nb_realisees_zd === 0 ? (
                <GrapheEnAttente titre={TITRE_RADAR} />
              ) : (
                radarAffiche && (
                  <div data-testid="radar-evenement" className="h-full">
                    <BenchmarkRadar
                      title={TITRE_RADAR}
                      serieLabel="Cet événement"
                      className="h-full p-5"
                      items={FLUX_ZD.map((f) => ({
                        label: f.label,
                        value: radar.bench?.[f.code]?.ratio_user ?? null,
                        benchmark:
                          radar.bench?.[f.code]?.benchmark_kg_pax ?? null,
                      }))}
                      filtersSlot={
                        <BenchmarkFilterBar
                          masquerTraiteurs
                          disposition="pastilles"
                          perimetre="rattache"
                          onChange={radar.setFiltres}
                          initialFilters={radar.filtres ?? undefined}
                          initialTypeEvenementIds={
                            filtresInitiaux.typeEvenementIds
                          }
                          initialTailleCodes={filtresInitiaux.tailleCodes}
                        />
                      }
                    />
                  </div>
                )
              )}
            </div>
          </Estompe>
          <LiensBilans
            fiches={actives.filter((f) => f.type === 'zero_dechet')}
            onOuvrir={onOuvrirBilan}
          />
        </div>
      )}

      {!zd && nbCollectes > 0 && (
        <div className="space-y-3" data-testid="bilan-consolide-ag">
          <Estompe actif={b.nb_realisees_ag === 0}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Kpi
                label="Repas donnés"
                nombre={b.repas_donnes != null ? fmtInt(b.repas_donnes) : '—'}
                unite="repas"
              />
              <Kpi
                label="Repas par pax"
                nombre={
                  b.repas_par_pax != null ? fmtDec(b.repas_par_pax, 2) : '—'
                }
              />
              <Kpi
                label="CO₂ évité"
                nombre={
                  b.co2_evite_ag_kg != null ? fmtInt(b.co2_evite_ag_kg) : '—'
                }
                unite={UNITE_KG_CO2E}
              />
            </div>
            {b.associations.length > 0 && (
              <Card padding="md" className="space-y-4">
                <SectionHeader
                  icon={HandHeartIcon}
                  title={
                    b.associations.length > 1
                      ? 'Associations bénéficiaires'
                      : 'Association bénéficiaire'
                  }
                  level={3}
                />
                <ul
                  className="divide-y divide-savr-neutral-100 text-sm"
                  data-testid="associations-beneficiaires"
                >
                  {b.associations.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center justify-between gap-3 py-2"
                    >
                      <span>
                        <span className="font-medium">{a.nom}</span>
                        {a.ville && (
                          <Text as="span" variant="hint">
                            {' '}
                            · {a.ville}
                          </Text>
                        )}
                      </span>
                      <span className="whitespace-nowrap tabular-nums">
                        {fmtInt(a.repas)} repas
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </Estompe>
          <LiensBilans
            fiches={actives.filter((f) => f.type === 'anti_gaspi')}
            onOuvrir={onOuvrirBilan}
          />
        </div>
      )}
    </section>
  );
}

/**
 * Rapports de l'événement : en tête, le rapport CUMULÉ du type (décision Val
 * 2026-10-26 : Rapport RSE en ZD, avec ou sans radar ; Rapport de don en AG,
 * récapitulatif sans valeur fiscale), fabriqué au clic dès qu'une collecte du
 * type a ses résultats ; puis celui de chaque collecte non annulée (Rapport
 * RSE en ZD, fabriqué au clic ; Rapport de don en AG, fichier déjà fabriqué).
 */
function DocumentsEvenement({
  espace,
  evenementId,
  type,
  nbRealisees,
  radar,
  actives,
}: {
  espace: EspaceFiche;
  evenementId: string;
  type: CollecteType;
  nbRealisees: number;
  radar: RadarFiche;
  actives: FicheCollecteClient[];
}) {
  const [enCours, setEnCours] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  // Rapport cumulé : pas le rapport de don au client organisateur (la base lui
  // refuse les attributions, le rapport serait faux).
  const avecCumul = espace !== 'organisateur' || type === 'zero_dechet';
  // Rapport cumulé ZD : radar au choix de celui qui le télécharge, sur les
  // filtres réglés au-dessus ; la case part décochée (comme la fiche collecte).
  const [avecRadar, setAvecRadar] = useState(false);
  if (actives.length === 0 && (nbRealisees === 0 || !avecCumul)) return null;
  const zd = type === 'zero_dechet';
  const choixRadarPossible = zd && radar.visible && !radar.indisponible;
  const radarDemande = choixRadarPossible && avecRadar;

  async function telechargerCumul() {
    const base = `/api/v1/evenements/${encodeURIComponent(evenementId)}`;
    const filtres = radar.filtres;
    setErreur(null);
    setEnCours(CUMUL);
    const message = await telechargerRapportRecyclage(
      `${base}/${zd ? 'rapport-rse' : 'rapport-de-don'}`,
      {
        options: { benchmark: radarDemande },
        ...(radarDemande && filtres
          ? {
              benchmark_filters: {
                lieu_ids: filtres.lieu_ids,
                type_evenement_ids: filtres.type_evenement_ids,
                taille_evenement_codes: filtres.taille_evenement_codes,
              },
            }
          : {}),
      },
    );
    setEnCours(null);
    setErreur(message);
  }

  // Mêmes chemins que l'onglet Bilan de la fiche collecte (rapport ZD sans
  // radar : ses filtres de comparaison sont propres à chaque collecte).
  async function telecharger(f: FicheCollecteClient) {
    const base = `/api/v1/${encodeURIComponent(espace)}/collectes/${encodeURIComponent(f.id)}`;
    setErreur(null);
    setEnCours(f.id);
    const message =
      f.type === 'anti_gaspi'
        ? await ouvrirRapportDeDon(base)
        : await telechargerRapportRecyclage(`${base}/rapport-rse`, {
            options: { benchmark: false },
          });
    setEnCours(null);
    setErreur(message ? `${titreCollecte(f)} : ${message}` : null);
  }

  return (
    <section className="space-y-3">
      <SectionHeader icon={FileTextIcon} title="Documents" level={3} />
      <Card
        className="divide-y divide-savr-neutral-100 p-0"
        data-testid="documents-evenement"
      >
        {avecCumul && (
          <div
            className="flex flex-wrap items-center gap-3 px-5 py-3.5"
            data-testid="document-evenement-cumul"
          >
            <FileTextIcon
              className="h-5 w-5 shrink-0 text-savr-primary-700"
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <p className="text-md font-semibold text-savr-neutral-900">
                {zd
                  ? 'Rapport RSE de l’événement'
                  : 'Rapport de don de l’événement'}
              </p>
              <Text>
                {nbRealisees === 0
                  ? 'Disponible dès la première collecte réalisée'
                  : zd
                    ? 'Cumul des collectes réalisées'
                    : 'Récapitulatif des collectes réalisées, sans valeur fiscale : les rapports de don de chaque collecte font foi'}
              </Text>
            </div>
            <Button
              variant="secondary"
              // Radar demandé : on attend les filtres de la barre (sans eux, le
              // serveur comparerait à « Tous », pas à ce que l'écran affiche).
              disabled={
                nbRealisees === 0 ||
                enCours !== null ||
                (radarDemande && !radar.filtres)
              }
              loading={enCours === CUMUL}
              loadingText="Préparation du PDF…"
              onClick={() => void telechargerCumul()}
            >
              Télécharger
            </Button>
            {nbRealisees > 0 && choixRadarPossible && (
              <div
                className="basis-full"
                data-testid="option-rapport-evenement-radar"
              >
                <Label
                  variant="choice"
                  htmlFor="rapport-evenement-avec-radar"
                  className="flex items-center gap-2"
                >
                  <Checkbox
                    id="rapport-evenement-avec-radar"
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
        )}
        {actives.map((f) => (
          <div
            key={f.id}
            className="flex flex-wrap items-center gap-3 px-5 py-3.5"
            data-testid="document-collecte"
          >
            <FileTextIcon
              className="h-5 w-5 shrink-0 text-savr-primary-700"
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <p className="text-md font-semibold text-savr-neutral-900">
                {f.type === 'anti_gaspi' ? 'Rapport de don' : 'Rapport RSE'}
              </p>
              <Text>
                {titreCollecte(f)} · {LIBELLE_ETAT_RAPPORT[f.rapport_etat]}
                {f.rapport_mis_a_jour_at &&
                  ` · ${libelleMisAJour(f.rapport_mis_a_jour_at)}`}
              </Text>
            </div>
            <Button
              variant="secondary"
              disabled={!f.rapport_rse_disponible || enCours !== null}
              loading={enCours === f.id}
              loadingText="Préparation du PDF…"
              onClick={() => void telecharger(f)}
            >
              Télécharger
            </Button>
          </div>
        ))}
        {erreur && (
          <AlertBar variant="err" role="alert" className="mx-5 my-3">
            {erreur}
          </AlertBar>
        )}
      </Card>
    </section>
  );
}

/**
 * Carte d'une collecte dans « Informations collectes » : ses informations
 * (pax, type d'événement, contacts, informations supplémentaires) et sa
 * logistique (chauffeur, plaque, téléphone, demande urgente) réunies
 * (décision Val 2026-10-26).
 */
function CarteCollecte({
  f,
  avecAdresse,
  avecAcces,
  urgence,
  onDemanderUrgence,
  onOuvrir,
  detail,
  statutAdmin,
}: {
  f: FicheCollecteClient;
  /** Staff : statut en vue Admin (granularité complète), sinon vue client. */
  statutAdmin?: string;
  /** Contacts, informations supplémentaires et chauffeurs : fiche collecte client seulement. */
  detail: boolean;
  // Adresse / instructions d'accès différentes d'une collecte à l'autre : la
  // carte porte les siennes, le bloc Lieu renvoie ici.
  avecAdresse: boolean;
  avecAcces: boolean;
  urgence: Urgence | undefined;
  onDemanderUrgence: () => void;
  /** Absent : pas de fiche collecte à ouvrir (client organisateur). */
  onOuvrir?: () => void;
}) {
  const secours = Boolean(
    f.contact_secours_nom?.trim() || f.contact_secours_telephone?.trim(),
  );
  return (
    <Card
      padding="md"
      className="flex flex-col gap-4"
      data-testid="carte-collecte"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <TypeCollecteBadge type={f.type} />
          <Heading level={3} size="base" weight="extrabold">
            {titreCollecte(f)}
          </Heading>
        </div>
        {statutAdmin ? (
          <CollecteStatutBadge statut={statutAdmin} vue="admin" />
        ) : (
          <CollecteStatutBadge statut={f.statut} />
        )}
      </div>
      {/* Une carte par ligne, pleine largeur (la plupart des événements n'ont
          qu'une collecte — demande Val 2026-10-29) : informations à gauche,
          chauffeur à droite sur grand écran, l'un sous l'autre ailleurs. */}
      <div
        className={
          detail ? 'grid grid-cols-1 gap-5 lg:grid-cols-2 lg:gap-8' : undefined
        }
      >
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <InfoItem label="Pax">{fmtInt(f.pax)}</InfoItem>
          <InfoItem label="Type d’événement">
            {f.type_evenement?.libelle ?? VIDE}
          </InfoItem>
          {/* Contacts : ceux de LA collecte ; masqués sur la collecte d'un
            traiteur tiers (§06.05), décidé par le serveur. */}
          {!detail ? null : f.contacts_visibles ? (
            <>
              <InfoItem label="Contact principal">
                {f.contact_principal_nom ?? VIDE}
                <span className="block font-normal">
                  <TelephoneLien telephone={f.contact_principal_telephone} />
                </span>
              </InfoItem>
              <InfoItem label="Contact de secours">
                {secours ? (
                  <>
                    {f.contact_secours_nom ?? VIDE}
                    <span className="block font-normal">
                      <TelephoneLien telephone={f.contact_secours_telephone} />
                    </span>
                  </>
                ) : (
                  VIDE
                )}
              </InfoItem>
            </>
          ) : (
            <InfoItem label="Contacts sur place" className="sm:col-span-2">
              <span className="font-normal text-savr-neutral-500">
                Réservés au traiteur qui a programmé la collecte.
              </span>
            </InfoItem>
          )}
          {avecAdresse && (
            <InfoItem label="Adresse" className="sm:col-span-2">
              {adresseDe(f) ?? VIDE}
            </InfoItem>
          )}
          {avecAcces && (
            <InfoItem
              variant="texte"
              label="Instructions d’accès"
              className="sm:col-span-2"
              valueClassName="whitespace-pre-line"
            >
              {accesDe(f) ?? VIDE}
            </InfoItem>
          )}
          {detail && (
            <InfoItem
              variant="texte"
              label="Informations supplémentaires"
              className="sm:col-span-2"
              valueClassName="whitespace-pre-line"
            >
              {f.informations_supplementaires?.trim() || VIDE}
            </InfoItem>
          )}
        </dl>
        {detail && (
          <div
            className="space-y-3 border-t border-dashed border-savr-neutral-200 pt-4 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0"
            data-testid="bloc-logistique"
          >
            <Text
              as="p"
              tone="ink"
              className="flex items-center gap-2 font-semibold"
            >
              <TruckIcon
                className="h-4 w-4 text-savr-primary-700"
                aria-hidden="true"
              />
              {f.tournees.length > 1 ? 'Chauffeurs' : 'Chauffeur'}
            </Text>
            <Chauffeurs
              c={f}
              urgence={urgence?.etat ?? 'idle'}
              urgenceErreur={urgence?.erreur ?? null}
              onDemanderUrgence={onDemanderUrgence}
            />
          </div>
        )}
      </div>
      {onOuvrir && (
        <div className="mt-auto flex justify-end">
          <Button variant="secondary" onClick={onOuvrir}>
            Voir la collecte
          </Button>
        </div>
      )}
    </Card>
  );
}

export function FicheEvenementModal({
  evenementId,
  collecteInitiale = null,
  onCollecteChange,
  onClose,
  espace,
}: {
  // Monté par la liste seulement quand une fiche est ouverte.
  evenementId: string;
  /**
   * Espace de l'appelant. Gestionnaire, traiteur, agence : fiche collecte
   * client par-dessus, par les routes de son espace ; radar au gestionnaire.
   * Admin : fiche collecte Admin par-dessus ; organisateur : aucune.
   */
  espace: EspaceFiche;
  /** Fiche collecte à rouvrir par-dessus (adresse `?collecte=` de la liste). */
  collecteInitiale?: string | null;
  /** Ouverture / fermeture de la fiche collecte, pour l'adresse de la liste. */
  onCollecteChange?: (collecteId: string | null) => void;
  onClose: () => void;
}) {
  const espaceClient: EspaceClient | null =
    espace === 'admin' || espace === 'organisateur' ? null : espace;
  const ouvrable = espace !== 'organisateur';
  const [evt, setEvt] = useState<EvenementDetail | null>(null);
  const [etat, setEtat] = useState<Etat>('chargement');
  const [tentative, setTentative] = useState(0);
  const [logoKo, setLogoKo] = useState(false);
  const [onglet, setOnglet] = useState<Onglet>('informations');
  // Demande urgente des coordonnées du chauffeur, par collecte.
  const [urgences, setUrgences] = useState<Record<string, Urgence>>({});
  // Sous-onglet du bilan (événement qui mêle ZD et AG).
  const [typeBilan, setTypeBilan] = useState<CollecteType>('zero_dechet');
  const { toast } = useToast();
  // Une fiche déjà affichée : un rechargement en échec ne la remplace pas par
  // l'état Error, il le signale seulement.
  const affichee = useRef(false);
  const [fiche, setFiche] = useState<{
    id: string;
    onglet?: OngletFiche;
  } | null>(
    // Organisateur : aucune fiche collecte, une adresse qui en nomme une
    // n'ouvre rien (sinon la fiche événement ne se fermerait plus).
    collecteInitiale && ouvrable ? { id: collecteInitiale } : null,
  );

  useEffect(() => {
    let annule = false;
    // Identifiant mal formé (adresse saisie à la main) : aucune requête.
    if (!estUuid(evenementId)) {
      setEvt(null);
      setEtat('introuvable');
      return;
    }
    // Un rechargement (après la fiche collecte) garde le contenu affiché : pas
    // de retour au squelette, la fiche ne clignote pas. Après une erreur,
    // « Réessayer » repasse par le squelette.
    setEtat((e) => (e === 'pret' ? e : 'chargement'));
    fetch(`/api/v1/evenements/${encodeURIComponent(evenementId)}`)
      .then((r) => {
        if (r.status === 404) return null;
        // Une panne ne se lit jamais comme un événement vide (§10 §7).
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ data: EvenementDetail }>;
      })
      .then((j) => {
        if (annule) return;
        if (!j) {
          setEvt(null);
          setEtat('introuvable');
          return;
        }
        setEvt(j.data);
        setEtat('pret');
        affichee.current = true;
      })
      .catch(() => {
        if (annule) return;
        if (affichee.current) {
          toast({
            variant: 'error',
            title: 'Fiche non actualisée',
            description:
              'La fiche affichée peut ne pas tenir compte de la dernière modification. Fermez puis rouvrez-la pour réessayer.',
          });
          return;
        }
        setEtat('erreur');
      });
    return () => {
      annule = true;
    };
    // `toast` est stable (useCallback du ToastProvider) : il ne relance rien.
  }, [evenementId, tentative, toast]);

  const recharger = useCallback(() => setTentative((n) => n + 1), []);

  // Tant que la fiche collecte est ouverte, Échap et le clic hors panneau ne
  // ferment qu'elle.
  const fermer = useCallback(() => {
    if (fiche) return;
    onClose();
  }, [fiche, onClose]);

  function ouvrirCollecte(collecteId: string, ongletFiche?: OngletFiche) {
    setFiche({ id: collecteId, onglet: ongletFiche });
    onCollecteChange?.(collecteId);
  }
  function fermerCollecte() {
    setFiche(null);
    onCollecteChange?.(null);
    recharger();
  }

  async function demanderUrgence(collecteId: string) {
    setUrgences((u) => ({
      ...u,
      [collecteId]: { etat: 'envoi', erreur: null },
    }));
    let erreur = 'La demande n’a pas pu être envoyée.';
    try {
      const res = await fetch(
        `/api/v1/${encodeURIComponent(espace)}/collectes/${encodeURIComponent(collecteId)}/coordonnees-urgence`,
        { method: 'POST' },
      );
      if (res.ok) {
        setUrgences((u) => ({
          ...u,
          [collecteId]: { etat: 'envoyee', erreur: null },
        }));
        return;
      }
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      erreur = j.error ?? erreur;
    } catch {
      // Réseau indisponible : message générique, la demande reste possible.
    }
    setUrgences((u) => ({ ...u, [collecteId]: { etat: 'idle', erreur } }));
  }

  const b = evt?.bilan;
  // Bloc Lieu : valeurs EFFECTIVES des collectes non annulées (un événement
  // peut surcharger l'adresse ou les instructions d'accès du lieu) ; sans
  // collecte active, celles du lieu de référence.
  const actives = evt?.fiches.filter((f) => !annulee(f)) ?? [];
  const deuxTypes = !!b && b.nb_collectes_zd > 0 && b.nb_collectes_ag > 0;
  const typeAffiche: CollecteType =
    b && b.nb_collectes_zd === 0
      ? 'anti_gaspi'
      : b && b.nb_collectes_ag === 0
        ? 'zero_dechet'
        : typeBilan;
  const activesDuType = actives.filter((f) => f.type === typeAffiche);
  // Radar du bilan consolidé ZD : repère parc relu à chaque changement de
  // filtre ; ses filtres servent aussi le rapport cumulé avec radar.
  const radar = useRadarFiche(
    `/api/v1/evenements/${encodeURIComponent(evenementId)}/benchmark`,
    // Benchmark comparatif : gestionnaire seul (décision Val 2026-10-29).
    espace === 'gestionnaire' && b && b.nb_realisees_zd > 0
      ? { type: 'zero_dechet', statut: STATUT_BILAN }
      : null,
  );
  const adresseLieu =
    actives.length > 0
      ? commune(actives, adresseDe)
      : (evt?.lieu_adresse ?? null);
  const accesLieu =
    actives.length > 0
      ? commune(actives, accesDe)
      : (evt?.lieu_acces_details ?? null);
  const periodeCollecte =
    b?.premiere_collecte && b.derniere_collecte
      ? b.premiere_collecte === b.derniere_collecte
        ? libelleDateHeure(b.premiere_collecte, null)
        : `${libelleDateHeure(b.premiere_collecte, null)} → ${libelleDateHeure(b.derniere_collecte, null)}`
      : null;

  // Graphiques du bilan construits à l'ouverture de la fiche (Val 2026-10-28,
  // comme les dashboards) ; la fiche collecte ouverte par-dessus a les siens.
  return (
    <EntreeGraphiques>
      <FicheModal
        open
        title={evt?.nom_evenement || 'Fiche événement'}
        onClose={fermer}
        taille="grand"
        footer={
          etat === 'pret' && evt?.ajouter_collecte ? (
            <Button asChild size="pilule" data-testid="action-ajouter-collecte">
              <Link href={ROUTES.programmer.ajouterCollecte(evt.id)}>
                <PlusCircleIcon />
                Ajouter une collecte
              </Link>
            </Button>
          ) : undefined
        }
      >
        {etat === 'chargement' && (
          <>
            <FicheGrandEnTete titre="Fiche événement" />
            {/* §10 §7 « Loading » : squelette à la forme du contenu. */}
            <FicheCorps className="space-y-4 py-6" aria-busy="true">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-40 w-full" />
            </FicheCorps>
          </>
        )}

        {etat === 'erreur' && (
          <>
            <FicheGrandEnTete titre="Fiche événement" />
            <FicheCorps className="py-6">
              <ErrorState
                data-testid="evenement-erreur"
                message="Le chargement de l’événement a échoué. Vérifiez votre connexion puis réessayez."
                onRetry={recharger}
              />
            </FicheCorps>
          </>
        )}

        {etat === 'introuvable' && (
          <>
            <FicheGrandEnTete titre="Fiche événement" />
            <FicheCorps className="py-6">
              <EmptyState
                icon={<CalendarDotsIcon className="h-8 w-8" />}
                title="Événement introuvable"
                description="Cet événement n’existe pas ou ne se tient pas sur l’un de vos lieux."
              />
            </FicheCorps>
          </>
        )}

        {etat === 'pret' && evt && b && (
          <Tabs
            value={onglet}
            onValueChange={(v) => setOnglet(v as Onglet)}
            className="flex min-h-0 flex-1 flex-col"
          >
            <FicheGrandEnTete
              surtitre={
                <>
                  <EnTetePuce>Événement</EnTetePuce>
                  <Badge variant="neutral" dot={false}>
                    {evt.taille_bracket}
                  </Badge>
                </>
              }
              titre={evt.nom_evenement || 'Événement'}
              statut={
                <StatutEvenement statuts={evt.fiches.map((f) => f.statut)} />
              }
              reperesTestId="fiche-evenement-infos"
              reperes={
                <>
                  {evt.date_evenement && (
                    <FicheRepere icon={CalendarDotsIcon}>
                      {libelleDateHeure(evt.date_evenement, null)}
                    </FicheRepere>
                  )}
                  {evt.lieu_nom && (
                    <FicheRepere icon={MapPinIcon}>{evt.lieu_nom}</FicheRepere>
                  )}
                  {evt.traiteur?.nom && (
                    <FicheRepere icon={ChefHatIcon}>
                      {evt.traiteur.nom}
                    </FicheRepere>
                  )}
                  {evt.pax != null && (
                    <FicheRepere icon={UsersIcon}>
                      {fmtPax(evt.pax)}
                    </FicheRepere>
                  )}
                </>
              }
              onglets={
                <FicheOnglets aria-label="Sections de la fiche événement">
                  <FicheOnglet value="informations">
                    Informations générales
                  </FicheOnglet>
                  <FicheOnglet value="collectes">
                    Informations collectes
                  </FicheOnglet>
                  <FicheOnglet value="bilan">Bilan & documents</FicheOnglet>
                </FicheOnglets>
              }
            />
            <FicheCorps>
              <TabsContent value="informations" className="mt-0">
                <FicheSection titre="Événement" data-testid="bloc-evenement">
                  <dl className={GRILLE} data-testid="evenement-entete">
                    <InfoItem label="Nom de l’événement">
                      {evt.nom_evenement ?? VIDE}
                    </InfoItem>
                    <InfoItem label="Client final">
                      {evt.client_nom ?? VIDE}
                    </InfoItem>
                    {/* Référence interne : servie à l'organisation qui a
                          programmé (Frontière 5), jamais sur l'événement d'un
                          traiteur tiers. */}
                    {evt.ajouter_collecte && (
                      <InfoItem label="Référence interne">
                        {evt.fiches[0]?.evenement?.reference_affaire ?? VIDE}
                      </InfoItem>
                    )}
                    {/* §06.05 §2 : traiteur = nom + logo, pas d'email /
                          téléphone / SIRET. Le logo passe par le proxy du rôle
                          (clé R2 non exposée). */}
                    <InfoItem
                      label="Traiteur"
                      valueClassName="flex items-center gap-2"
                    >
                      {evt.traiteur?.a_logo && !logoKo && (
                        <img
                          src={`/api/v1/gestionnaire/traiteurs/${encodeURIComponent(evt.traiteur.id)}/logo`}
                          alt=""
                          onError={() => setLogoKo(true)}
                          className="h-7 w-7 rounded-savr-full object-cover"
                        />
                      )}
                      {evt.traiteur?.nom ?? VIDE}
                    </InfoItem>
                    {/* Gestionnaire seul (§05 R_dechets_labo_estimes :
                          coefficient du traiteur confidentiel). Estimation
                          amont, toujours affichée au gestionnaire (§06.05 §2) :
                          « — » sans collecte ZD ou sans coefficient. */}
                    {espace === 'gestionnaire' && (
                      <InfoItem
                        label="Déchets labo estimés"
                        valueClassName="flex items-center gap-1.5"
                      >
                        {evt.dechets_labo_kg != null
                          ? fmtKg(evt.dechets_labo_kg)
                          : VIDE}
                        <Tooltip content={AIDE_LABO}>
                          <span
                            tabIndex={0}
                            aria-label={AIDE_LABO}
                            className="inline-flex cursor-help text-savr-neutral-400"
                          >
                            <InfoIcon className="h-3.5 w-3.5" />
                          </span>
                        </Tooltip>
                      </InfoItem>
                    )}
                    <InfoItem label="Période de collecte">
                      {periodeCollecte ?? VIDE}
                    </InfoItem>
                  </dl>
                </FicheSection>

                <FicheSection titre="Lieu" data-testid="bloc-lieu">
                  <dl className={GRILLE}>
                    <InfoItem label="Adresse" className="sm:col-span-2">
                      {evt.lieu_nom ?? VIDE}
                      <span className="block font-normal text-savr-neutral-600">
                        {adresseLieu === undefined
                          ? SELON_LA_COLLECTE
                          : (adresseLieu ?? VIDE)}
                      </span>
                    </InfoItem>
                    {/* Le contrôle d'accès se pose par collecte : « Oui »
                          dès qu'une collecte non annulée l'exige. */}
                    <InfoItem label="Contrôle d’accès">
                      {evt.fiches.some(
                        (f) => !annulee(f) && f.controle_acces_requis,
                      )
                        ? 'Oui'
                        : 'Non'}
                    </InfoItem>
                    <InfoItem
                      variant="texte"
                      label="Instructions d’accès"
                      className="sm:col-span-2 lg:col-span-3"
                      valueClassName="whitespace-pre-line"
                    >
                      {accesLieu === undefined
                        ? SELON_LA_COLLECTE
                        : (accesLieu ?? VIDE)}
                    </InfoItem>
                  </dl>
                </FicheSection>
              </TabsContent>

              {/* Une carte par collecte, l'une sous l'autre, pleine largeur. */}
              <TabsContent value="collectes" className="mt-0">
                {evt.fiches.length === 0 ? (
                  <EmptyState
                    size="inline"
                    title="Aucune collecte rattachée à cet événement."
                  />
                ) : (
                  <div className="space-y-3">
                    {evt.fiches.map((f) => (
                      <CarteCollecte
                        key={f.id}
                        f={f}
                        avecAdresse={adresseLieu === undefined}
                        avecAcces={accesLieu === undefined}
                        urgence={urgences[f.id]}
                        detail={!!espaceClient}
                        statutAdmin={evt.statuts_admin?.[f.id]}
                        onDemanderUrgence={() => void demanderUrgence(f.id)}
                        onOuvrir={
                          ouvrable ? () => ouvrirCollecte(f.id) : undefined
                        }
                      />
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* Événement qui mêle ZD et AG : un sous-onglet par type
                    (décision Val 2026-10-26), bilan et rapports du type. */}
              <TabsContent value="bilan" className="mt-0 space-y-3">
                {deuxTypes && (
                  <ToggleTypeCollecte
                    value={typeAffiche}
                    onChange={setTypeBilan}
                    aria-label="Bilan par type de collecte"
                    data-testid="bilan-sous-onglets"
                  />
                )}
                <BilanConsolide
                  b={b}
                  type={typeAffiche}
                  deuxTypes={deuxTypes}
                  dateEvenement={evt.date_evenement}
                  actives={activesDuType}
                  onOuvrirBilan={
                    ouvrable ? (id) => ouvrirCollecte(id, 'bilan') : undefined
                  }
                  radar={radar}
                  filtresInitiaux={{
                    // Types d'événement de ses collectes ZD, taille de
                    // l'événement : le segment sur lequel le radar s'ouvre.
                    typeEvenementIds: [
                      ...new Set(
                        actives.flatMap((f) =>
                          f.type === 'zero_dechet' && f.type_evenement_id
                            ? [f.type_evenement_id]
                            : [],
                        ),
                      ),
                    ],
                    tailleCodes: evt.pax ? [evt.taille_bracket] : [],
                  }}
                />
                <DocumentsEvenement
                  espace={espace}
                  evenementId={evt.id}
                  type={typeAffiche}
                  nbRealisees={
                    typeAffiche === 'zero_dechet'
                      ? b.nb_realisees_zd
                      : b.nb_realisees_ag
                  }
                  radar={radar}
                  // Documents par collecte : fiche collecte client seulement
                  // (l'Admin les a dans sa fiche, l'organisateur sur sa page
                  // Documents).
                  actives={espaceClient ? activesDuType : []}
                />
              </TabsContent>
            </FicheCorps>
          </Tabs>
        )}
      </FicheModal>

      {espaceClient ? (
        <FicheCollecteClientModal
          espace={espaceClient}
          collecteId={fiche?.id ?? null}
          initialOnglet={fiche?.onglet}
          onClose={fermerCollecte}
        />
      ) : espace === 'admin' ? (
        <CollecteDetailModal
          collecteId={fiche?.id ?? null}
          onClose={fermerCollecte}
        />
      ) : null}
    </EntreeGraphiques>
  );
}
