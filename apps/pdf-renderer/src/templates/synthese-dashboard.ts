// Template PDF — Rapport de synthèse agrégé (§12 Reporting §1.6).
//
// SEUL document AGRÉGÉ multi-collectes de la V1 (les bordereaux/attestations/rapports
// ZD sont au grain collecte). Généré À LA DEMANDE, en SYNCHRONE, par la route
// packages/plateforme/.../api/v1/dashboards/synthese-pdf (R20b-2, décision Val
// 2026-07-07) — jamais archivé (pas de jobs_pdf, pas de shared.fichiers, table
// rapports_synthese supprimée).
//
// Sections rendues selon le(s) type(s) sélectionné(s) (décision Val 2026-07-07) :
//   - onglet ZD → chiffres clés ZD + ventilation flux (camembert) + évolution + détail ZD
//   - onglet AG → chiffres clés AG + ventilation Anti-Gaspi (top assos) + détail AG
//   - filtre type décoché → ZD + AG (toutes sections applicables)
// Le template rend une section UNIQUEMENT si sa donnée est présente/non vide → la
// route omet flux_zd/evolution/co2 hors ZD, et associations_ag/repas hors AG.
//
// Watermark répété par page = exception V2 actée (comme les autres templates V1) :
// on se limite à un pied de page « Rapport généré par Savr · <horodatage> ».
// Logo de l'organisation (branding) = hors scope R20b-2 (BL-P3-05 / R23) → nom en texte.

// Version figée du gabarit — doit rester égale à TEMPLATE_VERSIONS['synthese-dashboard']
// du contrat partagé (@savr/shared/src/pdf/document-types.ts). Vérifié par le gate
// CI check:pdf-contract. Incrémenter @N à toute modif structurelle.
export const TEMPLATE_VERSION = 'synthese-dashboard@1';

export interface SyntheseFluxLigne {
  nom: string;
  poids_kg: number;
}

export interface SyntheseAssoLigne {
  association_nom: string;
  nb_collectes: number;
  repas_donnes: number;
  poids_kg: number;
}

export interface SyntheseLieuLigne {
  lieu_nom: string;
  nb_collectes: number;
  tonnage_kg: number;
}

export interface SyntheseTraiteurLigne {
  traiteur_nom: string;
  nb_collectes: number;
  tonnage_kg: number;
}

export interface SyntheseEvolutionMois {
  mois: string; // libellé court "01/26"
  tonnage_kg: number;
  taux_recyclage: number | null; // %
}

export interface SyntheseDetailLigne {
  date_evenement: string;
  evenement: string;
  lieu: string;
  type: string; // 'ZD' | 'AG' | 'ZD + AG' (grain 1 ligne/événement)
  tonnage_kg: number | null;
  taux_recyclage: number | null; // ZD ; null (affiché « — ») pour AG
  repas_donnes: number | null;
}

export interface SyntheseCo2 {
  evite_kg: number;
  induit_kg: number;
  net_kg: number;
  energie_primaire_evitee_kwh: number;
  equiv_km_voiture?: number | null;
  facteurs_version?: string | null;
}

export interface SyntheseDashboardData {
  // Page de garde
  organisation_nom: string;
  // Logo de l'organisation cible inliné en data URI (BL-P3-05, §12 §1.6 l.283 :
  // « Logo Savr + logo de l'organisation cible si logo_url »). null = Savr seul.
  logo_data_uri?: string | null;
  perimetre_label: string; // "traiteur", "gestionnaire de lieux", "agence"
  periode_label: string; // "01/01/2026 → 30/06/2026"
  filtres_label?: string | null; // "Lieux : X, Y · Types : Zéro-Déchet" ou null
  date_generation: string;
  nb_collectes: number;

  // Section 1 — chiffres clés
  inclut_zd: boolean;
  inclut_ag: boolean;
  tonnage_zd_kg: number;
  tonnage_ag_kg: number;
  taux_recyclage_moyen_pondere?: number | null; // ZD, % ; null si pas de pesée
  nb_repas_donnes: number; // AG
  co2?: SyntheseCo2 | null; // ZD agrégé

