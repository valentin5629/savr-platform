/**
 * Rapport d'une répétition, écrit hors dépôt à partir des bilans de passage et
 * du résultat des checks. Ne contient que des comptes : les lignes nominatives
 * restent dans les fichiers CSV voisins.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { DECLENCHEURS_COUPES, DECLENCHEURS_LAISSES } from './base';
import type { ResultatCheck } from './checks';
import { TABLES_SANS_EFFET, type BilanPassage } from './importer';

const tableau = (entetes: string[], lignes: (string | number)[][]) =>
  [
    `| ${entetes.join(' | ')} |`,
    `| ${entetes.map(() => '---').join(' | ')} |`,
    ...lignes.map((l) => `| ${l.join(' | ')} |`),
  ].join('\n');

export function redigerRapport(
  passages: BilanPassage[],
  checks: ResultatCheck[] | null,
): string {
  const sections: string[] = ['# Migration Bubble — rapport de répétition', ''];
  const premier = passages[0];
  if (!premier) return sections.concat('Aucun passage enregistré.').join('\n');

  sections.push(
    `Passages : ${passages.map((p) => p.horodatage).join(', ')} — jour de référence ${premier.jourReference}.`,
    '',
    '## Exports chargés',
    '',
    tableau(
      ['Type', 'Fichier retenu', 'Lignes', 'Fichiers écartés'],
      Object.entries(premier.exports).map(([type, e]) => [
        type,
        e.fichier,
        e.lignes,
        e.ecartes.map((x) => `${x.fichier} (${x.motif})`).join(' ; ') || '—',
      ]),
    ),
    '',
    '## Écritures par table et par passage',
    '',
    'Un rejeu sain n’insère et ne modifie rien.',
    '',
    tableau(
      [
        'Table',
        ...passages.flatMap((_, i) => [
          `P${i + 1} lues`,
          `P${i + 1} insérées`,
          `P${i + 1} modifiées`,
          `P${i + 1} inchangées`,
        ]),
      ],
      premier.ecritures.map((e, rang) => [
        e.table,
        ...passages.flatMap((p) => {
          const x = p.ecritures[rang]!;
          return [x.lues, x.inserees, x.modifiees, x.inchangees];
        }),
      ]),
    ),
    '',
    tableau(
      ['Table de correspondance', 'insérées', 'modifiées', 'disparues du plan'],
      passages.map((p, i) => [
        `passage ${i + 1}`,
        p.correspondances.inserees,
        p.correspondances.modifiees,
        p.correspondances.disparues,
      ]),
    ),
    '',
    '## Nombre de lignes en base, avant et après chaque passage',
    '',
    tableau(
      [
        'Table',
        ...passages.flatMap((_, i) => [`P${i + 1} avant`, `P${i + 1} après`]),
      ],
      Object.keys(premier.comptes).map((t) => [
        TABLES_SANS_EFFET.includes(t) ? `${t} (aucune écriture attendue)` : t,
        ...passages.flatMap((p) => [p.comptes[t]!.avant, p.comptes[t]!.apres]),
      ]),
    ),
    '',
    '## Lignes rejetées, par motif (dernier passage)',
    '',
    tableau(
      ['Source — motif', 'Lignes'],
      Object.entries(passages.at(-1)!.rejets).sort(([a], [b]) =>
        a.localeCompare(b),
      ),
    ),
    '',
    '## Listes de complétion ou d’arbitrage (dossier `listings/`)',
    '',
    tableau(
      ['Fichier', 'Lignes'],
      Object.entries(passages.at(-1)!.listings).sort(([a], [b]) =>
        a.localeCompare(b),
      ),
    ),
    '',
    '## Emails gardés pour rendre son historique au commercial',
    '',
    'Table `migration.auteurs_evenements` : `evenement_id` (clé), `email` (en minuscules, sans espace autour), `provenance` (`commercial` = email du commercial qui a programmé la collecte dans Bubble ; `contact_traiteur` = email de contact du traiteur, pris seulement quand le premier manque). Comptes seulement.',
    '',
    tableau(
      [
        'Passage',
        'Événements importés',
        'Email du commercial',
        'Email de contact seul',
        'Sans email',
        'Emails distincts',
        'Emails sur domaine public',
        'Emails hors des domaines de l’organisation',
        'Événements concernés',
      ],
      passages.map((p, i) => [
        i + 1,
        p.auteurs.evenements,
        p.auteurs.avecEmailCommercial,
        p.auteurs.avecEmailContactSeul,
        p.auteurs.sansEmail,
        p.auteurs.emailsDistincts,
        p.auteurs.emailsSurDomainePublic,
        p.auteurs.emailsHorsDomaineOrganisation,
        p.auteurs.evenementsHorsDomaineOrganisation,
      ]),
    ),
    '',
    '## CO₂ et service d’adresses',
    '',
    tableau(
      [
        'Passage',
        'CO₂ anti-gaspi calculés',
        'CO₂ zéro déchet calculés',
        'Adresses',
        'Appels au service',
        'Échecs',
        'Lues du cache',
      ],
      passages.map((p, i) => [
        i + 1,
        p.co2.antiGaspi,
        p.co2.zeroDechet,
        p.geocodage.adresses,
        p.geocodage.appels,
        p.geocodage.echecs,
        p.geocodage.duCache,
      ]),
    ),
    '',
    '## Durées (millisecondes)',
    '',
    tableau(
      ['Étape', ...passages.map((_, i) => `Passage ${i + 1}`)],
      Object.keys(premier.dureesMs).map((etape) => [
        etape,
        ...passages.map((p) => p.dureesMs[etape] ?? '—'),
      ]),
    ),
    '',
  );

  if (checks) {
    const etat = (c: ResultatCheck) =>
      c.anomalies === 0
        ? 'vert'
        : c.nature === 'bloquant'
          ? 'ROUGE'
          : 'à compléter avant le go-live';
    sections.push(
      '## Checks de réconciliation',
      '',
      tableau(
        ['Code', 'Contrôle', 'Nature', 'Anomalies', 'État'],
        checks.map((c) => [c.code, c.libelle, c.nature, c.anomalies, etat(c)]),
      ),
      '',
    );
  }

  sections.push(
    '## Déclencheurs coupés pendant l’import, puis rétablis',
    '',
    tableau(
      ['Table', 'Déclencheur', 'Pourquoi'],
      DECLENCHEURS_COUPES.map((d) => [d.table, d.nom, d.raison]),
    ),
    '',
    '## Déclencheurs laissés actifs',
    '',
    tableau(
      ['Table', 'Déclencheurs'],
      Object.entries(DECLENCHEURS_LAISSES)
        .filter(([, noms]) => noms.length > 0)
        .map(([t, noms]) => [t, noms.join(', ')]),
    ),
    '',
  );
  return sections.join('\n');
}

export function ecrireRapport(dossierSortie: string): string {
  const dossierPassages = join(dossierSortie, 'passages');
  const passages = (
    existsSync(dossierPassages) ? readdirSync(dossierPassages) : []
  )
    .filter((f) => /^passage-.*\.json$/.test(f))
    .sort()
    .map(
      (f) =>
        JSON.parse(
          readFileSync(join(dossierPassages, f), 'utf8'),
        ) as BilanPassage,
    );
  const fichierChecks = join(dossierSortie, 'checks.json');
  const checks = existsSync(fichierChecks)
    ? (JSON.parse(readFileSync(fichierChecks, 'utf8')) as ResultatCheck[])
    : null;
  const chemin = join(dossierSortie, 'rapport.md');
  // Notes rédigées à la main pour cette répétition (constats, mesures faites à part) : jointes telles quelles.
  const fichierNotes = join(dossierSortie, 'notes.md');
  const notes = existsSync(fichierNotes)
    ? `\n${readFileSync(fichierNotes, 'utf8')}`
    : '';
  writeFileSync(chemin, redigerRapport(passages, checks) + notes);
  return chemin;
}
