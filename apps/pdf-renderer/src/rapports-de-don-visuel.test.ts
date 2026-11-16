// Régression visuelle des deux « Rapport de don » (attestation-don@5 et
// rapport-evenement-sans-excedent@3) contre les maquettes validées par Val
// (design/rapport-de-don/2026-11-16/).
//
// Même principe que le rapport de recyclage : gabarit et maquette rendus avec les
// mêmes valeurs, dans le même navigateur, avec les mêmes polices embarquées,
// comparés pixel à pixel (tolérance : 0,5 % des pixels) ; puis aucune page ne
// déborde de l'A4 sur des données extrêmes.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  HAUTEUR,
  LARGEUR,
  TOLERANCE,
  capturer,
  chromiumPresent,
  comparer,
  fermerNavigateur,
  ouvrirNavigateur,
  pageDuBanc,
  visuelObligatoire,
} from './banc-visuel.test-utils.js';
import {
  COIN_ANTI_GASPI,
  CSS_RAPPORT_V4,
  LOGO_DEFS,
  logoSavrComplet,
} from './templates/rapport-recyclage-zd.js';
import {
  renderAttestationDon,
  type AttestationDonData,
} from './templates/attestation-don.js';
import {
  renderRapportEvenementSansExcedent,
  type RapportEvenementSansExcedentData,
} from './templates/rapport-evenement-sans-excedent.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const MAQUETTES = path.resolve(
  ICI,
  '../../../design/rapport-de-don/2026-11-16',
);

// ── Images fictives, les mêmes dans le gabarit et la maquette ────────────────
const svg = (contenu: string, vb: string) =>
  'data:image/svg+xml;base64,' +
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">${contenu}</svg>`,
  ).toString('base64');
const LOGO_CLIENT = svg(
  '<rect width="96" height="40" rx="6" fill="#ff7900"/>',
  '0 0 96 40',
);
const LOGO_TRAITEUR = svg(
  '<circle cx="48" cy="48" r="44" fill="#223870"/>',
  '0 0 96 96',
);
const LOGO_ASSO = svg(
  '<path d="M16 38s-12-7.4-12-16.4A6.9 6.9 0 0 1 16 17.4a6.9 6.9 0 0 1 12 4.2C28 30.6 16 38 16 38z" fill="#e8590c"/><rect x="34" y="16" width="70" height="9" fill="#7a2e0e"/><rect x="34" y="30" width="50" height="6" fill="#9a6a0c"/>',
  '0 0 120 50',
);
const PHOTO = svg(
  '<rect width="300" height="200" fill="#c9b79c"/><rect x="40" y="60" width="140" height="110" fill="#f4f1ea"/>',
  '0 0 300 200',
);

const DESCRIPTION_ASSO =
  'Distribue des repas chauds aux personnes sans abri du quartier, six soirs par semaine.';

function donneesDon(
  over: Partial<AttestationDonData> = {},
): AttestationDonData {
  return {
    numero: 'ATT-DON-2026-00042',
    date_emission: '13/10/2026',
    date_collecte: '12/10/2026',
    nom_evenement: 'Soirée annuelle Horizon',
    date_evenement: '12/10/2026',
    donateur_raison_sociale: 'Maison Exemple Traiteur',
    donateur_siret: '12345678900012',
    association_nom: 'Association Solidarité Exemple',
    mention_fiscale_2041ge: true,
    volume_repas: 310,
    poids_kg: 139.5,
    // 632,32 kg ÷ 0,256 = 2 470 km : les chiffres de la maquette.
    co2_evite_kg: 632.32,
    co2_facteur_repas_kg: 2.04,
    lieu_nom: 'Pavillon des Lilas, Paris 12e',
    nb_pax: 420,
    logo_client_url: LOGO_CLIENT,
    logo_traiteur_url: LOGO_TRAITEUR,
    association_ville: 'Paris 11e',
    association_logo_url: LOGO_ASSO,
    association_description: DESCRIPTION_ASSO,
    photo_url: PHOTO,
    ...over,
  };
}