  // Sections conditionnelles
  flux_zd?: SyntheseFluxLigne[] | null; // Section 2 (ZD)
  associations_ag?: SyntheseAssoLigne[] | null; // Section 3 (AG)
  lieux?: SyntheseLieuLigne[] | null; // Section 4 (≥2 lieux, ou gestionnaire)
  traiteurs?: SyntheseTraiteurLigne[] | null; // Ventilation par traiteur (gestionnaire)
  evolution?: SyntheseEvolutionMois[] | null; // Section 5 (ZD)
  detail: SyntheseDetailLigne[]; // Section 6

  // Annexes
  co2_facteurs_snapshot?: Record<string, unknown> | null;
}

// ── Formatage FR ─────────────────────────────────────────────────────────────
function fr(n: number, decimals = 2): string {
  return n.toFixed(decimals).replace('.', ',');
}
function kg(n: number | null | undefined): string {
  return n == null ? '—' : `${fr(n, 1)} kg`;
}
function tonnes(n: number | null | undefined): string {
  return n == null ? '—' : `${fr(n / 1000, 2)} t`;
}
function pct(n: number | null | undefined): string {
  return n == null ? '—' : `${fr(n, 1)} %`;
}

export function renderSyntheseDashboard(data: SyntheseDashboardData): string {
  const { flux_zd, associations_ag, lieux, traiteurs, evolution, detail, co2 } =
    data;

  const hasFlux = data.inclut_zd && !!flux_zd && flux_zd.length > 0;
  const hasAssos =
    data.inclut_ag && !!associations_ag && associations_ag.length > 0;
  const hasLieux = !!lieux && lieux.length > 0;
  const hasTraiteurs = !!traiteurs && traiteurs.length > 0;
  const hasEvolution =
    data.inclut_zd && !!evolution && evolution.some((m) => m.tonnage_kg > 0);

  // ── Page de garde ──
  const cover = `
  <section class="cover">
    <div class="cover-brand">
      <span class="logo-savr">Savr</span>
      ${data.logo_data_uri ? `<img class="cover-logo-org" src="${esc(data.logo_data_uri)}" alt="" />` : ''}
    </div>
    <h1>Rapport de synthèse — ${esc(data.perimetre_label)}</h1>
    <div class="cover-org">${esc(data.organisation_nom)}</div>
    <div class="cover-periode">${esc(data.periode_label)}</div>
    ${data.filtres_label ? `<div class="cover-filtres">${esc(data.filtres_label)}</div>` : ''}
    <div class="cover-meta">
      <span>Généré le ${esc(data.date_generation)}</span>
      <span>${data.nb_collectes} collecte${data.nb_collectes > 1 ? 's' : ''} agrégée${data.nb_collectes > 1 ? 's' : ''}</span>
    </div>
  </section>`;

  // ── Section 1 — chiffres clés ──
  const kpiCards: string[] = [
    `<div class="kpi"><div class="kpi-val">${data.nb_collectes}</div><div class="kpi-lbl">Collectes</div></div>`,
  ];
  if (data.inclut_zd) {
    kpiCards.push(
      `<div class="kpi"><div class="kpi-val">${tonnes(data.tonnage_zd_kg)}</div><div class="kpi-lbl">Tonnage ZD</div></div>`,
      `<div class="kpi"><div class="kpi-val">${pct(data.taux_recyclage_moyen_pondere)}</div><div class="kpi-lbl">Taux de recyclage moyen pondéré</div></div>`,
    );
  }
  if (data.inclut_ag) {
    kpiCards.push(
      `<div class="kpi"><div class="kpi-val">${data.nb_repas_donnes}</div><div class="kpi-lbl">Repas donnés</div></div>`,
      `<div class="kpi"><div class="kpi-val">${tonnes(data.tonnage_ag_kg)}</div><div class="kpi-lbl">Tonnage AG</div></div>`,
    );
  }

  const co2Bloc =
    data.inclut_zd && co2
      ? `
    <div class="co2">
      <h3>Impact carbone agrégé (ZD)</h3>
      <div class="co2-grid">
        <div class="co2-main">
          <div class="co2-val">${fr(co2.evite_kg, 0)} <span>kgCO₂e évités</span></div>
          ${co2.equiv_km_voiture != null ? `<div class="co2-equiv">≈ ${fr(co2.equiv_km_voiture, 0)} km en voiture</div>` : ''}
        </div>
        <table class="co2-detail">
          <tr><td>CO₂ induit (transport + traitement)</td><td class="num">${fr(co2.induit_kg, 0)} kgCO₂e</td></tr>
          <tr><td>CO₂ net (évité − induit, règle ABC)</td><td class="num">${fr(co2.net_kg, 0)} kgCO₂e</td></tr>
          <tr><td>Énergie primaire évitée</td><td class="num">${fr(co2.energie_primaire_evitee_kwh, 0)} kWh</td></tr>
        </table>
      </div>
    </div>`
      : '';

  const section1 = `
  <section>
    <h2>1 · Chiffres clés</h2>
    <div class="kpi-row">${kpiCards.join('')}</div>
    ${co2Bloc}
  </section>`;

  // ── Section 2 — ventilation par flux (ZD) ──
  const section2 = hasFlux
    ? `
  <section>
    <h2>2 · Ventilation par flux (Zéro-Déchet)</h2>
    <div class="flux-grid">
      <table>
        <thead><tr><th>Flux</th><th class="num-h">Poids</th></tr></thead>
        <tbody>
          ${flux_zd!
            .map(
              (f) =>
                `<tr><td>${esc(f.nom)}</td><td class="num">${kg(f.poids_kg)}</td></tr>`,
            )
            .join('')}
        </tbody>
      </table>
      ${pieSvg(flux_zd!.map((f) => ({ label: f.nom, value: f.poids_kg })))}
    </div>
  </section>`
    : '';

  // ── Section 3 — ventilation Anti-Gaspi ──
  const section3 = hasAssos
    ? `
  <section>
    <h2>3 · Ventilation Anti-Gaspi</h2>
    <table>
      <thead><tr><th>Association bénéficiaire</th><th class="num-h">Collectes</th><th class="num-h">Repas donnés</th><th class="num-h">Poids</th></tr></thead>
      <tbody>
        ${associations_ag!
          .map(
            (a) =>
              `<tr><td>${esc(a.association_nom)}</td><td class="num">${a.nb_collectes}</td><td class="num">${a.repas_donnes}</td><td class="num">${kg(a.poids_kg)}</td></tr>`,
          )
          .join('')}
      </tbody>
    </table>
    <p class="hint">Top ${Math.min(3, associations_ag!.length)} des associations bénéficiaires sur la période.</p>
  </section>`
    : '';

  // ── Section 4 — ventilation géographique ──
  const section4 = hasLieux
    ? `
  <section>
    <h2>4 · Ventilation géographique</h2>
    <table>
      <thead><tr><th>Lieu</th><th class="num-h">Collectes</th><th class="num-h">Tonnage</th></tr></thead>
      <tbody>
        ${lieux!
          .map(
            (l) =>
              `<tr><td>${esc(l.lieu_nom)}</td><td class="num">${l.nb_collectes}</td><td class="num">${tonnes(l.tonnage_kg)}</td></tr>`,
          )
          .join('')}
      </tbody>
    </table>
  </section>`
    : '';

  // ── Ventilation par traiteur (gestionnaire only) ──
  const sectionTraiteurs = hasTraiteurs
    ? `
  <section>
    <h2>Ventilation par traiteur</h2>
    <table>
      <thead><tr><th>Traiteur</th><th class="num-h">Collectes</th><th class="num-h">Tonnage</th></tr></thead>
      <tbody>
        ${traiteurs!
          .map(
            (t) =>
              `<tr><td>${esc(t.traiteur_nom)}</td><td class="num">${t.nb_collectes}</td><td class="num">${tonnes(t.tonnage_kg)}</td></tr>`,
          )
          .join('')}
      </tbody>
    </table>
  </section>`
    : '';

  // ── Section 5 — évolution mensuelle (ZD) ──
  const section5 = hasEvolution
    ? `
  <section>
    <h2>5 · Évolution mensuelle</h2>
    ${barChartSvg(evolution!)}
    <p class="hint">Tonnage mensuel (barres) et taux de recyclage moyen pondéré (courbe).</p>
  </section>`
    : '';

  // ── Section 6 — détail des collectes ──
  const section6 = `
  <section>
    <h2>6 · Détail des collectes</h2>
    <table class="detail">
      <thead>
        <tr>
          <th>Date événement</th><th>Événement</th><th>Lieu</th><th>Type</th>
          <th class="num-h">Tonnage</th><th class="num-h">Taux recyclage</th><th class="num-h">Repas donnés</th>
        </tr>
      </thead>
      <tbody>
        ${
          detail.length > 0
            ? detail
                .map(
                  (d) => `<tr>
          <td>${esc(d.date_evenement)}</td>
          <td>${esc(d.evenement)}</td>
          <td>${esc(d.lieu)}</td>
          <td>${esc(d.type)}</td>
          <td class="num">${tonnes(d.tonnage_kg)}</td>
          <td class="num">${pct(d.taux_recyclage)}</td>
          <td class="num">${d.repas_donnes != null ? d.repas_donnes : '—'}</td>
        </tr>`,
                )
                .join('')
            : `<tr><td colspan="7" class="empty">Aucune collecte clôturée sur la période et les filtres sélectionnés.</td></tr>`
        }
      </tbody>
    </table>
  </section>`;

  // ── Annexes ──
  const facteurs = data.co2_facteurs_snapshot;
  const facteursRows =
    facteurs && typeof facteurs === 'object'
      ? Object.entries(facteurs)
          .filter(([, v]) => v == null || typeof v !== 'object')
          .map(
            ([k, v]) =>
              `<tr><td>${esc(k)}</td><td class="num">${esc(String(v ?? '—'))}</td></tr>`,
          )
          .join('')
      : '';
  const annexes = data.inclut_zd
    ? `
  <section class="annexes">
    <h2>Annexes</h2>
    <h3>Méthodologie de calcul CO₂</h3>
    <p>Les impacts carbone sont estimés selon les facteurs d'émission ADEME (incertitude ± 50 %).
    Règle ABC : les émissions évitées sont présentées sur une ligne distincte et ne sont jamais
    soustraites du bilan induit. Les biodéchets sont valorisés par méthanisation ; un mix moyen est
    appliqué à la filière emballages. Le CO₂ net = évité − induit.</p>
    <h3>Référentiel des facteurs${co2?.facteurs_version ? ` (version ${esc(co2.facteurs_version)})` : ''}</h3>
    ${
      facteursRows
        ? `<table class="facteurs"><tbody>${facteursRows}</tbody></table>`
        : `<p class="hint">Facteurs figés au moment de chaque collecte (snapshot co2_facteurs_snapshot).</p>`
    }
    <h3>Mentions légales</h3>
    <p>Rapport de synthèse établi par Savr à partir des collectes clôturées de l'organisation.
    Document interne — Savr, gosavr.io.</p>
  </section>`
    : `
  <section class="annexes">
    <h2>Annexes</h2>
    <h3>Mentions légales</h3>
    <p>Rapport de synthèse établi par Savr à partir des collectes clôturées de l'organisation.
    Document interne — Savr, gosavr.io.</p>
  </section>`;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8"/>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 11px; color: #1a1a1a; padding: 28px 32px 44px; }
  h2 { font-size: 13px; font-weight: 700; color: #15803d; border-bottom: 2px solid #16a34a; padding-bottom: 5px; margin: 22px 0 12px; }
  h3 { font-size: 11px; font-weight: 700; color: #374151; margin: 12px 0 5px; }
  section { page-break-inside: auto; }
  .cover { text-align: center; padding: 60px 0 40px; border-bottom: 1px solid #e5e7eb; margin-bottom: 8px; page-break-after: always; }
  .cover-brand { display: flex; align-items: center; justify-content: center; gap: 20px; }
  .cover .logo-savr { font-size: 40px; font-weight: 800; color: #16a34a; letter-spacing: -1px; }
  .cover-logo-org { max-height: 48px; max-width: 200px; object-fit: contain; }
  .cover h1 { font-size: 24px; font-weight: 700; margin: 28px 0 6px; color: #1a1a1a; }
  .cover-org { font-size: 16px; font-weight: 600; color: #15803d; }
  .cover-periode { font-size: 13px; color: #6b7280; margin-top: 8px; }
  .cover-filtres { font-size: 11px; color: #6b7280; margin-top: 12px; font-style: italic; max-width: 480px; margin-left: auto; margin-right: auto; }
  .cover-meta { display: flex; justify-content: center; gap: 24px; margin-top: 28px; font-size: 11px; color: #9ca3af; }
  .kpi-row { display: flex; flex-wrap: wrap; gap: 10px; }
  .kpi { flex: 1; min-width: 120px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 12px 14px; }
  .kpi-val { font-size: 18px; font-weight: 800; color: #15803d; }
  .kpi-lbl { font-size: 9.5px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.4px; margin-top: 3px; }
  .co2 { margin-top: 14px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px 14px; }
  .co2 h3 { margin-top: 0; }
  .co2-grid { display: flex; gap: 20px; align-items: center; margin-top: 8px; }
  .co2-main { min-width: 180px; }
  .co2-val { font-size: 20px; font-weight: 800; color: #15803d; }
  .co2-val span { font-size: 12px; font-weight: 600; }
  .co2-equiv { font-size: 10px; color: #6b7280; margin-top: 4px; }
  .co2-detail { flex: 1; }
  .flux-grid { display: flex; gap: 20px; align-items: flex-start; }
  .flux-grid table { flex: 1; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
  thead { display: table-header-group; }
  thead tr { background: #16a34a; color: #fff; }
  thead th { padding: 7px 9px; text-align: left; font-size: 9.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px; }
  th.num-h { text-align: right; }
  tbody tr { page-break-inside: avoid; }
  tbody tr:nth-child(even) { background: #f9fafb; }
  tbody td { padding: 6px 9px; border-bottom: 1px solid #e5e7eb; font-size: 10.5px; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.empty { text-align: center; color: #9ca3af; font-style: italic; padding: 16px; }
  .co2-detail td { padding: 4px 6px; border-bottom: 1px solid #eef2f7; }
  .hint { font-size: 9.5px; color: #9ca3af; margin-top: 4px; }
  .annexes { page-break-before: always; }
  .annexes p { font-size: 10px; line-height: 1.55; color: #374151; margin-bottom: 6px; }
  .facteurs td { font-size: 9.5px; }
  .footer { position: fixed; bottom: 14px; left: 32px; right: 32px; display: flex; justify-content: space-between; font-size: 8.5px; color: #9ca3af; border-top: 1px solid #e5e7eb; padding-top: 5px; }
</style>
</head>
<body>
  ${cover}
  ${section1}
  ${section2}
  ${section3}
  ${section4}
  ${sectionTraiteurs}
  ${section5}
  ${section6}
  ${annexes}
  <div class="footer">
    <span>Rapport généré par Savr · ${esc(data.date_generation)}</span>
    <span>Savr — gosavr.io</span>
  </div>
</body>
</html>`;
}

// ── Camembert SVG (ventilation flux) ─────────────────────────────────────────
function pieSvg(slices: { label: string; value: number }[]): string {
  const total = slices.reduce((s, x) => s + (x.value > 0 ? x.value : 0), 0);
  if (total <= 0) return '';
  const colors = [
    '#16a34a',
    '#65a30d',
    '#ca8a04',
    '#0891b2',
    '#9333ea',
    '#dc2626',
  ];
  const cx = 70;
  const cy = 70;
  const r = 62;
  let angle = -Math.PI / 2;
  const paths: string[] = [];
  const legend: string[] = [];
  slices.forEach((s, i) => {
    const v = s.value > 0 ? s.value : 0;
    const frac = v / total;
    const color = colors[i % colors.length];
    if (frac > 0) {
      const next = angle + frac * 2 * Math.PI;
      const x1 = cx + r * Math.cos(angle);
      const y1 = cy + r * Math.sin(angle);
      const x2 = cx + r * Math.cos(next);
      const y2 = cy + r * Math.sin(next);
      const large = frac > 0.5 ? 1 : 0;
      // Un seul flux à 100 % : cercle plein (l'arc dégénère).
      if (frac >= 0.999) {
        paths.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>`);
      } else {
        paths.push(
          `<path d="M${cx},${cy} L${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)} Z" fill="${color}"/>`,
        );
      }
      angle = next;
    }
    legend.push(
      `<div class="lg-item"><span class="lg-dot" style="background:${color}"></span>${esc(s.label)} — ${fr((v / total) * 100, 0)} %</div>`,
    );
  });
  return `<div class="pie-wrap">
    <svg width="140" height="140" viewBox="0 0 140 140" xmlns="http://www.w3.org/2000/svg">${paths.join('')}</svg>
    <div class="pie-legend">${legend.join('')}</div>
  </div>
  <style>
    .pie-wrap { display: flex; gap: 14px; align-items: center; }
    .pie-legend { font-size: 9.5px; }
    .lg-item { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
    .lg-dot { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
  </style>`;
}

// ── Barres SVG (évolution mensuelle) + courbe taux ───────────────────────────
function barChartSvg(months: SyntheseEvolutionMois[]): string {
  if (months.length === 0) return '';
  const w = 520;
  const h = 170;
  const padB = 26;
  const padT = 12;
  const padL = 8;
  const maxT = Math.max(...months.map((m) => m.tonnage_kg), 1);
  const n = months.length;
  const slot = (w - padL * 2) / n;
  const barW = Math.min(slot * 0.6, 40);
  const chartH = h - padB - padT;
  const bars: string[] = [];
  const labels: string[] = [];
  const pts: string[] = [];
  months.forEach((m, i) => {
    const x = padL + slot * i + (slot - barW) / 2;
    const bh = (m.tonnage_kg / maxT) * chartH;
    const y = padT + chartH - bh;
    bars.push(
      `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" fill="#16a34a" rx="2"/>`,
    );
    labels.push(
      `<text x="${(x + barW / 2).toFixed(1)}" y="${h - 10}" text-anchor="middle" font-size="8" fill="#6b7280">${esc(m.mois)}</text>`,
    );
    if (m.taux_recyclage != null) {
      const py = padT + chartH - (m.taux_recyclage / 100) * chartH;
      pts.push(`${(x + barW / 2).toFixed(1)},${py.toFixed(1)}`);
    }
  });
  const line =
    pts.length > 1
      ? `<polyline points="${pts.join(' ')}" fill="none" stroke="#ca8a04" stroke-width="1.6"/>`
      : '';
  const dots = pts
    .map((p) => {
      const [x, y] = p.split(',');
      return `<circle cx="${x}" cy="${y}" r="2.4" fill="#ca8a04"/>`;
    })
    .join('');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
    ${bars.join('')}
    ${line}
    ${dots}
    ${labels.join('')}
  </svg>`;
}

function esc(s: string | undefined | null): string {
  if (s == null) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
