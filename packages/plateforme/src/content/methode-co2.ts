// Méthode de calcul du CO₂ de Savr, publiée sur /methode-co2 (décision Val
// 2026-11-10, d'après le guide anti-greenwashing Climeet : « un lien mène vers
// une page de détail »). Liée sous chaque CO₂e évité des écrans clients.
//
// Source : note « Méthode CO2 Savr » du Vault (15. Traçabilité déchets &
// Méthode de calcul, version novembre 2026), complétée de l'Anti-Gaspi et des
// limites. Les valeurs sont celles appliquées par la base (migrations
// 20261106120000, 20261106170000, 20261106190000) : toute modification d'un
// facteur, d'un taux de captation ou du forfait transport doit être reportée
// ici, avec `METHODE_CO2_MISE_A_JOUR`.
//
// Même format que les CGU (`cgu-texte.ts`) : segments {texte, gras}, jamais de HTML.

import type { BlocCgu, SectionCgu } from './cgu-texte';

export const METHODE_CO2_MISE_A_JOUR = '10 novembre 2026';

const p = (texte: string): BlocCgu => ({
  type: 'p',
  segments: [{ texte, gras: false }],
});

const h3 = (texte: string): BlocCgu => ({
  type: 'h3',
  segments: [{ texte, gras: false }],
});

/** Élément de liste « Libellé : texte », le libellé en gras. */
const li = (libelle: string, texte: string): BlocCgu => ({
  type: 'li',
  segments: [
    { texte: libelle, gras: true },
    { texte: ` : ${texte}`, gras: false },
  ],
});

