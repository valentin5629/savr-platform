#!/usr/bin/env tsx
/**
 * check-fetch-path-encoding — cliquet « segment de chemin /api/ toujours encodé ».
 * =============================================================================
 * Problème fermé (relevé du reviewer rls-securite en revue de #285, corrigé dans
 * le lot suivant) : `fetch(`/api/v1/traiteur/collectes/${from}`)` interpolait un
 * paramètre d'URL brut dans un SEGMENT DE CHEMIN. Le préfixe `/api/…` interdit la
 * sortie d'origine (pas de `//evil.tld` protocol-relative), mais une valeur
 * `../../autre-endpoint` REMONTE l'arborescence et adresse un autre endpoint
 * same-origin avec la session de l'utilisateur lui-même.
 *
 * Garde : dans tout littéral gabarit commençant par `/api/`, un `${…}` situé
 * dans la portion CHEMIN (avant le premier `?`/`#`) et précédé d'un `/` — donc
 * un segment entier — doit passer par `encodeURIComponent(…)`.
 *   ✅ `/api/v1/x/${encodeURIComponent(id)}`      (segment inerte)
 *   ❌ `/api/v1/x/${id}`                          (remontée possible)
 *   ⚪ `/api/v1/x?${qs}` / `/api/v1/x${suffix}`   (hors portée : query, pas un segment)
 *
 * Angle mort ASSUMÉ (documenté, pas détecté) : un gabarit qui ne commence pas
 * par `/api/` mais qui est COMPOSÉ dans un tel gabarit (`…${suffixe}`) échappe à
 * cette regex. Les 3 seuls points de composition du code client sont sûrs par
 * construction et doivent le rester :
 *   - `(admin)/admin/factures/[id]/page.tsx` → `callEdit(segments: string[])`
 *     encode chaque segment lui-même (la signature interdit de lui passer un
 *     chemin déjà composé) ;
 *   - `(gestionnaire)/gestionnaire/collectes/page.tsx` et
 *     `(traiteur)/…/mon-organisation-client.tsx` → suffixe de QUERY issu de
 *     `URLSearchParams.toString()` (déjà encodé, jamais un segment).
 * Toute nouvelle composition doit encoder à la source, comme `callEdit`.
 * Même angle mort pour un segment PARTIEL (`/api/v1/x/pref${id}`, `${…}` non
 * précédé d'un `/`) : indistinguable d'un suffixe de query par la forme seule.
 * Le détecteur s'auto-teste à chaque exécution (SONDES ci-dessous) pour qu'il
 * ne devienne pas aveugle en silence à ce qu'il DOIT attraper.
 *
 * Périmètre : le code client de `packages/plateforme/src` — hors `src/app/api/**`
 * (handlers serveur : ces gabarits sont des libellés d'endpoint, pas des appels)
 * et hors fichiers de test (les oracles doivent pouvoir écrire l'URL attendue
 * en clair).
 *
 * Émet RATCHET_COUNT=<n> — câblé dans `pnpm check:ratchet` avec baseline 0 :
 * toute NOUVELLE interpolation brute fait rougir la CI.
 * =============================================================================
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const RACINE = 'packages/plateforme/src';

function fichiers(): string[] {
  const out = execSync(
    `grep -rl --include='*.ts' --include='*.tsx' '/api/' ${RACINE} || true`,
    { encoding: 'utf8' },
  ).trim();
  if (!out) return [];
  return out
    .split('\n')
    .filter((f) => !f.startsWith(`${RACINE}/app/api/`))
    .filter((f) => !/\.(test|spec)\.tsx?$/.test(f));
}

type Violation = {
  fichier: string;
  ligne: number;
  gabarit: string;
  expr: string;
};

/**
 * Un segment n'est réputé sûr que s'il est EXACTEMENT `encodeURIComponent(<expr>)`
 * — pas un encodage suivi d'une concaténation (`encodeURIComponent(a) + '/' + b`),
 * qui réintroduirait un `/` après coup (relevé rls-securite).
 */
