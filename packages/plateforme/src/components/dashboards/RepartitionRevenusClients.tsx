'use client';

import { useEffect, useState } from 'react';
import { ChartCard } from './charts/cockpit/ChartCard';
import { INK, TEXT_MUTED, GRID } from './charts/cockpit/palette';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { LoadingState } from '@/components/ui/loading-state';
import { EmptyState } from '@/components/ui/empty-state';
import { Text } from '@/components/ui/text';
import { fmtEuro, fmtPct } from '@/lib/format';

// Camembert « Répartition des revenus par client » du Dashboard Admin, Bloc 2
// (Val 2026-11-05) : à droite de l'histogramme, sur les mêmes filtres. Les 6
// premiers clients du type choisi, le reste regroupé dans « Autres ». Données :
// la route du tableau, triée sur le montant du type, plus ses totaux.

type TypeRevenu = 'toutes' | 'zd' | 'ag';

const METRIQUE = {
  toutes: 'montant_total',
  zd: 'montant_zd_ht',
  ag: 'montant_ag_ht',
} as const;

// Palette de séries du Design System, dans l'ordre ; « Autres » en gris.
const COULEURS = [
  'var(--color-savr-dataviz-1)',
  'var(--color-savr-dataviz-2)',
  'var(--color-savr-dataviz-3)',
  'var(--color-savr-dataviz-4)',
  'var(--color-savr-dataviz-5)',
  'var(--color-savr-dataviz-6)',
];
const COULEUR_AUTRES = 'var(--color-savr-neutral-300)';
const NB_CLIENTS = COULEURS.length;

const R = 74;
const C = 2 * Math.PI * R;
const GAP = 2;

interface LigneClient {
  organisation_id: string;
  raison_sociale: string;
  montant_total: number;
  montant_zd_ht: number;
  montant_ag_ht: number;
}

interface Part {
  cle: string;
  nom: string;
  montant: number;
  couleur: string;
}

interface Props {
  from: string;
  to?: string;
  lieuIds?: string[];
  organisationIds?: string[];
  className?: string;
}

