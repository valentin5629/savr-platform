/**
 * Ligne de commande de l'import Bubble.
 *
 *   pnpm migration:bubble importer        [--types-proposes] [--sans-adresses]
 *   pnpm migration:bubble verifier
 *   pnpm migration:bubble rapport
 *   pnpm migration:bubble remettre-a-zero
 *
 * Variables : MIGRATION_BUBBLE_DATABASE_URL (base locale jetable, obligatoire),
 * MIGRATION_BUBBLE_EXPORTS (défaut ~/Downloads), MIGRATION_BUBBLE_DOSSIER
 * (défaut ~/Documents/savr-migration-bubble), MIGRATION_BUBBLE_REPETITION
 * (défaut repetition-1), MIGRATION_BUBBLE_DECISIONS (défaut : dossier de la
 * répétition). Exports, cache et rapports vivent hors du dépôt, qui est public.
 */
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { connecter, exigerHorsDepot } from './base';
import { jouerChecks } from './checks';
import { importer } from './importer';
import { ecrireRapport } from './rapport';
import { remettreAZero } from './remise-a-zero';

const afficher = (texte: string) => process.stdout.write(`${texte}\n`);
const afficherTable = (lignes: Record<string, unknown>[]) =>
  lignes.forEach((l) =>
    afficher(
      Object.entries(l)
        .map(([c, v]) => `${c}=${String(v)}`)
        .join('  '),
    ),
  );

async function main(): Promise<number> {
  const [commande, ...options] = process.argv.slice(2);
  const env = process.env;
  const adresseBase = env.MIGRATION_BUBBLE_DATABASE_URL;
  const dossier =
    env.MIGRATION_BUBBLE_DOSSIER ??
    join(homedir(), 'Documents', 'savr-migration-bubble');
  const sortie = join(
    dossier,
    env.MIGRATION_BUBBLE_REPETITION ?? 'repetition-1',
  );
  const decisions = env.MIGRATION_BUBBLE_DECISIONS ?? sortie;
  for (const d of [dossier, sortie, decisions])
    exigerHorsDepot(d, fileURLToPath(new URL('../../..', import.meta.url)));

  switch (commande) {
    case 'importer': {
      const bilan = await importer({
        adresseBase,
        dossierExports:
          env.MIGRATION_BUBBLE_EXPORTS ?? join(homedir(), 'Downloads'),
        dossierSortie: sortie,
        dossierDecisions: decisions,
        fichierCache: join(dossier, 'cache', 'adresses.json'),
        appliquerTypesProposes: options.includes('--types-proposes'),
        situerLesLieux: !options.includes('--sans-adresses'),
      });
      afficherTable(bilan.ecritures);
      afficherTable([{ table: 'migration.id_map', ...bilan.correspondances }]);
      afficherTable([{ durees_ms: '', ...bilan.dureesMs }]);
      afficher(`Bilan écrit dans ${join(sortie, 'passages')}`);
      return bilan.correspondances.disparues === 0 ? 0 : 1;
    }
    case 'verifier': {
      const client = await connecter(adresseBase);
      try {
        const resultats = await jouerChecks(client);
        writeFileSync(
          join(sortie, 'checks.json'),
          JSON.stringify(resultats, null, 2),
        );
        afficherTable(
          resultats.map(({ code, nature, anomalies }) => ({
            code,
            nature,
            anomalies,
          })),
        );
        return resultats.some((r) => r.nature === 'bloquant' && r.anomalies > 0)
          ? 1
          : 0;
      } finally {
        await client.end();
      }
    }
    case 'rapport':
      afficher(`Rapport écrit : ${ecrireRapport(sortie)}`);
      return 0;
    case 'remettre-a-zero': {
      const client = await connecter(adresseBase);
      try {
        afficherTable([await remettreAZero(client)]);
        return 0;
      } finally {
        await client.end();
      }
    }
    default:
      process.stderr.write(
        'Commande attendue : importer | verifier | rapport | remettre-a-zero\n',
      );
      return 2;
  }
}

main().then(
  (code) => process.exit(code),
  (erreur: unknown) => {
    process.stderr.write(
      `${erreur instanceof Error ? erreur.message : String(erreur)}\n`,
    );
    process.exit(1);
  },
);
