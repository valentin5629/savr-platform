'use client';

import { useCallback, useEffect, useState } from 'react';
import { PackAgRing } from '@/components/dashboards/charts/cockpit/PackAgRing';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  CelluleVide,
  DataGrid,
  type ColumnDef,
} from '@/components/ui/data-grid';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { PackageIcon } from '@/components/ui/icones';
import { LoadingState } from '@/components/ui/loading-state';
import { PageHero } from '@/components/ui/page-hero';
import { useToast } from '@/components/ui/toast';
import { libelleDateHeure } from '@/lib/format-date-collecte';
import {
  TITRE_MON_PACK_AG,
  libelleStatutPack,
  libelleTypePack,
  variantStatutPack,
} from '@/lib/libelles/pack';
import { formatDateParis } from '@savr/shared/src/temps/index.js';

// Onglet « Mon pack Anti-Gaspi », commun aux 5 rôles clients (Val 2026-11-02) :
// solde du pack courant, historique des packs, collectes rattachées aux packs.
// Données : GET /api/v1/mon-pack-ag (bornée à l'organisation de l'appelant).

interface Pack {
  id: string;
  type_pack: string;
  statut: string;
  credits_initiaux: number;
  credits_consommes: number;
  credits_restants: number;
  date_achat: string | null;
  date_expiration: string | null;
}

interface CollectePack {
  collecte_id: string;
  pack_id: string;
  date_collecte: string | null;
  /** Crédit consommé par une annulation tardive, sans collecte réalisée (§05). */
  annulee_tardivement: boolean;
  evenement: string | null;
  lieu: string | null;
  repas_donnes: number;
  associations: { nom: string | null; repas: number }[];
}

interface DonneesPack {
  pack_courant: Pack | null;
  packs: Pack[];
  collectes: CollectePack[];
}

/** Libellé d'un pack dans les listes : type et date d'achat. */
function libellePack(p: Pack | undefined): string {
  if (!p) return '—';
  const achat = formatDateParis(p.date_achat);
  return achat
    ? `${libelleTypePack(p.type_pack)} du ${achat}`
    : libelleTypePack(p.type_pack);
}

// Historique des packs, du plus récent au plus ancien (ordre de la route).
const COLONNES_PACKS: ColumnDef<Pack, unknown>[] = [
  {
    id: 'pack',
    header: 'Pack',
    enableSorting: false,
    enableHiding: false,
    accessorFn: (p) => libelleTypePack(p.type_pack),
  },
  {
    id: 'statut',
    header: 'Statut',
    enableSorting: false,
    cell: ({ row: { original: p } }) => (
      <Badge variant={variantStatutPack(p.statut)} size="sm">
        {libelleStatutPack(p.statut)}
      </Badge>
    ),
  },
  {
    id: 'credits',
    header: 'Crédits utilisés',
    enableSorting: false,
    meta: { className: 'text-right tabular-nums' },
    accessorFn: (p) => `${p.credits_consommes} / ${p.credits_initiaux}`,
  },
  {
    id: 'achat',
    header: "Date d'achat",
    enableSorting: false,
    cell: ({ row: { original: p } }) =>
      formatDateParis(p.date_achat) || <CelluleVide />,
  },
  {
    id: 'expiration',
    header: 'Expiration',
    enableSorting: false,
    cell: ({ row: { original: p } }) =>
      formatDateParis(p.date_expiration) || <CelluleVide />,
  },
];

// Collectes rattachées aux packs — même Data Table que les listes Collectes
// (décision Val 2026-09-28). SANS tri : la route rend au plus les 50 collectes
// les plus récentes, trier cet extrait ferait croire à un ordre global.
function colonnesCollectes(packs: Pack[]): ColumnDef<CollectePack, unknown>[] {
  const parId = new Map(packs.map((p) => [p.id, p]));
  return [
    {
      id: 'date',
      header: 'Date',
      enableSorting: false,
      enableHiding: false,
      accessorFn: (c) => c.date_collecte ?? '',
      cell: ({ row: { original: c } }) =>
        c.date_collecte ? (
          <span className="whitespace-nowrap font-semibold tabular-nums">
            {libelleDateHeure(c.date_collecte.slice(0, 10), null)}
          </span>
        ) : (
          <CelluleVide />
        ),
    },
    {
      id: 'evenement',
      header: 'Événement',
      enableSorting: false,
      accessorFn: (c) => c.evenement ?? '',
      cell: ({ row: { original: c } }) => (
        <span className="inline-flex flex-wrap items-center justify-end gap-2 sm:justify-start">
          {c.evenement ?? <CelluleVide />}
          {c.annulee_tardivement && (
            <Badge variant="neutral" size="sm">
              Annulée tardivement
            </Badge>
          )}
        </span>
      ),
    },
    {
      id: 'lieu',
      header: 'Lieu',
      enableSorting: false,
      accessorFn: (c) => c.lieu ?? '',
      cell: ({ row: { original: c } }) => c.lieu ?? <CelluleVide />,
    },
    {
      id: 'pack',
      header: 'Pack',
      enableSorting: false,
      accessorFn: (c) => libellePack(parId.get(c.pack_id)),
    },
    {
      id: 'repas',
      header: 'Repas donnés',
      enableSorting: false,
      accessorFn: (c) => c.repas_donnes,
      meta: { className: 'text-right tabular-nums' },
      cell: ({ row: { original: c } }) =>
        c.annulee_tardivement ? <CelluleVide /> : c.repas_donnes,
    },
    {
      id: 'associations',
      header: 'Association(s)',
      enableSorting: false,
      cell: ({ row: { original: c } }) =>
        c.associations
          .map((a) => a.nom)
          .filter(Boolean)
          .join(', ') || <CelluleVide />,
    },
  ];
}

