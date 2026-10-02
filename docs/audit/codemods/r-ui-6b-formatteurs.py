#!/usr/bin/env python3
"""R-UI-6b — J2 formatteurs : lib/format source unique, Intl.NumberFormat locaux et concaténations € / % / kg."""
import re, glob, os
os.chdir('/home/user/savr-platform/packages/plateforme/src')

def edit(p, reps):
    s = open(p).read()
    for a, b in reps:
        c = s.count(a); assert c == 1, f"{p}: {a[:60]!r} count={c}"; s = s.replace(a, b)
    open(p, 'w').write(s); print("OK", p)

def add_import(s, names, path):
    m = re.search(r"^import \{([^}]*)\} from '" + re.escape(path) + r"';$", s, re.M)
    if m:
        cur = [n.strip() for n in m.group(1).split(',') if n.strip()]
        for n in names:
            if n not in cur: cur.append(n)
        return s[:m.start()] + "import { " + ', '.join(cur) + " } from '" + path + "';" + s[m.end():]
    lines = s.split('\n'); idx = [i for i, l in enumerate(lines) if l.startswith('import ') or l.startswith("} from ")]
    lines.insert(idx[-1] + 1, f"import {{ {', '.join(names)} }} from '{path}';"); return '\n'.join(lines)

# text.tsx : le commentaire déclenchait design-tokens-existent (motif text-savr-neutral-…)
p = 'components/ui/text.tsx'; s = open(p).read()
s2 = re.sub(r"les recettes `text-\{taille\}\n// text-savr-neutral-\{gris\}` relevées", "les recettes « taille + gris\n// neutre » relevées", s)
assert s2 != s, 'text.tsx comment'
open(p, 'w').write(s2); print("OK text.tsx")

# EvolutionZdChart : TINT n'est plus utilisé (chip → ToggleChip variant accent)
p = 'components/dashboards/charts/cockpit/EvolutionZdChart.tsx'; s = open(p).read()
a = "  TINT,\n"; assert s.count(a) == 1; open(p, 'w').write(s.replace(a, "")); print("OK TINT")

edit('lib/format.ts', [
(""" * Périmètre volontairement réduit (entiers, décimales, €, %, kg). Les règles
 * encore à arbitrer (seuil kg→t, graphie CO₂, pax) arrivent avec R-UI-6 ; les
 * graphes Cockpit gardent leurs variantes sans unité dans
 * `components/dashboards/charts/cockpit/fmt.ts` jusque-là.
 */""", """ * Périmètre : entiers, décimales, €, montants en devise, %, kg, pax (R-UI-6b,
 * J2 : plus aucun `Intl.NumberFormat` local ni concaténation « ${n} € / % / kg »
 * dans l'app). Restent à arbitrer, et donc hors d'ici : le seuil kg→t
 * (`cockpit/fmt.ts` `fmtMasse`, Q5) et la graphie CO₂ (Q6).
 */"""),
("""/** Masse en kilogrammes, sans bascule en tonnes (arbitrage Q5 à venir) : « 840 kg ». */
export function fmtKg(n: number, d = 0): string {
  return `${nombre(n, d)}${NBSP}kg`;
}""", """/** Masse en kilogrammes, sans bascule en tonnes (arbitrage Q5 à venir) : « 840 kg ». */
export function fmtKg(n: number, d = 0): string {
  return `${nombre(n, d)}${NBSP}kg`;
}

/** Masse saisie (pesée) : décimale affichée seulement si elle existe : « 12 kg », « 12,5 kg ». */
export function fmtKgAuto(n: number): string {
  const v = new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(n);
  return `${v}${NBSP}kg`;
}

/** Montant dans la devise de la facture : « 1 234,50 € » (EUR = fmtEuro ; autre devise = Intl). */
export function fmtMontant(n: number, devise: string): string {
  if (!devise || devise === 'EUR') return fmtEuro(n);
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: devise,
  }).format(n);
}

/** Convives : « 4 300 pax ». */
export function fmtPax(n: number): string {
  return `${fmtInt(n)}${NBSP}pax`;
}"""),
])
edit('components/dashboards/charts/cockpit/fmt.ts', [
("""/** Euro fr : « 14 820 » (l'unité € est rendue à part par l'appelant). */
export function fmtEuro(n: number, d = 0): string {
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(n);
}

/** Pourcentage fr : « 78,4 ». */
export function fmtPct(n: number, d = 1): string {
  return fmtDec(n, d);
}

""", """// Les ex-homonymes sans unité `fmtEuro` / `fmtPct` (0 usage) ont été retirés en
// R-UI-6b : la source unique est `lib/format` (`fmtEuro` avec €, `fmtPct` avec %).

"""),
])
p = 'app/(admin)/admin/factures/[id]/page.tsx'; s = open(p).read()
a = """  const fmt = new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: facture.devise,
  });"""