export const METHODE_CO2_SECTIONS: SectionCgu[] = [
  {
    titre: 'En bref',
    blocs: [
      li(
        'Une source publique',
        'tous les facteurs d’émission viennent de la Base Carbone® de l’ADEME (version 23.6). Chaque facteur porte son identifiant, que vous pouvez vérifier vous-même.',
      ),
      li(
        'Émis et évité, toujours séparés',
        'nous ne soustrayons jamais l’un de l’autre. Des émissions évitées ne se déduisent pas d’un bilan carbone : elles se présentent à part.',
      ),
      li(
        'Des estimations',
        'les poids sont relevés à chaque collecte ; les facteurs, les taux de captation et la composition des bacs sont des moyennes. Les chiffres affichés sont donc des estimations.',
      ),
      li(
        'Un périmètre limité',
        'nos chiffres ne portent que sur les déchets et excédents alimentaires collectés par Savr. Ils ne mesurent pas l’empreinte carbone d’un événement, dont le transport des participants représente en général la plus grande part.',
      ),
    ],
  },
  {
    titre: 'Ce que Savr calcule',
    blocs: [
      p(
        'Pour une collecte de déchets triés (verre, carton, biodéchets, emballages, déchet résiduel), Savr calcule trois indicateurs à partir des poids relevés flux par flux.',
      ),
      li(
        'CO₂ induit',
        'les émissions causées par la collecte et par le traitement des déchets (tri, recyclage, méthanisation, incinération).',
      ),
      li(
        'CO₂ évité',
        'les émissions qui n’ont pas lieu grâce au traitement, par rapport à la production qu’il remplace : une bouteille recyclée remplace du verre neuf, l’énergie produite par un incinérateur remplace une autre source d’énergie.',
      ),
      li(
        'Taux de recyclage estimé',
        'la part du poids collecté qui entre en recyclage après le tri, calculée avec des taux de captation moyens.',
      ),
      p(
        'Pour une collecte d’excédents alimentaires donnés à une association (Anti-Gaspi), Savr calcule le nombre de repas donnés et le CO₂ évité correspondant (voir plus bas).',
      ),
      p(
        'L’unité est le kilogramme d’équivalent CO₂ (kg CO₂e), qui additionne tous les gaz à effet de serre selon leur effet sur le climat.',
      ),
    ],
  },
  {
    titre: 'Collecte des déchets triés : les facteurs',
    blocs: [
      p(
        'Pour chaque mode de traitement, la Base Carbone publie deux facteurs : « Impacts » (émissions du traitement, collecte et transports compris) et « Émissions évitées » (ce que le traitement remplace : matière neuve, énergie, engrais). Savr applique à chaque flux le facteur du traitement de ce flux.',
      ),
      p('Valeurs en kg CO₂e par tonne collectée (induit / évité) :'),
      li('Verre, recyclage', '639 / 1 158 (Base Carbone 34472 / 34473).'),
      li(
        'Carton, recyclage',
        '992 / 379 (34480 / 34481). En CO₂ seul, recycler le carton émet plus qu’il n’évite ; le recyclage préserve en revanche le bois et l’eau, que ce chiffre ne mesure pas.',
      ),
      li(
        'Biodéchets, méthanisation',
        '173 / 12 (34636 / 34637). L’intérêt de la méthanisation est surtout de rendre la matière organique au sol et de produire du biogaz.',
      ),
      li(
        'Emballages, recyclage',
        '715 / 921 : moyenne des matériaux du bac (carton et papier, bouteilles PET, flacons PEhd, aluminium, acier, briques), pondérée par leur part, dont 30 % de refus de tri comptés comme incinérés. Cette composition est une estimation de Savr.',
      ),
      li(
        'Déchet résiduel, incinération avec récupération d’énergie',
        '374 / 212 (34650 / 34651). Brûler le déchet résiduel émet plus qu’il n’évite : mieux trier réduit ce flux.',
      ),
      h3('Le calcul'),
      p(
        'CO₂ induit = somme, pour chaque flux, du poids en tonnes × facteur « Impacts », plus un forfait de transport.',
      ),
      p(
        'CO₂ évité = somme, pour chaque flux, déchet résiduel compris, du poids en tonnes × facteur « Émissions évitées ».',
      ),
      h3('Le forfait de transport'),
      p(
        'Les facteurs de l’ADEME comptent déjà la collecte et les transports jusqu’au site de traitement. Par prudence, Savr ajoute malgré tout un forfait à chaque collecte : 25 km aller-retour × 0,4 kg CO₂e/km (camion 20 m³ diesel), soit 10 kg CO₂e. Ce forfait compte une seconde fois une partie du transport et augmente volontairement le CO₂ induit.',
      ),
      h3('Exemple : une collecte de 700 kg'),
      p(
        '120 kg de verre, 80 kg de carton, 300 kg de biodéchets, 50 kg d’emballages et 150 kg de déchet résiduel donnent 309,8 kg CO₂e induits et 250,7 kg CO₂e évités. Une collecte peut donc émettre plus qu’elle n’évite : nous affichons les deux chiffres, sans les soustraire.',
      ),
    ],
  },
  {
    titre: 'Taux de recyclage estimé',
    blocs: [
      p(
        'Tout ce qui est collecté dans un flux trié n’est pas recyclé : une partie est écartée au centre de tri. Le taux applique à chaque flux un taux de captation, puis divise par le poids total collecté. Le déchet résiduel compte dans le poids total mais n’est jamais recyclé.',
      ),
      p(
        'Taux de captation retenus par Savr : verre 95 %, carton 90 %, biodéchets 85 %, emballages 60 %. Ce sont des moyennes, que Savr mettra à jour à partir des retours des sites de traitement ; elles ne sont pas mesurées collecte par collecte.',
      ),
      p(
        'Le poids recyclé est celui qui entre dans l’opération de recyclage après le tri, comme le prévoit la décision d’exécution (UE) 2019/1004. Les biodéchets méthanisés comptent comme recyclés lorsque le digestat retourne au sol (directive (UE) 2018/851, article 11 bis, paragraphe 4).',
      ),
    ],
  },
  {
    titre: 'Dons anti-gaspi',
    blocs: [
      li(
        'Nombre de repas',
        'estimé à partir du poids d’excédents relevé à la collecte, à raison de 0,45 kg par repas (hypothèse Savr), arrondi au repas supérieur.',
      ),
      li(
        'CO₂ évité',
        'nombre de repas × 2,04 kg CO₂e, facteur « Repas moyen » de la Base Carbone (20682). Hypothèse : chaque repas donné évite qu’un repas équivalent soit produit pour nourrir ses bénéficiaires.',
      ),
      li(
        'Collectes calculées avant le 6 novembre 2026',
        'elles gardent l’estimation précédente, 2,5 kg CO₂e par repas (FAO). Chaque collecte conserve le facteur en vigueur à son calcul.',
      ),
      p('Le transport des dons n’est pas compté dans ce chiffre.'),
    ],
  },
  {
    titre: 'Équivalences',
    blocs: [
      p(
        'Pour rendre les chiffres parlants, le CO₂ évité est traduit en équivalences de la vie courante :',
      ),
      li(
        '1 km en voiture',
        '0,256 kg CO₂e (Base Carbone, voiture motorisation moyenne 2023, 43791).',
      ),
      li(
        '1 repas avec bœuf',
        '7,26 kg CO₂e (Base Carbone, repas à dominante animale avec bœuf, 20689).',
      ),
    ],
  },
  {
    titre: 'Limites et mises à jour',
    blocs: [
      li(
        'Données mesurées',
        'les poids, relevés flux par flux à chaque collecte.',
      ),
      li(
        'Données estimées',
        'les facteurs d’émission (moyennes nationales), les taux de captation, la composition du bac emballages et le poids moyen d’un repas.',
      ),
      li(
        'Recalcul',
        'les chiffres d’une collecte sont recalculés à chaque correction de poids, avec les facteurs enregistrés à son calcul.',
      ),
      p(
        'Pour utiliser ces chiffres dans une communication, citez-les comme des estimations, avec leur périmètre (les déchets ou excédents collectés par Savr) et un lien vers cette page.',
      ),
    ],
  },
  {
    titre: 'Vérifier nos sources',
    blocs: [
      p(
        'Les facteurs se consultent sur base-empreinte.ademe.fr (compte gratuit), en cherchant leur identifiant (par exemple 34472). La base affiche les émissions évitées avec un signe moins : −1 158 correspond aux 1 158 kg évités indiqués ici.',
      ),
      p(
        'Ce qu’ils couvrent est décrit dans la documentation générale de la Base Carbone, version 23.11.0 : périmètre des facteurs de traitement des déchets, collecte et transports inclus (p. 313) ; définition des facteurs « impact » et « émissions évitées » (p. 314) ; déchets d’emballages (p. 319) ; méthanisation (p. 343) ; ordures ménagères résiduelles (p. 351).',
      ),
    ],
  },
];
