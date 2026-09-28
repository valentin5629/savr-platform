'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChefHat } from 'lucide-react';
import { AlertBar } from '@/components/ui/alert-bar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataGrid, type ColumnDef } from '@/components/ui/data-grid';
import { EmptyState } from '@/components/ui/empty-state';

interface TraiteurRow {
  id: string;
  nom: string;
  logo_url: string | null;
  nb_collectes_12m: number;
  tonnage_12m_kg: number;
  taux_recyclage_moyen: number | null;
  repas_donnes_12m: number;
  lieux_intervention: { id: string; nom: string }[];
}

const Vide = () => <span className="text-savr-neutral-400">—</span>;

export default function GestionnaireTraiteursPage() {
  const router = useRouter();
  const [rows, setRows] = useState<TraiteurRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  // Logos dont le proxy n'a rien rendu (clé héritée hors format, objet absent) :
  // on retombe sur le nom seul plutôt que sur une vignette cassée.
  const [logosKo, setLogosKo] = useState<Set<string>>(new Set());
  // Seule la réponse du dernier appel écrit dans l'état (un « Réessayer » ne
  // doit pas être écrasé par l'échec tardif de l'appel précédent).
  const generation = useRef(0);

  const charger = useCallback(() => {
    const gen = ++generation.current;
    const perime = () => generation.current !== gen;
    setLoading(true);
    setErreur(null);
    fetch('/api/v1/gestionnaire/traiteurs')
      .then((r) => {
        // Sans cette garde, un 500 rendait `data` absent → liste vide → l'écran
        // affichait « Aucun traiteur » : une panne serveur se lisait comme un
        // parc sans traiteur (§10 §7, état Error distinct de l'état Empty).
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((j) => {
        if (!perime()) setRows((j.data ?? []) as TraiteurRow[]);
      })
      .catch(() => {
        if (!perime()) setErreur('Le chargement des traiteurs a échoué.');
      })
      .finally(() => {
        if (!perime()) setLoading(false);
      });
  }, []);

  useEffect(() => {
    charger();
  }, [charger]);

  // Tri côté navigateur : la route renvoie la liste COMPLÈTE des traiteurs du
  // périmètre (agrégat en mémoire, aucun `.range()` ni pagination), trier ici
  // porte donc sur tout l'ensemble.
  const colonnes: ColumnDef<TraiteurRow, unknown>[] = [
    {
      id: 'traiteur',
      header: 'Traiteur',
      enableHiding: false,
      accessorFn: (t) => t.nom,
      cell: ({ row: { original: t } }) => (
        <div className="flex items-center gap-2">
          {t.logo_url && !logosKo.has(t.id) && (
            <img
              // logo_url porte une CLÉ R2, pas une URL : seul le proxy
              // la résout, dans le périmètre v_traiteurs_gestionnaire.
              src={`/api/v1/gestionnaire/traiteurs/${encodeURIComponent(t.id)}/logo`}
              alt=""
              onError={() => setLogosKo((s) => new Set(s).add(t.id))}
              className="h-6 w-6 rounded-full object-cover"
            />
          )}
          <span className="font-medium">{t.nom}</span>
        </div>
      ),
    },
    {
      id: 'collectes',
      header: 'Collectes 12 m',
      accessorFn: (t) => t.nb_collectes_12m,
      cell: ({ row: { original: t } }) => t.nb_collectes_12m,
    },
    {
      id: 'tonnage',
      header: 'Tonnage ZD 12 m',
      accessorFn: (t) => t.tonnage_12m_kg,
      cell: ({ row: { original: t } }) =>
        t.tonnage_12m_kg > 0 ? `${t.tonnage_12m_kg.toFixed(0)} kg` : <Vide />,
    },
    {
      id: 'taux',
      header: 'Taux recyclage',
      // Taux inconnu trié sous 0 %.
      accessorFn: (t) => t.taux_recyclage_moyen ?? -1,
      cell: ({ row: { original: t } }) =>
        t.taux_recyclage_moyen != null ? (
          `${t.taux_recyclage_moyen.toFixed(1)} %`
        ) : (
          <Vide />
        ),
    },
    {
      id: 'repas',
      header: 'Repas AG 12 m',
      accessorFn: (t) => t.repas_donnes_12m,
      cell: ({ row: { original: t } }) =>
        t.repas_donnes_12m > 0 ? t.repas_donnes_12m : <Vide />,
    },
    {
      id: 'lieux',
      header: "Lieux d'intervention",
      enableSorting: false,
      cell: ({ row: { original: t } }) =>
        t.lieux_intervention.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {t.lieux_intervention.map((l) => (
              <Badge key={l.id} variant="neutral" dot={false}>
                {l.nom}
              </Badge>
            ))}
          </div>
        ) : (
          <Vide />
        ),
    },
  ];

  // États système §10 §7 — Loading = skeleton, Error = message + « Réessayer »,
  // Empty = EmptyState illustré. Une panne ne doit jamais se lire comme une
  // liste vide.
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-savr-primary-800">Traiteurs</h1>
      <p className="text-sm text-savr-neutral-500">
        Traiteurs intervenus sur vos lieux (24 derniers mois).
      </p>

      {erreur ? (
        <div className="space-y-4" data-testid="traiteurs-erreur">
          <AlertBar variant="err">{erreur}</AlertBar>
          <Button variant="secondary" onClick={charger}>
            Réessayer
          </Button>
        </div>
      ) : (
        <DataGrid
          data-testid="traiteurs-table"
          columns={colonnes}
          data={rows}
          getRowId={(t) => t.id}
          loading={loading}
          empty={
            <EmptyState
              icon={<ChefHat />}
              title="Aucun traiteur"
              description="Aucun traiteur n'est intervenu sur vos lieux au cours des 24 derniers mois."
            />
          }
          onRowClick={(t) => router.push(`/gestionnaire/traiteurs/${t.id}`)}
          rowLabel={(t) => `Ouvrir la fiche du traiteur ${t.nom}`}
        />
      )}
    </div>
  );
}