b = """  const fmt = { format: (n: number) => fmtMontant(n, facture.devise) };"""
assert s.count(a) == 1; s = s.replace(a, b)
a = "  fmt: Intl.NumberFormat;"; b = "  fmt: { format: (n: number) => string };"
assert s.count(a) == 1; s = s.replace(a, b)
s = add_import(s, ['fmtMontant'], '@/lib/format'); open(p, 'w').write(s); print("OK", p)

p = 'app/(admin)/admin/factures/page.tsx'; s = open(p).read()
for champ in ('montant_ht', 'montant_ttc'):
    a = f"""      new Intl.NumberFormat('fr-FR', {{
        style: 'currency',
        currency: row.devise,
      }}).format(row.{champ}),"""
    b = f"      fmtMontant(row.{champ}, row.devise),"
    assert s.count(a) == 1, champ; s = s.replace(a, b)
s = add_import(s, ['fmtMontant'], '@/lib/format'); open(p, 'w').write(s); print("OK", p)

p = 'components/admin/collecte-detail-panel.tsx'; s = open(p).read()
a = "texte: `jusqu'à ${new Intl.NumberFormat('fr-FR').format(collecte.evenements.pax)} pax`,"
b = "texte: `jusqu'à ${fmtPax(collecte.evenements.pax)}`,"
assert s.count(a) == 1; s = s.replace(a, b)
a = '<span className="font-medium">{poids} kg</span>'; b = '<span className="font-medium">{fmtKgAuto(poids)}</span>'
assert s.count(a) == 1; s = s.replace(a, b)
s = add_import(s, ['fmtPax', 'fmtKgAuto'], '@/lib/format'); open(p, 'w').write(s); print("OK", p)

p = 'components/collecte/fiche-collecte-client-onglets.tsx'; s = open(p).read()
a = "new Intl.NumberFormat('fr-FR').format(evt.pax)"; b = "fmtInt(evt.pax)"
assert s.count(a) == 1; s = s.replace(a, b); s = add_import(s, ['fmtInt'], '@/lib/format'); open(p, 'w').write(s); print("OK", p)

p = 'components/collecte/fiche-collecte-client-panel.tsx'; s = open(p).read()
a = "? `${new Intl.NumberFormat('fr-FR').format(evt.pax)} pax`"; b = "? fmtPax(evt.pax)"
assert s.count(a) == 1; s = s.replace(a, b); s = add_import(s, ['fmtPax'], '@/lib/format'); open(p, 'w').write(s); print("OK", p)

p = 'components/admin/collectes-table.tsx'; s = open(p).read()
a = """  const v = n.toLocaleString('fr-FR', { maximumFractionDigits: 0 });
  return type === 'zero_dechet' ? `${v} € HT` : `${v} €`;"""
b = """  const v = fmtEuro(n, 0);
  return type === 'zero_dechet' ? `${v} HT` : v;"""
assert s.count(a) == 1; s = s.replace(a, b); s = add_import(s, ['fmtEuro'], '@/lib/format'); open(p, 'w').write(s); print("OK", p)

p = 'app/(admin)/admin/clients/[id]/onglets.tsx'; s = open(p).read()
a = "  v != null ? `${v.toLocaleString('fr-FR')} €` : '—';"; b = "  v != null ? fmtEuro(v) : '—';"
assert s.count(a) == 1; s = s.replace(a, b); s = add_import(s, ['fmtEuro'], '@/lib/format'); open(p, 'w').write(s); print("OK", p)

p = 'components/dashboards/RevenusHistogramme.tsx'; s = open(p).read()
a = "        : `${v.toLocaleString('fr-FR')} €`;"; b = "        : fmtEuro(v, 0);"
assert s.count(a) == 1; s = s.replace(a, b); s = add_import(s, ['fmtEuro'], '@/lib/format'); open(p, 'w').write(s); print("OK", p)

p = 'app/(gestionnaire)/gestionnaire/evenements/[id]/page.tsx'; s = open(p).read()
a = "? `${f.poids_reel_kg} kg`"; b = "? fmtKgAuto(f.poids_reel_kg)"
assert s.count(a) == 1; s = s.replace(a, b); s = add_import(s, ['fmtKgAuto'], '@/lib/format'); open(p, 'w').write(s); print("OK", p)

rx = re.compile(r"\$\{fmtDec\(((?:[^(){}]|\([^()]*\))*?), (\d)\)\} %")
n = 0
for f in glob.glob('app/**/*.tsx', recursive=True) + glob.glob('components/**/*.tsx', recursive=True):
    if '.test.' in f: continue
    s = open(f).read(); s2, k = rx.subn(r"${fmtPct(\1, \2)}", s)
    if k:
        n += k; s2 = add_import(s2, ['fmtPct'], '@/lib/format'); open(f, 'w').write(s2); print("fmtPct", k, f)
print("total fmtPct", n)
