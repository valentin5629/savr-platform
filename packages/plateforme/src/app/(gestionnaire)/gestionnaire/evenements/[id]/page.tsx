'use client';

import { Suspense, use, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  BarChart3,
  CalendarDays,
  ClipboardList,
  Clock3,
  Heart,
  Info,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  CelluleVide,
  DataGrid,
  type ColumnDef,
} from '@/components/ui/data-grid';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { IconButton } from '@/components/ui/icon-button';
import { InfoItem } from '@/components/ui/info-item';
import { LoadingState } from '@/components/ui/loading-state';
import { PageHero } from '@/components/ui/page-hero';
import { SectionHeader } from '@/components/ui/section-header';
import { Text } from '@/components/ui/text';
import { Tooltip } from '@/components/ui/tooltip';
import { CollecteStatutBadge } from '@/components/ui/collecte-statut-badge';
import { TypeCollecteBadge } from '@/components/ui/type-collecte-badge';
import { ResultatsCollecte } from '@/components/collecte/collectes-traiteur-table';
import { FicheCollecteClientModal } from '@/components/collecte/fiche-collecte-client-modal';
import type { OngletFiche } from '@/components/collecte/fiche-collecte-client-panel';
import { TonnagesDonut } from '@/components/dashboards/charts/cockpit/TonnagesDonut';
import { Kpi } from '@/components/collecte/fiche-collecte-client-bilan';
import { ouvrirDocumentPresigne } from '@/lib/collectes/rapport-telechargement-client';
import type { BilanEvenement } from '@/lib/evenements-gestionnaire';
import { libelleDateHeure } from '@/lib/format-date-collecte';
import {
  fmtDec,
  fmtInt,
  fmtKg,
  fmtMasse,
  fmtPax,
  UNITE_KG_CO2E,
} from '@/lib/format';
import { variantStatutEvenement } from '@/lib/libelles/evenement';
import { ROUTES } from '@/lib/routes';

interface CollecteLigne {
  id: string;
  type: string;
  statut: string;
  date_collecte: string | null;
  heure_collecte: string | null;
  poids_total_kg: number | null;
  taux_recyclage: number | null;
  co2_evite_kg: number | null;
  nb_repas_donnes: number | null;
}

interface EvenementDetail {
  id: string;
  nom_evenement: string | null;
  date_evenement: string | null;
  pax: number | null;
  taille_bracket: string;
  type_evenement: string | null;
  client_nom: string | null;
  lieu_nom: string | null;
  lieu_adresse: string | null;
  traiteur: { id: string; nom: string | null; a_logo: boolean } | null;
  dechets_labo_kg: number | null;
  bilan: BilanEvenement;
  collectes: CollecteLigne[];
}

// Infobulle du taux consolidé : la règle de calcul, pour qu'un écart avec la
// moyenne simple des taux affichés sur chaque collecte ne surprenne pas.
const AIDE_TAUX =
  'Moyenne des taux de recyclage des collectes réalisées, pondérée par leur poids collecté.';
const AIDE_LABO =
  'Estimation amont, distincte des déchets collectés sur l’événement.';

const VIDE = <span className="text-savr-neutral-400">—</span>;

// Phrase de couverture du bilan, accordée au singulier comme au pluriel.
// « Réalisée » s'entend au sens des résultats (clôturée, ou AG sans excédent) :
// une collecte `realisee` qui attend sa clôture compte déjà « Terminé » dans le
// statut consolidé, sans avoir encore de résultat.
function couverture(nbRealisees: number, nbCollectes: number): string {
  if (nbCollectes === 0)
    return 'Aucune collecte n’est rattachée à cet événement.';
  const total =
    nbCollectes === 1 ? 'la collecte' : `les ${nbCollectes} collectes`;
  if (nbRealisees === 0)
    return `Aucun résultat n’est encore disponible sur ${total} de l’événement.`;
  const realisees =
    nbRealisees === 1
      ? 'Cumul de 1 collecte réalisée'
      : `Cumul des ${nbRealisees} collectes réalisées`;
  return `${realisees}, sur ${nbCollectes === 1 ? '1 collecte' : `${nbCollectes} collectes`} de l’événement.`;
}