function estEncode(expr: string): boolean {
  return /^encodeURIComponent\(.*\)$/.test(expr) && !/[+`]/.test(expr);
}

/**
 * Segments de chemin interpolés SANS encodeURIComponent dans un gabarit `/api/…`.
 * Pure (non exportée : importer ce module exécuterait le gate) — c'est ce que les
 * sondes d'auto-test ci-dessous exercent.
 */
function segmentsNonEncodes(gabarit: string): string[] {
  // Le séparateur ?/# est cherché sur le gabarit DONT LES INTERPOLATIONS ONT ÉTÉ
  // NEUTRALISÉES : un `?.`, un `??` ou un ternaire vit à l'intérieur d'un ${…} et
  // tronquerait sinon le « chemin », désactivant la détection pour tout le reste
  // du gabarit (`/api/v1/x/${a?.id}/y/${brut}` passait vert).
  const neutralise = gabarit.replace(/\$\{[^}]*\}/g, (m) =>
    'X'.repeat(m.length),
  );
  const fin = neutralise.search(/[?#]/);
  const chemin = fin === -1 ? gabarit : gabarit.slice(0, fin);
  return [...chemin.matchAll(/\/\$\{([^}]*)\}/g)]
    .map((seg) => seg[1]!.trim())
    .filter((expr) => !estEncode(expr));
}

/**
 * Auto-test du détecteur, rejoué à CHAQUE exécution : un cliquet aveugle à la
 * forme qu'il est né pour attraper produit exactement la fausse confiance qu'il
 * prétend supprimer. Une sonde qui ne tombe plus = gate en échec (pas de
 * RATCHET_COUNT émis → `check:ratchet` rougit).
 */
const SONDES: { gabarit: string; attendus: number }[] = [
  { gabarit: '/api/v1/x/${id}', attendus: 1 },
  { gabarit: '/api/v1/x/${encodeURIComponent(id)}', attendus: 0 },
  // Le bug d'origine réécrit avec ?. / ?? / ternaire (ex-faux négatif) :
  { gabarit: "/api/v1/x/${from ?? ''}", attendus: 1 },
  { gabarit: '/api/v1/x/${a?.id}/y/${brut}', attendus: 2 },
  {
    gabarit: "/api/v1/x/${encodeURIComponent(c ? 'a' : 'b')}/y/${brut}",
    attendus: 1,
  },
  // Encodage suivi d'une concaténation : le `/` revient après coup.
  { gabarit: "/api/v1/x/${encodeURIComponent(a) + '/' + b}", attendus: 1 },
  // Query : hors portée (pas un segment), y compris le suffixe composé.
  { gabarit: '/api/v1/x?org=${orgId}', attendus: 0 },
  { gabarit: '/api/v1/x${qs}', attendus: 0 },
];

function autoTest(): void {
  const echecs = SONDES.filter(
    (s) => segmentsNonEncodes(s.gabarit).length !== s.attendus,
  );
  if (echecs.length === 0) return;
  console.error(
    '🔴 check-fetch-path-encoding : DÉTECTEUR EN ÉCHEC (auto-test) — le gate ne prouve plus rien :',
  );
  for (const s of echecs) {
    console.error(
      `   \`${s.gabarit}\` → ${segmentsNonEncodes(s.gabarit).length} détecté(s), ${s.attendus} attendu(s)`,
    );
  }
  process.exit(1);
}

function violations(): Violation[] {
  const trouvees: Violation[] = [];
  for (const f of fichiers()) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/`(\/api\/[^`]*)`/g)) {
      const gabarit = m[1]!;
      for (const expr of segmentsNonEncodes(gabarit)) {
        trouvees.push({
          fichier: f,
          ligne: src.slice(0, m.index).split('\n').length,
          gabarit,
          expr,
        });
      }
    }
  }
  return trouvees;
}

autoTest();
const trouvees = violations();
if (trouvees.length > 0) {
  console.error(
    `🔴 check-fetch-path-encoding : ${trouvees.length} segment(s) de chemin /api/ interpolé(s) sans encodeURIComponent :`,
  );
  for (const v of trouvees) {
    console.error(
      `   ${v.fichier}:${v.ligne}  \`${v.gabarit}\`  → \${${v.expr}}`,
    );
  }
  console.error(
    `   → encoder le segment : \${encodeURIComponent(<expr>)} (une valeur en ../ adresserait un autre endpoint same-origin).`,
  );
} else {
  console.log(
    '✅ check-fetch-path-encoding : 0 segment de chemin /api/ interpolé sans encodeURIComponent.',
  );
}
console.log(`RATCHET_COUNT=${trouvees.length}`);