export function MonPackAg() {
  const [data, setData] = useState<DonneesPack | null>(null);
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const { toast } = useToast();

  // Un échec de chargement n'est pas « aucun pack ».
  const charger = useCallback(() => {
    setLoading(true);
    setErreur(false);
    fetch('/api/v1/mon-pack-ag')
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((j) => setData(j.data as DonneesPack))
      .catch(() => setErreur(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(charger, [charger]);

  const demanderRenouvellement = async () => {
    setEnvoi(true);
    try {
      const r = await fetch('/api/v1/traiteur/pack-ag/renouvellement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!r.ok) throw new Error(String(r.status));
      toast({
        variant: 'success',
        title: 'Demande envoyée',
        description:
          "L'équipe Savr vous recontacte pour renouveler votre pack.",
      });
    } catch {
      toast({
        variant: 'error',
        title: "La demande n'est pas partie",
        description: 'Vérifiez votre connexion puis réessayez.',
      });
    } finally {
      setEnvoi(false);
    }
  };

  const hero = (
    <PageHero
      icon={<PackageIcon className="h-6 w-6" />}
      title={TITRE_MON_PACK_AG}
    />
  );

  if (loading) return <LoadingState />;
  if (erreur || !data)
    return (
      <div className="space-y-6">
        {hero}
        <ErrorState
          message="Impossible de charger votre pack Anti-Gaspi. Le service n'a pas répondu. Vérifiez votre connexion puis réessayez."
          onRetry={charger}
        />
      </div>
    );

  if (data.packs.length === 0)
    return (
      <div className="space-y-6">
        {hero}
        <Card>
          <CardContent className="py-8">
            <EmptyState
              size="inline"
              className="text-center"
              title="Votre organisation n'a pas de pack Anti-Gaspi."
              description="Contactez votre responsable Savr pour en souscrire un."
            />
          </CardContent>
        </Card>
      </div>
    );

  const pack = data.pack_courant;
  // Même seuil que le bloc du dashboard (§06.04 Bloc 4 AG) : 10 % du pack ou
  // moins. Sans pack courant (dernier pack annulé), la demande est ouverte.
  const renouvellementOuvert =
    !pack || pack.credits_restants <= 0.1 * pack.credits_initiaux;

  return (
    <div className="space-y-6">
      {hero}

      <div data-testid="pack-courant" className="space-y-3">
        {pack ? (
          <PackAgRing
            creditsInitiaux={pack.credits_initiaux}
            creditsRestants={pack.credits_restants}
          />
        ) : (
          <Card>
            <CardContent className="py-8">
              <EmptyState
                size="inline"
                className="text-center"
                title="Aucun pack Anti-Gaspi actif."
                description="Vos collectes Anti-Gaspi sont facturées à l'unité jusqu'au prochain pack."
              />
            </CardContent>
          </Card>
        )}
        <Button
          disabled={!renouvellementOuvert || envoi}
          onClick={demanderRenouvellement}
        >
          Demander un renouvellement
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Historique des packs</CardTitle>
        </CardHeader>
        <CardContent>
          <DataGrid
            columnsToggle={false}
            columns={COLONNES_PACKS}
            data={data.packs}
            getRowId={(p) => p.id}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Collectes rattachées au pack</CardTitle>
        </CardHeader>
        <CardContent>
          {data.collectes.length > 0 ? (
            <DataGrid
              columnsToggle={false}
              columns={colonnesCollectes(data.packs)}
              data={data.collectes}
              getRowId={(c) => c.collecte_id}
            />
          ) : (
            <EmptyState
              size="inline"
              className="text-center"
              title="Aucune collecte n'a encore utilisé de crédit."
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