/** Bilan consolidé : cumul des collectes réalisées de l'événement. */
function BilanConsolide({
  b,
  pax,
  dateEvenement,
}: {
  b: BilanEvenement;
  pax: number | null;
  dateEvenement: string | null;
}) {
  const nbCollectes = b.nb_collectes_zd + b.nb_collectes_ag;
  const nbRealisees = b.nb_realisees_zd + b.nb_realisees_ag;
  const masse = b.tonnage_zd_kg != null ? fmtMasse(b.tonnage_zd_kg) : null;
  const serieDonut = [
    {
      periode: dateEvenement ?? '',
      ...b.flux_kg,
      tonnage_total: b.tonnage_zd_kg ?? 0,
      taux_recyclage: b.taux_recyclage,
    },
  ];

  return (
    <section className="space-y-4" data-testid="bilan-consolide">
      <SectionHeader icon={BarChart3} title="Bilan consolidé" />
      <Text tone="soft" data-testid="bilan-consolide-couverture">
        {couverture(nbRealisees, nbCollectes)}
      </Text>

      {nbCollectes > 0 && nbRealisees === 0 && (
        <div
          data-testid="bandeau-bilan-attente"
          className="flex items-start gap-3 rounded-savr-lg bg-savr-primary-50 px-5 py-4"
        >
          <Clock3
            className="mt-0.5 h-5 w-5 shrink-0 text-savr-primary-700"
            aria-hidden="true"
          />
          <Text tone="soft">
            Les résultats s’afficheront ici le lendemain de chaque collecte, et
            se cumuleront au fil des collectes de l’événement.
          </Text>
        </div>
      )}

      {b.nb_collectes_zd > 0 && (
        <div className="space-y-3" data-testid="bilan-consolide-zd">
          <div className="flex items-center gap-2">
            <TypeCollecteBadge type="zero_dechet" forme="badge" />
            <Text variant="hint">
              {b.nb_realisees_zd} réalisée{b.nb_realisees_zd > 1 ? 's' : ''} sur{' '}
              {b.nb_collectes_zd}
            </Text>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi
              label="Poids total collecté"
              nombre={masse ? masse.value : '—'}
              unite={masse ? masse.unit : 'kg'}
            />
            <Kpi
              label="CO₂ évité (net)"
              nombre={b.co2_net_zd_kg != null ? fmtInt(b.co2_net_zd_kg) : '—'}
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
                b.tonnage_zd_kg != null && pax
                  ? fmtInt((b.tonnage_zd_kg / pax) * 1000)
                  : '—'
              }
              unite="g"
            />
          </div>
          {b.tonnage_zd_kg != null && b.tonnage_zd_kg > 0 && (
            <TonnagesDonut series={serieDonut} disposition="ligne" />
          )}
        </div>
      )}

      {b.nb_collectes_ag > 0 && (
        <div className="space-y-3" data-testid="bilan-consolide-ag">
          <div className="flex items-center gap-2">
            <TypeCollecteBadge type="anti_gaspi" forme="badge" />
            <Text variant="hint">
              {b.nb_realisees_ag} réalisée{b.nb_realisees_ag > 1 ? 's' : ''} sur{' '}
              {b.nb_collectes_ag}
            </Text>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Kpi
              label="Repas donnés"
              nombre={b.repas_donnes != null ? fmtInt(b.repas_donnes) : '—'}
              unite="repas"
            />
            <Kpi
              label="Repas par pax"
              nombre={
                b.repas_donnes != null && pax
                  ? fmtDec(b.repas_donnes / pax, 2)
                  : '—'
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
            <Card padding="md" className="space-y-3">
              <SectionHeader
                icon={Heart}
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
        </div>
      )}
    </section>
  );
}