function donneesSansExcedent(
  over: Partial<RapportEvenementSansExcedentData> = {},
): RapportEvenementSansExcedentData {
  return {
    nom_evenement: 'Soirée annuelle Horizon',
    date_evenement: '12/10/2026',
    lieu_nom: 'Pavillon des Lilas, Paris 12e',
    traiteur_nom: 'Maison Exemple Traiteur',
    nb_pax: 420,
    logo_client_url: LOGO_CLIENT,
    logo_traiteur_url: LOGO_TRAITEUR,
    mandant_nom: 'Maison Exemple Traiteur',
    associations_proches: [
      {
        nom: 'Association Solidarité Exemple',
        ville: 'Paris 11e',
        logo_url: LOGO_ASSO,
        description:
          'Distribue des repas chauds aux personnes sans abri du quartier, six soirs par semaine. Quarante bénévoles servent les plats reçus des traiteurs et orientent les personnes vers un hébergement.',
      },
      {
        nom: 'Épicerie Partagée Démo',
        ville: 'Montreuil',
        description:
          'Épicerie solidaire qui accueille les familles orientées par les services sociaux de Montreuil : produits frais et plats cuisinés à petit prix, ateliers cuisine et aide aux démarches.',
      },
    ],
    ...over,
  };
}

// ── Maquette rendue avec les mêmes valeurs ───────────────────────────────────
const POLICES = CSS_RAPPORT_V4.split('\n')
  .filter((l) => l.startsWith('@font-face'))
  .join('\n');

/** Premier fragment du gabarit qui correspond (sert à poser le même contenu). */
const extrait = (html: string, motif: RegExp) => {
  const m = motif.exec(html);
  if (!m) throw new Error(`fragment introuvable dans le gabarit : ${motif}`);
  return m[0];
};

/**
 * La maquette Claude Design (gabarit `.dc.html`), ses trous `{{…}}` et ses
 * `<sc-if>` résolus, le logo Savr en image remplacé par le tracé du gabarit
 * (même dessin, coin orange) et les emplacements de logos par ceux du gabarit.
 */
