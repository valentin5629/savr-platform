# Rapports de don — maquettes validées (2026-11-16)

Copie octet pour octet des maquettes validées par Val dans Claude Design
(canevas « Rapports PDF Savr », artifact `Xu8kwvKgkvYvZRUXQPkVcn`, version 63).
Étalons visuels des gabarits PDF d'une collecte anti-gaspi :

| Fichier | Gabarit | Collecte |
|---|---|---|
| `RapportDon.dc.html` | `attestation-don@5` (`apps/pdf-renderer/src/templates/attestation-don.ts`) | avec excédents |
| `RapportSansExcedent.dc.html` | `rapport-evenement-sans-excedent@3` (`apps/pdf-renderer/src/templates/rapport-evenement-sans-excedent.ts`) | sans excédent (`realisee_sans_collecte`) |

Format Claude Design : `{{navy}}` = `#223870` ; le logo « Savr Anti-gaspi » est
une image PNG (le gabarit trace le même logo, coin orange, depuis
`apps/pdf-renderer/src/templates/assets/marque.ts`) ; les logos et la photo de la
maquette sont des exemples fictifs, remplacés par le test.

Écarts voulus du gabarit, décidés le 2026-11-16 :

- pas de page 2 (attestation de collecte et de remise) : reportée par Val ;
- hauteur de page 1122 px (la maquette fait 1123 px), comme le rapport de recyclage ;
- rapport sans excédent : « les plus proches du lieu de l'événement » (la maquette
  nomme le lieu, « du Pavillon des Lilas », que le gabarit ne sait pas accorder) ;
- garde-fous sans effet aux valeurs de la maquette : description de l'association
  coupée au-delà de 8 lignes, 6 quand le nom de l'événement dépasse 20 caractères
  (il tient alors sur deux lignes du bandeau : environ 310 caractères avec photo,
  540 sans) ; descriptions des associations proches au-delà de 5 lignes ; noms sur
  2 lignes au plus ; chiffres de la frise réduits au-delà de 8 caractères.

Le test `apps/pdf-renderer/src/rapports-de-don-visuel.test.ts` rend ces maquettes et
les gabarits avec les mêmes valeurs dans le même navigateur, et les compare pixel à
pixel.