function EvenementDetailContent({ id }: { id: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [evt, setEvt] = useState<EvenementDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [logoKo, setLogoKo] = useState(false);
  // Fiche collecte en pop-up (pop-up client commun, comme sur la liste
  // Collectes), rouverte depuis l'URL (?collecte=<id>) au rechargement.
  const [fiche, setFiche] = useState<{
    id: string;
    onglet?: OngletFiche;
  } | null>(() => {
    const c = params.get('collecte');
    return c ? { id: c } : null;
  });

  const charger = useCallback(() => {
    let annule = false;
    setLoading(true);
    setErreur(null);
    fetch(`/api/v1/gestionnaire/evenements/${encodeURIComponent(id)}`)
      .then(async (r) => {
        if (annule) return;
        if (r.status === 404) {
          setNotFound(true);
          return;
        }
        // Une panne ne se lit jamais comme un événement vide (§10 §7).
        if (!r.ok) throw new Error(String(r.status));
        const j = (await r.json()) as { data: EvenementDetail };
        if (!annule) setEvt(j.data);
      })
      .catch(() => {
        if (!annule) setErreur('Le chargement de l’événement a échoué.');
      })
      .finally(() => {
        if (!annule) setLoading(false);
      });
    return () => {
      annule = true;
    };
  }, [id]);

  useEffect(() => charger(), [charger]);

  function majUrlFiche(collecteId: string | null) {
    const usp = new URLSearchParams(Array.from(params.entries()));
    if (collecteId) usp.set('collecte', collecteId);
    else usp.delete('collecte');
    const s = usp.toString();
    router.replace(`${ROUTES.gestionnaire.evenement(id)}${s ? `?${s}` : ''}`, {
      scroll: false,
    });
  }
  function ouvrirFiche(collecteId: string, onglet?: OngletFiche) {
    setFiche({ id: collecteId, onglet });
    majUrlFiche(collecteId);
  }
  // Une modification faite dans la fiche peut changer le bilan : rechargé.
  function fermerFiche() {
    setFiche(null);
    majUrlFiche(null);
    charger();
  }

  // Rapport de don d'une collecte AG réalisée (URL R2 pré-signée) — même geste
  // que la liste Collectes ; le rapport de recyclage ZD se fabrique dans la
  // fiche, ouverte sur « Bilan & documents ».
  function telechargerRapport(collecteId: string) {
    return ouvrirDocumentPresigne(
      `/api/v1/gestionnaire/collectes/${encodeURIComponent(collecteId)}/rapport-rse/download`,
    );
  }

  if (loading && !evt) return <LoadingState variant="bloc" lignes={6} />;
  if (notFound)
    return (
      <EmptyState
        icon={<CalendarDays />}
        title="Événement introuvable"
        description="Cet événement n’existe pas ou ne se tient pas sur l’un de vos lieux."
      />
    );
  if (erreur && !evt)
    return (
      <ErrorState
        data-testid="evenement-erreur"
        message={erreur}
        onRetry={charger}
      />
    );
  if (!evt) return null;

  const b = evt.bilan;
  const periodeCollecte =
    b.premiere_collecte && b.derniere_collecte
      ? b.premiere_collecte === b.derniere_collecte
        ? libelleDateHeure(b.premiere_collecte, null)
        : `${libelleDateHeure(b.premiere_collecte, null)} → ${libelleDateHeure(b.derniere_collecte, null)}`
      : null;

  const colonnes: ColumnDef<CollecteLigne, unknown>[] = [
    {
      id: 'date',
      header: 'Date',
      cell: ({ row: { original: c } }) =>
        c.date_collecte ? (
          <span className="whitespace-nowrap font-semibold text-savr-neutral-900 tabular-nums">
            {libelleDateHeure(c.date_collecte, c.heure_collecte)}
          </span>
        ) : (
          <CelluleVide />
        ),
    },
    {
      id: 'type',
      header: 'Type',
      cell: ({ row: { original: c } }) => <TypeCollecteBadge type={c.type} />,
    },
    {
      id: 'resultats',
      header: 'Résultats',
      cell: ({ row: { original: c } }) => (
        <ResultatsCollecte
          // Le gestionnaire est servi de tous les rapports des collectes tenues
          // sur ses lieux (§06.05) : jamais « réservé au donneur d'ordre ».
          c={{ ...c, rapport_reserve_donneur_ordre: false }}
          onTelecharger={() =>
            c.type === 'zero_dechet'
              ? ouvrirFiche(c.id, 'bilan')
              : void telechargerRapport(c.id)
          }
        />
      ),
    },
    {
      id: 'statut',
      header: 'Statut',
      cell: ({ row: { original: c } }) => (
        <CollecteStatutBadge statut={c.statut} />
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHero
        icon={
          <div className="flex items-center gap-2">
            <IconButton
              size="sm"
              onClick={() => router.back()}
              aria-label="Retour"
              className="text-savr-white hover:bg-savr-white/10 hover:text-savr-white [&>svg]:h-4 [&>svg]:w-4"
            >
              <ArrowLeft />
            </IconButton>
            <CalendarDays className="h-6 w-6 text-savr-primary-200" />
          </div>
        }
        title={evt.nom_evenement || 'Événement'}
        subtitle={[
          evt.date_evenement
            ? libelleDateHeure(evt.date_evenement, null)
            : null,
          evt.lieu_nom,
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="neutral" dot={false}>
              {evt.taille_bracket}
            </Badge>
            <Badge
              variant={variantStatutEvenement(b.statut_consolide)}
              dot={false}
              data-testid="statut-consolide"
            >
              {b.statut_consolide}
            </Badge>
          </div>
        }
      />

      <Card padding="md">
        <dl
          className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm lg:grid-cols-4"
          data-testid="evenement-entete"
        >
          <InfoItem label="Date">
            {evt.date_evenement
              ? libelleDateHeure(evt.date_evenement, null)
              : VIDE}
          </InfoItem>
          <InfoItem label="Lieu">
            {evt.lieu_nom ?? VIDE}
            {evt.lieu_adresse && (
              <Text as="div" variant="hint" className="font-normal">
                {evt.lieu_adresse}
              </Text>
            )}
          </InfoItem>
          {/* §06.05 §2 : traiteur = nom + logo, pas d'email / téléphone /
              SIRET. Le logo passe par le proxy du rôle (clé R2 non exposée). */}
          <InfoItem label="Traiteur" valueClassName="flex items-center gap-2">
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
          <InfoItem label="Type d'événement">
            {evt.type_evenement ?? VIDE}
          </InfoItem>
          {/* « Client Organisateur si renseigné par le traiteur » (§06.05 §2). */}
          {evt.client_nom && (
            <InfoItem label="Client organisateur">{evt.client_nom}</InfoItem>
          )}
          <InfoItem label="Pax">
            {evt.pax != null ? fmtPax(evt.pax) : VIDE}
          </InfoItem>
          {/* Estimation amont (§05 R_dechets_labo_estimes), toujours affichée
              (§06.05 §2) : « — » si l'événement n'a aucune collecte ZD (la
              route ne la calcule pas) ou si le coefficient n'est pas
              communiqué. */}
          <InfoItem
            label="Déchets labo estimés"
            valueClassName="flex items-center gap-1.5"
          >
            {evt.dechets_labo_kg != null ? fmtKg(evt.dechets_labo_kg) : VIDE}
            <Tooltip content={AIDE_LABO}>
              <span
                tabIndex={0}
                aria-label={AIDE_LABO}
                className="inline-flex cursor-help text-savr-neutral-400"
              >
                <Info className="h-3.5 w-3.5" />
              </span>
            </Tooltip>
          </InfoItem>
          {periodeCollecte && (
            <InfoItem label="Collectes">{periodeCollecte}</InfoItem>
          )}
        </dl>
      </Card>

      <BilanConsolide b={b} pax={evt.pax} dateEvenement={evt.date_evenement} />

      <section className="space-y-3">
        <SectionHeader icon={ClipboardList} title="Collectes de l’événement" />
        {evt.collectes.length === 0 ? (
          <EmptyState
            size="inline"
            title="Aucune collecte rattachée à cet événement."
          />
        ) : (
          <DataGrid
            data-testid="evenement-collectes"
            columns={colonnes}
            data={evt.collectes}
            getRowId={(c) => c.id}
            onRowClick={(c) => ouvrirFiche(c.id)}
            rowLabel={(c) =>
              `Ouvrir la collecte du ${c.date_collecte ? libelleDateHeure(c.date_collecte, c.heure_collecte) : 'jour non renseigné'}`
            }
          />
        )}
      </section>

      <FicheCollecteClientModal
        espace="gestionnaire"
        collecteId={fiche?.id ?? null}
        initialOnglet={fiche?.onglet}
        onClose={fermerFiche}
      />
    </div>
  );
}

export default function GestionnaireEvenementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <Suspense fallback={<LoadingState variant="bloc" lignes={6} />}>
      <EvenementDetailContent id={id} />
    </Suspense>
  );
}