function maquetteRendue(
  fichier: string,
  html: string,
  remplacements: [string | RegExp, string][],
): string {
  const source = readFileSync(path.join(MAQUETTES, fichier), 'utf8');
  const helmet = (
    /<helmet>([\s\S]*?)<\/helmet>/.exec(source)?.[1] ?? ''
  ).replace(/<link[^>]*>/g, '');
  let page =
    /<\/helmet>([\s\S]*?)<\/x-dc>/.exec(source)?.[1] ?? 'MAQUETTE ILLISIBLE';
  page = page
    .replaceAll('{{navy}}', '#223870')
    .replace(/height: ?1123px/g, `height: ${HAUTEUR}px`)
    .replace(
      /<img src="data:image\/png;base64,[^"]+" alt="Savr Anti-gaspi" style="([^"]*)">/g,
      (_, style: string) => {
        const h = Number(/height: ?(\d+)px/.exec(style)?.[1]);
        const reste = style
          .replace(/width: ?[^;]+;? ?/, '')
          .replace(/height: ?\d+px;? ?/, '');
        // Même largeur que le gabarit : 140 × 38 (bandeau), 118 × 32 (encart).
        return logoSavrComplet(h === 38 ? 140 : 118, h, reste, COIN_ANTI_GASPI);
      },
    );
  const logos = extrait(
    html,
    /<div style="position: absolute; right: 0; top: 0; display: flex; gap: 10px;">.*?<\/div>(?=\n)/,
  );
  page = page.replace(
    /<div style="position: absolute; right: 0; top: 0; display: flex; gap: 10px;">.*?\[Logo traiteur\]<\/div><\/div>/,
    logos,
  );
  for (const [de, vers] of remplacements) page = page.replace(de, vers);
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>${POLICES}</style>${helmet}</head><body>${LOGO_DEFS}${page}</body></html>`;
}

/** Garde le contenu des `<sc-if>` vrais, retire les faux. */
function resoudreScIf(page: string, vrais: string[]): string {
  return page.replace(
    /<sc-if value="\{\{([^}]+)\}\}"[^>]*>([\s\S]*?)<\/sc-if>/g,
    (_, nom: string, contenu: string) =>
      vrais.includes(nom.trim()) ? contenu : '',
  );
}

// ── Mesure du débordement ────────────────────────────────────────────────────
async function mesurer(html: string) {
  const page = pageDuBanc();
  await page.setViewportSize({ width: LARGEUR, height: HAUTEUR });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(() => {
    const pg = document.querySelector('.pg-1') as HTMLElement;
    const haut = pg.getBoundingClientRect().top;
    const encart = pg.querySelector(
      'section[aria-label="Présentation de Savr"]',
    ) as HTMLElement;
    let large = 0;
    let bas = 0;
    pg.querySelectorAll(
      'main *, header > div *, header > p, header > h1',
    ).forEach((el) => {
      const r = el.getBoundingClientRect();
      large = Math.max(large, r.right);
      bas = Math.max(bas, r.bottom - haut);
    });
    return {
      pages: document.querySelectorAll('.pg-1').length,
      encartBas: encart.getBoundingClientRect().bottom - haut,
      bas,
      large,
      // Descriptions coupées par -webkit-line-clamp : un bloc plus bas que ses
      // lignes rogne la dernière sans points de suspension.
      descriptionsRognees: [
        ...pg.querySelectorAll<HTMLElement>('p[style*="line-clamp"]'),
      ].filter((p) => {
        const s = getComputedStyle(p);
        const attendu =
          Math.min(
            parseFloat(s.webkitLineClamp),
            Math.round(p.scrollHeight / parseFloat(s.lineHeight)),
          ) * parseFloat(s.lineHeight);
        return p.getBoundingClientRect().height + 0.5 < attendu;
      }).length,
    };
  });
}

const suite = chromiumPresent || visuelObligatoire ? describe : describe.skip;

suite(
  'M2.4 / rapports de don illustrés — identiques aux maquettes validées (régression visuelle)',
  () => {
    beforeAll(ouvrirNavigateur, 60_000);
    afterAll(fermerNavigateur);

    it('rapport de don = RapportDon (écart ≤ 0,5 %)', async () => {
      const html = renderAttestationDon(donneesDon());
      const gabarit = await capturer(html);
      const logoAsso = extrait(
        html,
        /<img src="[^"]*" alt="Logo de l'association"[^>]*>/,
      );
      const brute = maquetteRendue('RapportDon.dc.html', html, [
        ['{{assoColonnes}}', 'minmax(0, 1.8fr) minmax(0, 1fr)'],
        ['{{asso.nom}}', 'Association Solidarité Exemple'],
        ['{{asso.ville}}', 'Paris 11e'],
        ['{{asso.description}}', DESCRIPTION_ASSO],
        [
          /src="\/_blob\/[0-9a-f]+" alt="Photo de la collecte"/,
          `src="${PHOTO}" alt="Photo de la collecte"`,
        ],
      ]);
      // Logo de l'association : celui du gabarit (une image), à la place du dessin
      // de démonstration de la maquette.
      const maquetteHtml = resoudreScIf(brute, [
        'photo',
        'asso.logoSolidarite',
      ]).replace(
        /<svg role="img" aria-label="Logo de l'association"[\s\S]*?<\/svg>/,
        logoAsso,
      );
      const maquette = await capturer(maquetteHtml);
      expect(
        await comparer('rapport-don', gabarit, maquette),
      ).toBeLessThanOrEqual(TOLERANCE);
    }, 60_000);

    it('rapport sans excédent = RapportSansExcedent (écart ≤ 0,5 %)', async () => {
      const html = renderRapportEvenementSansExcedent(donneesSansExcedent());
      const gabarit = await capturer(html);
      const logoAsso = extrait(
        html,
        /<img src="[^"]*" alt="Logo de l'association"[^>]*>/,
      );
      const maquetteHtml = maquetteRendue('RapportSansExcedent.dc.html', html, [
        [
          /<svg role="img" aria-label="Logo de l'association"[\s\S]*?<\/svg>/,
          logoAsso,
        ],
        // Écart voulu : « du lieu de l'événement » (la maquette nomme le lieu,
        // « du Pavillon des Lilas », que le gabarit ne sait pas accorder).
        [
          'les plus proches du Pavillon des Lilas,',
          "les plus proches du lieu de l'événement,",
        ],
      ]);
      const maquette = await capturer(maquetteHtml);
      expect(
        await comparer('rapport-sans-excedent', gabarit, maquette),
      ).toBeLessThanOrEqual(TOLERANCE);
    }, 60_000);

    // ── Débordement A4 : l'encart Savr garde sa marge de 34px sous lui ────────
    const LONG_NOM_EVENEMENT =
      'Convention annuelle des directeurs régionaux et de leurs équipes commerciales — édition anniversaire';
    const LONGUE_DESCRIPTION =
      'Réseau de quatorze lieux d’accueil qui servent chaque soir des repas aux personnes hébergées en urgence, aux étudiants en difficulté et aux familles accompagnées par les services sociaux du département. '.repeat(
        6,
      );
    const casDon: [string, AttestationDonData][] = [
      ['valeurs de la maquette', donneesDon()],
      ['sans photo', donneesDon({ photo_url: null })],
      [
        'nom d’événement sur deux lignes, description très longue, avec photo',
        donneesDon({
          nom_evenement: LONG_NOM_EVENEMENT,
          association_description: LONGUE_DESCRIPTION,
        }),
      ],
      [
        'description très longue, sans photo',
        donneesDon({
          nom_evenement: LONG_NOM_EVENEMENT,
          association_description: LONGUE_DESCRIPTION,
          photo_url: null,
        }),
      ],
      [
        'gros chiffres et nom d’association long',
        donneesDon({
          poids_kg: 12_345.5,
          volume_repas: 27_434,
          co2_evite_kg: 55_965,
          association_nom:
            'Fondation d’Aide Alimentaire Exemple d’Île-de-France et des communes limitrophes',
        }),
      ],
      [
        'sans CO₂e, sans logo, sans description',
        donneesDon({
          co2_evite_kg: null,
          association_logo_url: null,
          association_description: null,
          logo_client_url: null,
          logo_traiteur_url: null,
        }),
      ],
      ['document régénéré', donneesDon({ regenere_le: '14/10/2026' })],
    ];
    for (const [nom, donnees] of casDon) {
      it(`débordement A4 — rapport de don, ${nom}`, async () => {
        const m = await mesurer(renderAttestationDon(donnees));
        expect(m.pages).toBe(1);
        expect(m.encartBas).toBeLessThanOrEqual(HAUTEUR - 34 + 0.5);
        expect(m.bas).toBeLessThanOrEqual(HAUTEUR - 34 + 0.5);
        expect(m.large).toBeLessThanOrEqual(LARGEUR);
        expect(m.descriptionsRognees).toBe(0);
      }, 60_000);
    }

    const casSansExcedent: [string, RapportEvenementSansExcedentData][] = [
      ['valeurs de la maquette', donneesSansExcedent()],
      [
        'descriptions et noms très longs',
        donneesSansExcedent({
          nom_evenement: LONG_NOM_EVENEMENT,
          mandant_nom:
            'Les Grandes Tables Réceptions et Événements de Paris et d’Île-de-France',
          associations_proches: [
            {
              nom: 'Fondation d’Aide Alimentaire Exemple d’Île-de-France et des communes limitrophes',
              ville: 'Saint-Denis',
              description: LONGUE_DESCRIPTION,
            },
            {
              nom: 'Épicerie Partagée Démo',
              ville: 'Montreuil',
              logo_url: LOGO_ASSO,
              description: LONGUE_DESCRIPTION,
            },
          ],
        }),
      ],
      [
        'une seule association',
        donneesSansExcedent({
          associations_proches:
            donneesSansExcedent().associations_proches?.slice(0, 1),
        }),
      ],
      ['aucune association', donneesSansExcedent({ associations_proches: [] })],
      ['document régénéré', donneesSansExcedent({ regenere_le: '14/10/2026' })],
    ];
    for (const [nom, donnees] of casSansExcedent) {
      it(`débordement A4 — rapport sans excédent, ${nom}`, async () => {
        const m = await mesurer(renderRapportEvenementSansExcedent(donnees));
        expect(m.pages).toBe(1);
        expect(m.encartBas).toBeLessThanOrEqual(HAUTEUR - 34 + 0.5);
        expect(m.bas).toBeLessThanOrEqual(HAUTEUR - 34 + 0.5);
        expect(m.large).toBeLessThanOrEqual(LARGEUR);
        expect(m.descriptionsRognees).toBe(0);
      }, 60_000);
    }
  },
);
