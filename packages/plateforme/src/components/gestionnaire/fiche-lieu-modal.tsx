'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  BarChart3,
  ChefHat,
  History,
  ImageIcon,
  MapPin,
  PencilLine,
  Truck,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { EnTetePuce, FicheEnTete } from '@/components/ui/fiche/fiche-en-tete';
import { FicheCorps, FicheModal } from '@/components/ui/fiche/fiche-modal';
import { InfoItem } from '@/components/ui/info-item';
import { SectionHeader } from '@/components/ui/section-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Text } from '@/components/ui/text';
import { useToast } from '@/components/ui/toast';
import {
  HistoriqueCollectesTable,
  type HistoriqueCollecte,
} from '@/components/collecte/historique-collectes-table';
import { fmtInt, fmtKg } from '@/lib/format';
import { libelleFlux } from '@/lib/libelles/flux';
import { LONGUEUR_MIN_DEMANDE } from '@/lib/lieux/demande-modification';
import {
  DIFFICULTE_LABEL,
  DIFFICULTE_VARIANT,
  REGION_LABEL,
  VEHICULE_LABEL,
} from '@/lib/lieux-labels';

// Fiche lieu du gestionnaire de lieux, en pop-up sur la liste Lieux (§06.05 §3
// — arbitrage Val 2026-10-06, ex-page /gestionnaire/lieux/[id]). Cadre commun
// des fiches (FicheModal : grand en-tête, onglets, corps défilant, pied).
//
// Lecture seule : le référentiel lieux est tenu par l'Admin Savr (§04). Le pied
// porte un seul bouton, « Demande de modification d'information », qui dépose
// une alerte dans la file de l'Admin ; tant qu'une demande est ouverte pour ce
// lieu — la sienne ou celle d'un collègue — le bouton est neutralisé, d'où une
// mention qui ne dit pas « votre demande ». Le bouton n'existe que pour un lieu
// du parc de l'organisation ; hors parc, la fiche est en consultation.

interface CollecteFiche extends HistoriqueCollecte {
  collecte_flux?: { poids_reel_kg?: number | null }[];
}

interface TraiteurFiche {
  id: string;
  nom: string;
  nb_collectes: number;
  tonnage_kg: number;
}

interface FicheLieu {
  id: string;
  nom: string;
  adresse_acces: string | null;
  code_postal: string | null;
  ville: string | null;
  region: string | null;
  type_vehicule_max: string | null;
  capacite_maximum: number | null;
  acces_office: string | null;
  stationnement: string | null;
  acces_details: string | null;
  contraintes_horaires: string | null;
  flux_autorises: string[] | null;
  photos_urls: string[] | null;
  collectes: CollecteFiche[];
  traiteurs: TraiteurFiche[];
  /** Lieu du parc de l'organisation : seul cas où la demande est proposée. */
  demande_modification_possible: boolean;
  demande_modification_en_cours: boolean;
}

type Etat = 'chargement' | 'erreur' | 'introuvable' | 'pret';
type Onglet = 'informations' | 'traiteurs' | 'activite';

// Tonnage ZD par mois sur les 12 derniers mois (graphique d'évolution, §06.05 §3).
function evolutionMensuelle(
  collectes: CollecteFiche[],
): { mois: string; kg: number }[] {
  const now = new Date();
  const buckets: { mois: string; key: string; kg: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      mois: d.toLocaleDateString('fr-FR', {
        timeZone: 'Europe/Paris',
        month: 'short',
      }),
      kg: 0,
    });
  }
  const byKey = new Map(buckets.map((b) => [b.key, b]));
  for (const c of collectes) {
    if (!c.date_collecte) continue;
    const bucket = byKey.get(c.date_collecte.slice(0, 7));
    if (!bucket) continue;
    bucket.kg += (c.collecte_flux ?? []).reduce(
      (s, f) => s + (f.poids_reel_kg ?? 0),
      0,
    );
  }
  return buckets.map((b) => ({ mois: b.mois, kg: b.kg }));
}

// Difficulté d'accès (`stationnement`, `acces_office` — enum §04) en pastille.
function Difficulte({ valeur }: { valeur: string | null }) {
  if (!valeur) return <>—</>;
  return (
    <Badge variant={DIFFICULTE_VARIANT[valeur] ?? 'neutral'}>
      {DIFFICULTE_LABEL[valeur] ?? valeur}
    </Badge>
  );
}

