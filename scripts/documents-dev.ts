/**
 * Fabrique sur savr-dev les documents des collectes (attestations de don,
 * bordereaux, rapports), comme le font en production les traitements planifiés.
 *
 *   pnpm documents:dev
 *
 * Les crons Vercel ne tournent que sur le déploiement de production : sur dev, une
 * collecte « Réalisée » n'est jamais clôturée et ses documents ne sont jamais
 * produits (mesuré le 2026-10-09 : 66 collectes dans ce cas, boutons « Télécharger »
 * grisés sur la fiche collecte). Cette commande enchaîne, dans l'ordre, les trois
 * traitements de la chaîne des documents, avec le code du dépôt :
 *   1. clôture des collectes réalisées depuis plus de 24 h (cron cloture-embargo) ;
 *   2. batchs PDF J+1 — ZD, AG, sans excédent (cron batch-pdf-j1) ;
 *   3. fabrication des PDF en file, jusqu'à file vide (cron pdf-worker).
 *
 * Elle ne lance QUE cela : ni l'envoi des ordres aux prestataires logistiques, ni
 * l'attribution AG, ni la facturation. Aucun email n'atteint un vrai destinataire
 * (garde du transport email hors production), et les alertes Slack de la chaîne
 * sont affichées ici au lieu d'être envoyées.
 *
 * Dev seulement : refuse toute base autre que le projet savr-dev. La garde ne porte
 * que sur la BASE : le bucket de stockage est celui que désigne l'environnement, et
 * il est affiché avant toute écriture. Tout ce que la commande écrit (clôtures,
 * numéros de documents, PDF) vaut pour le jeu de données de dev partagé et ne se
 * défait pas.
 */
import { pathToFileURL } from 'node:url';

import { setSlackSink } from '../packages/shared/src/alerting/slack.js';
import { bucketEnvironnement } from '../packages/shared/src/r2/bucket.js';
import { DEV_PROJECT_REF } from '../packages/shared/src/seed/constants.js';
import { createAdminSupabaseClient } from '../packages/shared/src/supabase-client.js';

import { runBatchPdfJ1 } from '../packages/plateforme/src/lib/pdf/batch-pdf-j1.js';
import { runBatchPdfJ1Ag } from '../packages/plateforme/src/lib/pdf/batch-pdf-j1-ag.js';
import { runBatchSansExcedent } from '../packages/plateforme/src/lib/pdf/batch-pdf-sans-excedent.js';
import { runPdfWorker } from '../packages/plateforme/src/lib/pdf/pdf-worker.js';

/**
 * Lève si l'environnement ne désigne pas, sans ambiguïté, la base savr-dev.
 * `NEXT_PUBLIC_SUPABASE_URL` est la variable que lit le client utilisé par les
 * traitements : c'est elle qui est contrôlée, pas une variable voisine.
 */
export function refuserHorsDev(env: Record<string, string | undefined>): void {
  if (env['VERCEL_ENV']) {
    throw new Error(
      'refusé : commande locale, jamais sur un déploiement Vercel.',
    );
  }
  if (env['NODE_ENV'] === 'production') {
    throw new Error('refusé : NODE_ENV=production.');
  }
  let url: URL | null = null;
  try {
    url = new URL(env['NEXT_PUBLIC_SUPABASE_URL'] ?? '');
  } catch {
    // URL absente ou illisible : `url` reste null, donc refus ci-dessous.
  }
  // `host` et non `hostname` : un port inhabituel est refusé lui aussi ; https
  // exigé, la clé de service ne doit jamais partir en clair.
  if (
    url?.protocol !== 'https:' ||
    url.host !== `${DEV_PROJECT_REF}.supabase.co`
  ) {
    throw new Error(
      'refusé : NEXT_PUBLIC_SUPABASE_URL ne désigne pas le projet savr-dev.',
    );
  }
}

/** Passes du worker PDF (5 PDF par passe) : borne de sécurité, pas un réglage. */
const PASSES_MAX = 200;

export async function main(): Promise<void> {
  // En premier, avant toute création de client : c'est la seule barrière.
  refuserHorsDev(process.env);
  // Un PDF en échec définitif alerte Slack : depuis un poste de dev, l'alerte est
  // affichée ici, jamais envoyée aux vrais canaux.
  setSlackSink(async (alerte) => {
    console.error(
      `   ⚠ alerte Slack « ${alerte.canal} » non envoyée : ${alerte.titre} — ${alerte.message}`,
    );
  });
  // Échoue ici, avant toute écriture, si l'environnement ne désigne aucun bucket.
  console.log(`Stockage : bucket « ${bucketEnvironnement()} »`);
  const supabase = createAdminSupabaseClient();
  let echec = false;

  const { data: nbCloturees, error: clotureErr } = await supabase.rpc(
    'fn_cloturer_collectes_embargo',
  );
  if (clotureErr)
    throw new Error(`échec de la clôture : ${clotureErr.message}`);
  console.log(`1. Collectes clôturées : ${String(nbCloturees ?? 0)}`);

  const batchs = [
    ['ZD (bordereaux + rapports)', runBatchPdfJ1],
    ['AG (attestations de don)', runBatchPdfJ1Ag],
    ['AG sans excédent (rapports)', runBatchSansExcedent],
  ] as const;
  for (const [nom, lancer] of batchs) {
    const { errors, ...compteurs } = await lancer(supabase);
    console.log(`2. ${nom} : ${JSON.stringify(compteurs)}`);
    for (const erreur of errors) console.error(`   ⚠ ${erreur}`);
    if (errors.length > 0) echec = true;
  }

  let faits = 0;
  const erreursPdf: string[] = [];
  for (let passe = 0; passe < PASSES_MAX; passe++) {
    const r = await runPdfWorker(supabase);
    faits += r.done;
    erreursPdf.push(...r.errors);
    if (r.processed === 0) break;
  }
  console.log(`3. PDF fabriqués : ${faits}`);
  for (const erreur of erreursPdf) console.error(`   ⚠ ${erreur}`);
  if (erreursPdf.length > 0) echec = true;

  if (echec) {
    throw new Error(
      'échec : au moins un traitement a échoué (détail ci-dessus).',
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err: unknown) => {
    console.error(
      `documents:dev — ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
  });
}
