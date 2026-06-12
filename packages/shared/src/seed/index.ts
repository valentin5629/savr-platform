/**
 * Point d'entrée CLI des scripts de seed Savr (dev only).
 *
 *   tsx packages/shared/src/seed/index.ts minimal   # reset + seed_minimal
 *   tsx packages/shared/src/seed/index.ts demo       # reset + seed_demo
 *
 * Branché sur les commandes pnpm seed:minimal / seed:demo.
 */

import { loadEnv, assertDev, connect } from './db.js';
import { resetBusinessData } from './reset.js';
import { seedMinimal } from './minimal.js';
import { seedDemo } from './demo.js';

async function main(): Promise<void> {
  const dataset = process.argv[2];
  if (dataset !== 'minimal' && dataset !== 'demo') {
    console.error('Usage : seed <minimal|demo>');
    process.exit(1);
  }

  const env = loadEnv();
  assertDev(env); // garde-fou prod bloquant

  const t0 = Date.now();
  const client = await connect(env);
  try {
    console.log(`[seed:${dataset}] reset des données métier…`);
    await resetBusinessData(client);

    console.log(`[seed:${dataset}] injection…`);
    if (dataset === 'minimal') {
      await seedMinimal(client);
    } else {
      await seedDemo(client); // dataset autonome (timeline 12 mois, 478 collectes)
    }

    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[seed:${dataset}] terminé en ${secs}s ✅`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('[seed] échec :', err.message);
  process.exit(1);
});
