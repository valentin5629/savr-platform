'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  EvenementsFilterBar,
  defaultEvenementsFilters,
  type EvenementsListFilters,
} from '@/components/dashboards/index.js';

interface EvenementRow {
  id: string;
  nom_evenement: string | null;
  date_evenement: string | null;
  pax: number | null;
  taille_bracket: string;
  lieu_nom: string | null;
  lieu_ville: string | null;
  traiteur_nom: string | null;
  statut_consolide: string;
  nb_collectes_zd: number;
  nb_collectes_ag: number;
  tonnage_zd_kg: number;
  dechets_labo_kg: number | null;
  repas_donnes: number;
  programmee_par_moi: boolean;
}

// Query string (deep-linkable §06.05 l.99) → filtres. Utilisé à l'init + par les
// cartes KPI du dashboard qui transmettent les filtres globaux.
function filtersFromParams(params: URLSearchParams): EvenementsListFilters {
  const base = defaultEvenementsFilters();
  const typeCollecte = params.get('type_collecte');
  return {
    from: params.get('from') ?? base.from,
    to: params.get('to') ?? base.to,
    lieu_ids: params.getAll('lieu_ids[]'),
    traiteur_ids: params.getAll('traiteur_ids[]'),
    type_evenement_ids: params.getAll('type_evenement_ids[]'),
    taille_evenement_codes: params.getAll('taille_evenements[]'),
    type_collecte:
      typeCollecte === 'avec_zd' ||
      typeCollecte === 'avec_ag' ||
      typeCollecte === 'zd_et_ag'
        ? typeCollecte
        : '',
    statut_consolide: params.getAll('statut_consolide[]'),
  };
}

function toQueryString(f: EvenementsListFilters): URLSearchParams {
  const qs = new URLSearchParams();
  if (f.from) qs.set('from', f.from);
  if (f.to) qs.set('to', f.to);
  f.lieu_ids.forEach((id) => qs.append('lieu_ids[]', id));
  f.traiteur_ids.forEach((id) => qs.append('traiteur_ids[]', id));
  f.type_evenement_ids.forEach((id) => qs.append('type_evenement_ids[]', id));
  f.taille_evenement_codes.forEach((c) => qs.append('taille_evenements[]', c));
  if (f.type_collecte) qs.set('type_collecte', f.type_collecte);
  f.statut_consolide.forEach((s) => qs.append('statut_consolide[]', s));
  return qs;
}

function EvenementsContent() {
  const router = useRouter();
  const params = useSearchParams();
  // État = source unique, initialisé une fois depuis la query string (deep-link,
  // §06.05 l.99). Lecture initiale unique → deps [] volontaire (params capturé au
  // premier rendu ; les changements ultérieurs viennent de l'état, pas de l'URL).
  const initial = useMemo(
    () => filtersFromParams(new URLSearchParams(params.toString())),
    [],
  );
  const [filters, setFilters] = useState<EvenementsListFilters>(initial);
  const [rows, setRows] = useState<EvenementRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const qs = toQueryString(filters);
    // Reflète les filtres dans l'URL (deep-linkable §06.05 l.99), sans rechargement.
    router.replace(`/gestionnaire/evenements?${qs.toString()}`, {
      scroll: false,
    });
    fetch(`/api/v1/gestionnaire/evenements?${qs}`)
      .then((r) => r.json())
      .then((j) => setRows((j.data ?? []) as EvenementRow[]))
      .finally(() => setLoading(false));
    // router hors deps (référence stable Next) : refetch au changement de filtres.
  }, [filters]);

  function exportCsv() {
    const qs = toQueryString(filters);
    window.open(`/api/v1/gestionnaire/evenements/export-csv?${qs}`);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-savr-primary-800">Événements</h1>
        <Button variant="ghost" onClick={exportCsv}>
          Exporter CSV
        </Button>
      </div>

      <EvenementsFilterBar
        value={filters}
        onChange={setFilters}
        resultCount={loading ? undefined : rows.length}
      />

      {loading ? (
        <p className="text-sm text-savr-neutral-500">Chargement…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-savr-neutral-500">Aucun événement.</p>
      ) : (
        <div className="overflow-x-auto rounded-savr-md border border-savr-neutral-200">
          <table className="w-full text-sm">
            <thead className="bg-savr-neutral-50 text-left text-xs uppercase text-savr-neutral-500">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Événement</th>
                <th className="px-3 py-2">Lieu</th>
                <th className="px-3 py-2">Traiteur</th>
                <th className="px-3 py-2">Pax</th>
                <th className="px-3 py-2">Collectes</th>
                <th className="px-3 py-2">Tonnage total</th>
                <th className="px-3 py-2">Déchets labo est.</th>
                <th className="px-3 py-2">Repas donnés</th>
                <th className="px-3 py-2">Statut</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr
                  key={e.id}
                  className="cursor-pointer border-t border-savr-neutral-100 hover:bg-savr-neutral-50"
                  onClick={() =>
                    router.push(`/gestionnaire/evenements/${e.id}`)
                  }
                >
                  <td className="whitespace-nowrap px-3 py-2">
                    {e.date_evenement ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">
                      {e.nom_evenement ?? '—'}
                      {e.programmee_par_moi && (
                        <Badge variant="info" className="ml-1 text-xs">
                          Moi
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-savr-neutral-500">
                      {e.taille_bracket}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div>{e.lieu_nom ?? '—'}</div>
                    <div className="text-xs text-savr-neutral-500">
                      {e.lieu_ville ?? ''}
                    </div>
                  </td>
                  <td className="px-3 py-2">{e.traiteur_nom ?? '—'}</td>
                  <td className="px-3 py-2">{e.pax ?? '—'}</td>
                  <td className="px-3 py-2">
                    <span className="text-xs">
                      {e.nb_collectes_zd > 0 && (
                        <span className="mr-1">{e.nb_collectes_zd} ZD</span>
                      )}
                      {e.nb_collectes_ag > 0 && (
                        <span>{e.nb_collectes_ag} AG</span>
                      )}
                      {e.nb_collectes_zd === 0 &&
                        e.nb_collectes_ag === 0 &&
                        '—'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {e.tonnage_zd_kg > 0
                      ? `${e.tonnage_zd_kg.toFixed(0)} kg`
                      : '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {e.dechets_labo_kg != null
                      ? `${e.dechets_labo_kg.toFixed(0)} kg`
                      : '—'}
                  </td>
                  <td className="px-3 py-2">
                    {e.repas_donnes > 0 ? e.repas_donnes : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <Badge
                      variant={
                        e.statut_consolide === 'Terminé'
                          ? 'success'
                          : e.statut_consolide === 'Annulé'
                            ? 'neutral'
                            : 'info'
                      }
                    >
                      {e.statut_consolide}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function GestionnaireEvenementsPage() {
  return (
    <Suspense fallback={<p className="p-4 text-sm">Chargement…</p>}>
      <EvenementsContent />
    </Suspense>
  );
}