const COLONNES_TRAITEURS: Column<TraiteurFiche>[] = [
  { key: 'nom', header: 'Traiteur', render: (t) => t.nom },
  { key: 'nb_collectes', header: 'Collectes', render: (t) => t.nb_collectes },
  {
    key: 'tonnage_kg',
    header: 'Tonnage ZD',
    render: (t) => (t.tonnage_kg > 0 ? fmtKg(t.tonnage_kg) : '—'),
  },
];

export function FicheLieuModal({
  lieuId,
  onClose,
}: {
  // Monté par la liste seulement quand une fiche est ouverte.
  lieuId: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [lieu, setLieu] = useState<FicheLieu | null>(null);
  const [etat, setEtat] = useState<Etat>('chargement');
  const [onglet, setOnglet] = useState<Onglet>('informations');
  const [demandeOuverte, setDemandeOuverte] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [erreurEnvoi, setErreurEnvoi] = useState<string | null>(null);
  const [tentative, setTentative] = useState(0);

  useEffect(() => {
    let annule = false;
    setLieu(null);
    setEtat('chargement');
    setOnglet('informations');
    fetch(`/api/v1/gestionnaire/lieux/${encodeURIComponent(lieuId)}`)
      .then((r) => {
        if (r.status === 404) return null;
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ data: FicheLieu }>;
      })
      .then((j) => {
        if (annule) return;
        if (!j) {
          setEtat('introuvable');
          return;
        }
        setLieu(j.data);
        setEtat('pret');
      })
      // §10 §7 « Error » : un échec de chargement ne se lit jamais comme un vide.
      .catch(() => {
        if (!annule) setEtat('erreur');
      });
    return () => {
      annule = true;
    };
  }, [lieuId, tentative]);

  // La sous-modale de demande et la fiche écoutent toutes deux Échap et le clic
  // hors panneau : tant que la demande est ouverte, la fiche ne se ferme pas.
  const fermer = useCallback(() => {
    if (demandeOuverte) return;
    onClose();
  }, [demandeOuverte, onClose]);

  const fermerDemande = () => {
    if (envoi) return;
    setDemandeOuverte(false);
    setErreurEnvoi(null);
  };

  const envoyerDemande = async (texte: string) => {
    if (!lieu) return;
    setEnvoi(true);
    setErreurEnvoi(null);
    try {
      const r = await fetch(
        `/api/v1/gestionnaire/lieux/${encodeURIComponent(lieu.id)}/demande-modification`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ texte }),
        },
      );
      // 409 : une demande est déjà ouverte pour ce lieu (collègue, autre onglet).
      if (r.ok || r.status === 409) {
        setLieu((prev) =>
          prev ? { ...prev, demande_modification_en_cours: true } : prev,
        );
        setDemandeOuverte(false);
        toast(
          r.ok
            ? {
                variant: 'success',
                title: 'Demande envoyée',
                description: 'L’équipe Savr a bien reçu votre demande.',
              }
            : {
                variant: 'info',
                title: 'Demande déjà en cours',
                description:
                  'Une demande est déjà en cours de traitement pour ce lieu.',
              },
        );
        return;
      }
      const j = (await r.json().catch(() => null)) as {
        error?: unknown;
      } | null;
      setErreurEnvoi(
        typeof j?.error === 'string'
          ? j.error
          : 'La demande n’a pas pu être envoyée. Réessayez.',
      );
    } catch {
      setErreurEnvoi(
        'La demande n’a pas pu être envoyée. Vérifiez votre connexion puis réessayez.',
      );
    } finally {
      setEnvoi(false);
    }
  };

  const adresse =
    lieu &&
    ([lieu.adresse_acces, lieu.code_postal, lieu.ville]
      .filter(Boolean)
      .join(', ') ||
      '—');

  return (
    <>
      <FicheModal
        open
        title={lieu?.nom ?? 'Fiche lieu'}
        onClose={fermer}
        footer={
          lieu && etat === 'pret' && lieu.demande_modification_possible ? (
            <>
              {lieu.demande_modification_en_cours && (
                <Text variant="hint" className="mr-auto self-center">
                  Une demande de modification est en cours de traitement par
                  l’équipe Savr.
                </Text>
              )}
              <Button
                variant="secondary"
                disabled={lieu.demande_modification_en_cours}
                onClick={() => setDemandeOuverte(true)}
              >
                <PencilLine />
                Demande de modification d’information
              </Button>
            </>
          ) : undefined
        }
      >
        {etat === 'chargement' && (
          <>
            <FicheEnTete titre="Fiche lieu" />
            {/* §10 §7 « Loading » : skeletons à la forme du contenu. */}
            <FicheCorps className="space-y-4 py-6" aria-busy="true">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-40 w-full" />
            </FicheCorps>
          </>
        )}

        {etat === 'erreur' && (
          <>
            <FicheEnTete titre="Fiche lieu" />
            <FicheCorps className="py-6">
              <ErrorState
                message="Impossible de charger ce lieu. Le service n'a pas répondu. Vérifiez votre connexion puis réessayez."
                onRetry={() => setTentative((n) => n + 1)}
              />
            </FicheCorps>
          </>
        )}

        {etat === 'introuvable' && (
          <>
            <FicheEnTete titre="Fiche lieu" />
            <FicheCorps className="py-6">
              <EmptyState
                icon={<MapPin className="h-8 w-8" />}
                title="Lieu non trouvé"
                description="Ce lieu n'existe pas ou n'est pas rattaché à votre organisation."
              />
            </FicheCorps>
          </>
        )}

        {etat === 'pret' && lieu && (
          <>
            <FicheEnTete
              surtitre={
                lieu.region && (
                  <EnTetePuce>
                    {REGION_LABEL[lieu.region] ?? lieu.region}
                  </EnTetePuce>
                )
              }
              titre={lieu.nom}
              infosTestId="fiche-lieu-infos"
              infos={[
                { icon: MapPin, texte: adresse },
                ...(lieu.type_vehicule_max
                  ? [
                      {
                        icon: Truck,
                        texte: `Véhicule max : ${
                          VEHICULE_LABEL[lieu.type_vehicule_max] ??
                          lieu.type_vehicule_max
                        }`,
                      },
                    ]
                  : []),
              ]}
            />
            <FicheCorps>
              <Tabs
                value={onglet}
                onValueChange={(v) => setOnglet(v as Onglet)}
              >
                <TabsList>
                  <TabsTrigger value="informations">Informations</TabsTrigger>
                  <TabsTrigger value="traiteurs">
                    Traiteurs
                    {lieu.traiteurs.length > 0
                      ? ` (${lieu.traiteurs.length})`
                      : ''}
                  </TabsTrigger>
                  <TabsTrigger value="activite">Activité</TabsTrigger>
                </TabsList>

                <TabsContent value="informations" className="space-y-4">
                  <Card padding="md" className="space-y-4">
                    <SectionHeader
                      icon={MapPin}
                      title="Adresse et capacité"
                      level={3}
                    />
                    <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                      <InfoItem
                        variant="overline"
                        label="Adresse accès livraison"
                      >
                        {adresse}
                      </InfoItem>
                      <InfoItem variant="overline" label="Région">
                        {lieu.region
                          ? (REGION_LABEL[lieu.region] ?? lieu.region)
                          : '—'}
                      </InfoItem>
                      <InfoItem variant="overline" label="Capacité">
                        {lieu.capacite_maximum != null
                          ? `${fmtInt(lieu.capacite_maximum)} pers.`
                          : '—'}
                      </InfoItem>
                    </dl>
                  </Card>

                  <Card padding="md" className="space-y-4">
                    <SectionHeader
                      icon={Truck}
                      title="Accès et logistique"
                      level={3}
                    />
                    <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                      <InfoItem variant="overline" label="Véhicule max">
                        {lieu.type_vehicule_max ? (
                          <Badge variant="neutral">
                            {VEHICULE_LABEL[lieu.type_vehicule_max] ??
                              lieu.type_vehicule_max}
                          </Badge>
                        ) : (
                          '—'
                        )}
                      </InfoItem>
                      <InfoItem variant="overline" label="Stationnement">
                        <Difficulte valeur={lieu.stationnement} />
                      </InfoItem>
                      <InfoItem variant="overline" label="Accès office">
                        <Difficulte valeur={lieu.acces_office} />
                      </InfoItem>
                      {lieu.acces_details && (
                        <InfoItem
                          variant="overline"
                          label="Détails d’accès"
                          pleineLargeur
                        >
                          {lieu.acces_details}
                        </InfoItem>
                      )}
                      {lieu.contraintes_horaires && (
                        <InfoItem
                          variant="overline"
                          label="Contraintes horaires"
                          pleineLargeur
                        >
                          {lieu.contraintes_horaires}
                        </InfoItem>
                      )}
                      {lieu.flux_autorises &&
                        lieu.flux_autorises.length > 0 && (
                          <InfoItem
                            variant="overline"
                            label="Flux autorisés"
                            pleineLargeur
                          >
                            {lieu.flux_autorises.map((f) => (
                              <Badge key={f} variant="neutral">
                                {libelleFlux(f)}
                              </Badge>
                            ))}
                          </InfoItem>
                        )}
                    </dl>
                  </Card>

                  {lieu.photos_urls && lieu.photos_urls.length > 0 && (
                    <Card padding="md" className="space-y-4">
                      <SectionHeader
                        icon={ImageIcon}
                        title="Photos"
                        level={3}
                      />
                      <div className="flex flex-wrap gap-3">
                        {lieu.photos_urls.map((url, i) => (
                          <img
                            key={i}
                            src={url}
                            alt={`Photo ${i + 1} du lieu`}
                            className="h-28 w-40 rounded-savr-md border border-savr-neutral-200 object-cover"
                          />
                        ))}
                      </div>
                    </Card>
                  )}
                </TabsContent>

                <TabsContent value="traiteurs" className="space-y-4">
                  <Card padding="md" className="space-y-4">
                    <SectionHeader
                      icon={ChefHat}
                      title="Traiteurs opérant sur ce lieu"
                      level={3}
                    />
                    {lieu.traiteurs.length === 0 ? (
                      <EmptyState
                        size="inline"
                        title="Aucun traiteur n'a encore eu de collecte sur ce lieu."
                      />
                    ) : (
                      <>
                        <Text variant="hint">
                          Liste établie à partir des collectes programmées sur
                          ce lieu, tous statuts confondus. Tonnage : collectes
                          clôturées.
                        </Text>
                        <DataTable
                          columnsToggle={false}
                          columns={COLONNES_TRAITEURS}
                          data={lieu.traiteurs}
                          keyExtractor={(t) => t.id}
                        />
                      </>
                    )}
                  </Card>
                </TabsContent>

                <TabsContent value="activite" className="space-y-4">
                  {lieu.collectes.length === 0 ? (
                    <Card padding="md">
                      <EmptyState
                        icon={<History className="h-8 w-8" />}
                        title="Aucune collecte clôturée sur les 12 derniers mois"
                        description="L'évolution du tonnage et l'historique des collectes de ce lieu apparaîtront ici."
                      />
                    </Card>
                  ) : (
                    <>
                      <Card padding="md" className="space-y-4">
                        <SectionHeader
                          icon={BarChart3}
                          title="Évolution du tonnage (12 mois)"
                          level={3}
                          truncate={false}
                        />
                        <Evolution collectes={lieu.collectes} />
                      </Card>
                      <Card padding="md" className="space-y-4">
                        <SectionHeader
                          icon={History}
                          title="Historique des collectes (12 mois)"
                          level={3}
                          truncate={false}
                        />
                        <HistoriqueCollectesTable rows={lieu.collectes} />
                      </Card>
                    </>
                  )}
                </TabsContent>
              </Tabs>
            </FicheCorps>
          </>
        )}
      </FicheModal>

      {/* Hors de la fiche : ConfirmDialog porte son propre <form>. */}
      <ConfirmDialog
        open={demandeOuverte}
        title="Demande de modification d’information"
        variant="primary"
        confirmLabel="Envoyer la demande"
        cancelLabel="Annuler"
        loading={envoi}
        loadingText="Envoi…"
        error={erreurEnvoi}
        motif={{
          label: 'Information à corriger',
          minLength: LONGUEUR_MIN_DEMANDE,
          rows: 4,
          placeholder:
            'Exemple : la capacité est de 3 500 personnes ; le stationnement se fait par le quai de livraison.',
        }}
        onConfirm={(texte) => void envoyerDemande(texte)}
        onCancel={fermerDemande}
      >
        Les informations de ce lieu sont tenues à jour par l’équipe Savr.
        Indiquez ce qui doit être corrigé : votre demande lui est transmise.
      </ConfirmDialog>
    </>
  );
}

function Evolution({ collectes }: { collectes: CollecteFiche[] }) {
  const data = evolutionMensuelle(collectes);
  const max = Math.max(1, ...data.map((d) => d.kg));
  return (
    <div
      className="flex items-end gap-1 sm:gap-2"
      data-testid="lieu-evolution-12m"
    >
      {data.map((d, i) => (
        <div key={i} className="flex min-w-0 flex-1 flex-col items-center">
          <div
            className="w-full rounded-t-savr-sm bg-savr-primary-500"
            style={{ height: `${(d.kg / max) * 96 + 2}px` }}
            title={`${d.mois} : ${fmtKg(d.kg)}`}
          />
          <Text as="span" variant="hint" size="3xs" className="mt-1">
            {d.mois}
          </Text>
        </div>
      ))}
    </div>
  );
}
