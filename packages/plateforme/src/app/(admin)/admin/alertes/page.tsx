'use client';

import { useCallback, useMemo, useState } from 'react';
import { Bell, CheckCircle2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { FilterBar } from '@/components/ui/filter-bar';
import { FilterChips } from '@/components/ui/filter-chips';
import { texte, useFiltresUrl } from '@/lib/hooks/use-filtres-url';
import { compteurResultats } from '@/lib/compteur-resultats';
import { useListePaginee } from '@/lib/hooks/use-liste-paginee';
import {
  SEVERITE_BADGE,
  severiteParCode,
  entiteHref,
} from '@/lib/alertes-admin.js';
import { PageHero } from '@/components/ui/page-hero';
import { Text } from '@/components/ui/text';
import { TextLink } from '@/components/ui/text-link';

interface Alerte {
  id: string;
  code: string;
  titre: string;
  message: string | null;
  entity_type: string | null;
  entity_id: string | null;
  statut: string;
  created_at: string;
  resolue_at: string | null;
}

// Pastilles de statut (R-UI-4b, D3) : `FilterChips` du DS, état dans l'URL
// (`?statut=…`, défaut « Ouvertes » omis).
const PASTILLES_STATUT = [
  { key: 'ouverte', label: 'Ouvertes' },
  { key: 'resolue', label: 'Résolues' },
  { key: 'all', label: 'Toutes' },
];

const FILTRES = { statut: texte('ouverte') };

export default function AlertesPage() {
  const { valeurs: f, set, reset, actif } = useFiltresUrl(FILTRES);
  const statut = f.statut;
  // Valeur lue de l'URL : encodée (revue sécurité #481), la route la valide.
  const { data, loading, erreur, recharger } = useListePaginee<Alerte>(
    `/api/v1/admin/alertes?${new URLSearchParams({ statut }).toString()}`,
  );
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  // Résolutions optimistes (id → date) appliquées par-dessus la liste chargée :
  // retrait de la vue « Ouvertes », statut « Résolue » dans les autres vues.
  const [resolues, setResolues] = useState<Record<string, string>>({});

  const alertes = useMemo(
    () =>
      statut === 'ouverte'
        ? data.filter((a) => !(a.id in resolues))
        : data.map((a) =>
            a.id in resolues
              ? { ...a, statut: 'resolue', resolue_at: resolues[a.id]! }
              : a,
          ),
    [data, resolues, statut],
  );

  const resoudre = useCallback(async (id: string) => {
    setResolvingId(id);
    try {
      const res = await fetch(
        `/api/v1/admin/alertes/${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'resoudre' }),
        },
      );
      if (!res.ok) return;
      // Retrait optimiste de la vue « Ouvertes » ; sinon on rafraîchit le statut.
      setResolues((prev) => ({ ...prev, [id]: new Date().toISOString() }));
    } finally {
      setResolvingId(null);
    }
  }, []);

  const columns: Column<Alerte>[] = [
    {
      key: 'severite',
      header: 'Sévérité',
      render: (row) => {
        const b = SEVERITE_BADGE[severiteParCode(row.code)];
        return <Badge variant={b.variant}>{b.label}</Badge>;
      },
    },
    {
      key: 'titre',
      header: 'Alerte',
      sortable: true,
      render: (row) => (
        <div className="max-w-xl">
          <p className="font-medium text-savr-neutral-900">{row.titre}</p>
          {row.message && (
            <Text variant="hint" className="mt-0.5">
              {row.message}
            </Text>
          )}
          <Text variant="hint" tone="faint" className="mt-0.5 font-mono">
            {row.code}
          </Text>
        </div>
      ),
    },
    {
      key: 'entite',
      header: 'Entité',
      render: (row) => {
        const href = entiteHref(row.entity_type, row.entity_id);
        if (!row.entity_type)
          return <span className="text-savr-neutral-400">—</span>;
        if (href) {
          return (
            <TextLink href={href} className="text-sm">
              {row.entity_type}
            </TextLink>
          );
        }
        return <Text as="span">{row.entity_type}</Text>;
      },
    },
    {
      key: 'created_at',
      header: 'Créée le',
      sortable: true,
      render: (row) =>
        new Date(row.created_at).toLocaleString('fr-FR', {
          timeZone: 'Europe/Paris',
        }),
    },
    {
      key: 'action',
      header: '',
      render: (row) =>
        row.statut === 'ouverte' ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => resoudre(row.id)}
            loading={resolvingId === row.id}
            loadingText="Résolution…"
          >
            Résoudre
          </Button>
        ) : (
          <Text
            as="span"
            variant="hint"
            className="inline-flex items-center gap-1"
          >
            <CheckCircle2 className="h-3.5 w-3.5 text-savr-success" />
            Résolue
          </Text>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHero
        icon={<Bell className="h-6 w-6 text-savr-primary-200" />}
        title="Alertes"
        subtitle="Alertes Admin in-app à traiter (packs, pesées, PDF, facturation, dispatch…). Le canal d'action des alertes fonctionnelles est cet écran, pas Slack."
      />

      <FilterBar
        data-testid="alertes-filtres"
        count={compteurResultats(alertes.length, 'alerte', 'alertes')}
        actif={actif}
        onReset={reset}
      >
        <FilterChips
          chips={PASTILLES_STATUT}
          activeKey={statut}
          ariaLabel="Filtrer par statut"
          onSelect={(key) => set({ statut: key })}
        />
      </FilterBar>

      {!loading && !erreur && alertes.length === 0 ? (
        <EmptyState
          icon={<Bell />}
          title="Aucune alerte"
          description={
            statut === 'ouverte'
              ? 'Aucune alerte ouverte à traiter.'
              : 'Aucune alerte dans cette vue.'
          }
        />
      ) : (
        <DataTable
          columns={columns}
          data={alertes}
          clientSort
          loading={loading}
          erreur={erreur}
          onRecharger={recharger}
          keyExtractor={(a) => a.id}
        />
      )}
    </div>
  );
}
