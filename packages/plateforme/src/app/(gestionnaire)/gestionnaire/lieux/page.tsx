'use client';

import { ErrorState } from '@/components/ui/error-state';
import { fmtInt, fmtKg } from '@/lib/format';
import { useCallback, useEffect, useState } from 'react';
import { MapPin, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHero } from '@/components/ui/page-hero';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { Text } from '@/components/ui/text';
import { DemandeAjoutLieuModal } from '@/components/gestionnaire/demande-ajout-lieu-modal';
import { FicheLieuModal } from '@/components/gestionnaire/fiche-lieu-modal';
import { ROUTES } from '@/lib/routes';

interface LieuRow {
  id: string;
  nom: string;
  adresse_acces: string | null;
  code_postal: string | null;
  ville: string | null;
  type_vehicule_max: string | null;
  capacite_maximum: number | null;
  actif: boolean;
  nb_collectes_12m: number;
  tonnage_12m_kg: number;
}

export default function GestionnaireLieuxPage() {
  const [rows, setRows] = useState<LieuRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState(false);

  // Fiche lieu en pop-up (§06.05 §3 — arbitrage Val 2026-10-06). L'adresse porte
  // la fiche ouverte (?lieu=<id>) : un lien direct, un rechargement ou l'ancienne
  // route /gestionnaire/lieux/<id> (qui redirige ici) rouvrent la même fiche.
  const [lieuOuvert, setLieuOuvert] = useState<string | null>(null);
  useEffect(() => {
    setLieuOuvert(new URLSearchParams(window.location.search).get('lieu'));
  }, []);
  const ouvrirFiche = (id: string) => {
    setLieuOuvert(id);
    window.history.replaceState(
      null,
      '',
      `${ROUTES.gestionnaire.lieux}?lieu=${encodeURIComponent(id)}`,
    );
  };
  const fermerFiche = useCallback(() => {
    setLieuOuvert(null);
    window.history.replaceState(null, '', ROUTES.gestionnaire.lieux);
  }, []);

  // « Demander l'ajout d'un lieu » (§06.05 §3) : le rattachement reste fait par
  // l'Admin Savr, le bouton dépose une demande dans sa file. Une demande ouverte
  // à la fois par organisation : tant qu'elle n'est pas traitée, le bouton est
  // neutralisé. État illisible = bouton proposé, la route refusera au besoin.
  // La lecture du montage ne fait que neutraliser : arrivée après un envoi,
  // elle ne doit pas rendre le bouton à une demande qui vient de partir.
  const [ajoutOuvert, setAjoutOuvert] = useState(false);
  const [ajoutEnCours, setAjoutEnCours] = useState(false);
  useEffect(() => {
    fetch('/api/v1/gestionnaire/lieux/demande-ajout')
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { data?: { en_cours?: unknown } } | null) => {
        if (j?.data?.en_cours === true) setAjoutEnCours(true);
      })
      .catch(() => undefined);
  }, []);

  const charger = useCallback(() => {
    setLoading(true);
    setErreur(false);
    fetch('/api/v1/gestionnaire/lieux')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j) => setRows((j.data ?? []) as LieuRow[]))
      // §10 §7 « Error » : un échec de chargement ne doit jamais se lire comme
      // une liste vide — sans ce catch, une 500 affichait « Aucun lieu associé ».
      .catch(() => setErreur(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    charger();
  }, [charger]);

  // Colonnes §06.05 §3 : Nom, Adresse, Capacité, Collectes 12 m, Tonnage ZD 12 m.
  const columns: Column<LieuRow>[] = [
    {
      key: 'nom',
      header: 'Nom',
      render: (l) => (
        <span className="font-semibold text-savr-neutral-900">{l.nom}</span>
      ),
    },
    {
      key: 'adresse',
      header: 'Adresse',
      render: (l) => (
        <div>
          <div>{l.adresse_acces ?? '—'}</div>
          <Text as="div" variant="hint">
            {[l.code_postal, l.ville].filter(Boolean).join(' ')}
          </Text>
        </div>
      ),
    },
    {
      key: 'capacite_maximum',
      header: 'Capacité',
      render: (l) =>
        l.capacite_maximum != null
          ? `${fmtInt(l.capacite_maximum)} pers.`
          : '—',
    },
    {
      key: 'nb_collectes_12m',
      header: 'Collectes 12 m',
      render: (l) => l.nb_collectes_12m,
    },
    {
      key: 'tonnage_12m_kg',
      header: 'Tonnage ZD 12 m',
      render: (l) => (l.tonnage_12m_kg > 0 ? fmtKg(l.tonnage_12m_kg) : '—'),
    },
  ];

  const contenu = erreur ? (
    <ErrorState
      message="Impossible de charger vos lieux. Le service n'a pas répondu. Vérifiez votre connexion puis réessayez."
      onRetry={charger}
    />
  ) : !loading && rows.length === 0 ? (
    <EmptyState
      icon={<MapPin className="h-8 w-8" />}
      title="Aucun lieu associé"
      description="Les lieux rattachés à votre organisation apparaîtront ici."
    />
  ) : (
    <DataTable
      columns={columns}
      data={rows}
      loading={loading}
      keyExtractor={(row) => row.id}
      onRowClick={(row) => ouvrirFiche(row.id)}
    />
  );

  return (
    <div className="space-y-5">
      <PageHero
        icon={<MapPin className="h-6 w-6 text-savr-primary-200" />}
        title="Lieux"
        subtitle={
          loading || erreur
            ? undefined
            : `${rows.length} lieu${rows.length > 1 ? 'x' : ''} rattaché${rows.length > 1 ? 's' : ''} à votre organisation`
        }
        actions={
          <>
            {ajoutEnCours && (
              <span
                id="demande-ajout-en-cours"
                className="text-sm text-savr-primary-200"
              >
                Une demande d’ajout est en cours de traitement par l’équipe
                Savr.
              </span>
            )}
            <Button
              variant="secondary"
              disabled={ajoutEnCours}
              aria-describedby={
                ajoutEnCours ? 'demande-ajout-en-cours' : undefined
              }
              onClick={() => setAjoutOuvert(true)}
            >
              <Plus />
              Demander l’ajout d’un lieu
            </Button>
          </>
        }
      />

      <div className="rounded-savr-md border border-savr-neutral-200 bg-savr-white p-2 sm:p-4">
        {contenu}
      </div>

      {lieuOuvert && (
        <FicheLieuModal lieuId={lieuOuvert} onClose={fermerFiche} />
      )}

      {ajoutOuvert && (
        <DemandeAjoutLieuModal
          onClose={() => setAjoutOuvert(false)}
          onDemandeEnCours={() => setAjoutEnCours(true)}
        />
      )}
    </div>
  );
}
