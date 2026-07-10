/**
 * Tooltip du KPI « Marge générée » (BL-P3-02) — restitue la formule officielle
 * R_marge_zd_traiteur avec les valeurs réelles de la période (scénario P1
 * `kpi_marge_zd_formule_nominale`, tests/06.04) :
 *   Marge = tarif_refacture_pax_zd × pax − Σ factures HT ZD.
 * Le coût (Σ factures HT ZD) est dérivé : coût = tarif × pax − marge (le tarif est
 * une donnée du traiteur, lisible par lui — CDC §04 l.928, écriture Admin only).
 */
const fmt2 = (v: number): string => v.toFixed(2).replace('.', ',');

export function margeTooltipZd(
  tarif: number,
  pax: number,
  marge: number,
): string {
  const cout = tarif * pax - marge;
  return `Marge = ${fmt2(tarif)} €/pax × ${pax} pax − ${fmt2(cout)} € = ${fmt2(marge)} €`;
}