export function RepartitionRevenusClients({
  from,
  to,
  lieuIds = [],
  organisationIds = [],
  className,
}: Props) {
  const [type, setType] = useState<TypeRevenu>('toutes');
  const [parts, setParts] = useState<Part[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [survol, setSurvol] = useState<number | null>(null);
  const lieux = lieuIds.join(',');
  const organisations = organisationIds.join(',');

  useEffect(() => {
    const metrique = METRIQUE[type];
    const params = new URLSearchParams({
      from,
      ...(to ? { to } : {}),
      ...(lieux ? { lieu_ids: lieux } : {}),
      ...(organisations ? { organisation_ids: organisations } : {}),
      tri: metrique,
      ordre: 'desc',
      page: '1',
    });
    let perimee = false;
    setLoading(true);
    fetch(`/api/v1/admin/dashboard/revenus-organisations?${params}`)
      .then((r) => r.json())
      .then(
        (json: {
          data?: LigneClient[];
          totaux?: Record<(typeof METRIQUE)[TypeRevenu], number>;
        }) => {
          if (perimee) return;
          const lignes = (json.data ?? [])
            .filter((l) => l[metrique] > 0)
            .slice(0, NB_CLIENTS);
          const tout =
            json.totaux?.[metrique] ??
            lignes.reduce((s, l) => s + l[metrique], 0);
          const suivantes: Part[] = lignes.map((l, i) => ({
            cle: l.organisation_id,
            nom: l.raison_sociale,
            montant: l[metrique],
            couleur: COULEURS[i]!,
          }));
          const reste = tout - suivantes.reduce((s, p) => s + p.montant, 0);
          if (reste >= 0.01)
            suivantes.push({
              cle: 'autres',
              nom: 'Autres',
              montant: reste,
              couleur: COULEUR_AUTRES,
            });
          setParts(suivantes);
          setTotal(tout);
        },
      )
      .catch(() => {
        if (!perimee) {
          setParts([]);
          setTotal(0);
        }
      })
      .finally(() => {
        if (!perimee) setLoading(false);
      });
    return () => {
      perimee = true;
    };
  }, [type, from, to, lieux, organisations]);

  const bascule = (
    <ToggleGroup
      type="single"
      aria-label="Type de revenus"
      value={type}
      onValueChange={(v) => {
        // Choix obligatoire : un clic sur l'item actif ne le désélectionne pas.
        if (v === 'toutes' || v === 'zd' || v === 'ag') setType(v);
      }}
      className="h-9 sm:h-9"
    >
      <ToggleGroupItem value="toutes" className="text-xs">
        Toutes
      </ToggleGroupItem>
      <ToggleGroupItem value="zd" className="text-xs">
        ZD
      </ToggleGroupItem>
      <ToggleGroupItem value="ag" className="text-xs">
        AG
      </ToggleGroupItem>
    </ToggleGroup>
  );

  let cumul = 0;
  const arcs = parts.map((p) => {
    const len = total > 0 ? (p.montant / total) * C : 0;
    const trace = Math.max(0, len - (parts.length > 1 ? GAP : 0));
    const arc = { dasharray: `${trace} ${C - trace}`, dashoffset: -cumul };
    cumul += len;
    return arc;
  });
  const focus = survol != null ? parts[survol] : undefined;

  return (
    <ChartCard
      title="Répartition des revenus par client"
      headerRight={bascule}
      className={className}
    >
      <div data-testid="repartition-revenus-clients">
        {loading ? (
          <LoadingState variant="bloc" lignes={1} className="[&>div]:h-48" />
        ) : parts.length === 0 ? (
          <EmptyState size="inline" title="Aucune donnée sur la période." />
        ) : (
          <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
            <svg
              viewBox="0 0 200 200"
              width={196}
              height={196}
              className="shrink-0"
              role="img"
              aria-label={`Répartition des revenus par client, total ${fmtEuro(total, 0)}`}
              onMouseLeave={() => setSurvol(null)}
            >
              <circle
                cx={100}
                cy={100}
                r={R}
                fill="none"
                stroke={GRID}
                strokeWidth={28}
              />
              {arcs.map((a, i) => (
                <circle
                  key={parts[i]!.cle}
                  cx={100}
                  cy={100}
                  r={R}
                  fill="none"
                  stroke={parts[i]!.couleur}
                  strokeWidth={survol === i ? 32 : 28}
                  strokeDasharray={a.dasharray}
                  strokeDashoffset={a.dashoffset}
                  transform="rotate(-90 100 100)"
                  opacity={survol != null && survol !== i ? 0.35 : 1}
                  style={{
                    cursor: 'pointer',
                    transition:
                      'opacity var(--transition-duration-savr-fast), stroke-width var(--transition-duration-savr-fast)',
                  }}
                  onMouseEnter={() => setSurvol(i)}
                >
                  <title>{`${parts[i]!.nom} : ${fmtEuro(parts[i]!.montant, 0)} (${fmtPct((parts[i]!.montant / total) * 100, 0)})`}</title>
                </circle>
              ))}
              {/* Centre : le client survolé, sinon le total. */}
              <text
                x={100}
                y={98}
                textAnchor="middle"
                className="tabular-nums"
                style={{ fontSize: 22, fontWeight: 900, fill: INK }}
              >
                {fmtEuro(focus ? focus.montant : total, 0)}
              </text>
              <text
                x={100}
                y={118}
                textAnchor="middle"
                style={{ fontSize: 11, fontWeight: 600, fill: TEXT_MUTED }}
              >
                {focus ? fmtPct((focus.montant / total) * 100, 0) : 'Total HT'}
              </text>
            </svg>

            {/* Légende : nom, part et montant de chaque client. */}
            <ul className="w-full min-w-0 space-y-1.5">
              {parts.map((p, i) => (
                <li
                  key={p.cle}
                  className="flex items-center gap-2 text-sm"
                  onMouseEnter={() => setSurvol(i)}
                  onMouseLeave={() => setSurvol(null)}
                >
                  <span
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-savr-sm"
                    style={{ background: p.couleur }}
                  />
                  <Text
                    as="span"
                    tone="strong"
                    className="min-w-0 flex-1 truncate font-semibold"
                    title={p.nom}
                  >
                    {p.nom}
                  </Text>
                  <Text as="span" className="tabular-nums">
                    {fmtPct((p.montant / total) * 100, 0)}
                  </Text>
                  <Text
                    as="span"
                    tone="strong"
                    className="w-24 text-right font-bold tabular-nums"
                  >
                    {fmtEuro(p.montant, 0)}
                  </Text>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </ChartCard>
  );
}
