# Rapport de recyclage — maquettes validées (version 76, 2026-11-12)

Copie octet pour octet des maquettes validées par Val dans Claude Design
(artifact `JhY9nKwvdzHKAuhF4Rd1d4`, version 76). Étalon visuel du gabarit PDF
`rapport-recyclage-zd@4` (`apps/pdf-renderer/src/templates/rapport-recyclage-zd.ts`).

| Fichier | Page |
|---|---|
| `RapportPage1.dc.html` | Page 1 avec radar (comparaison g/convive) et anneau du taux de recyclage |
| `RapportJauge.dc.html` | Page 1 sans radar, taux de recyclage en jauge pleine largeur |
| `RapportPage2.dc.html` | Page 2, annexe technique (identique dans les deux versions) |

Format Claude Design : `{{navy}}` = `#223870` ; `/_blob/4681284c26985cc515256e83c36b8133`
= logo Savr blanc à coin vert (le gabarit trace le même logo depuis
`apps/pdf-renderer/src/templates/assets/marque.ts`) ; les valeurs surlignées
`.tbd` sont des emplacements de données.

Écarts voulus du gabarit, décidés par Val le 2026-11-12 :

- colonne « Exutoire habituel » (la maquette dit « Exutoire ») et codes R/D du
  référentiel `flux_dechets` (emballages R3/R5, la maquette dit R3/R4) — C4 ;
- hauteur de page 1122 px (la maquette fait 1123 px) : une page A4 fait
  1122,5 px, un pixel de plus pousserait une page blanche.
- « Page 1/2 » en bas à droite de la page 1, sous l'encart (demande de Val du
  2026-11-12, après la maquette) ; le test visuel l'ajoute aussi à la maquette.

Le test `apps/pdf-renderer/src/rapport-recyclage-visuel.test.ts` rend ces
maquettes et le gabarit avec les mêmes valeurs dans le même navigateur, et les
compare pixel à pixel.
