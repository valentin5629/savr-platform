/**
 * Cliquet — les fonctions Vercel s'exécutent à Paris (cdg1), à côté de Supabase.
 *
 * Jusqu'au 2026-09-11, vercel.json ne déclarait pas de `regions` : le projet tombait sur
 * la région par défaut iad1 (Washington) alors que savr-prod / savr-dev sont en eu-west-3
 * (Paris). Chaque requête Supabase traversait l'Atlantique (~80-100 ms aller-retour) :
 * `/api/health` (seuil DB 200 ms) répondait 503 en permanence et les SLA p95 du CDC
 * (`08 - Performance/02`, listes 200 ms / détails 250 ms) étaient hors de portée.
 *
 * La région vit dans le repo (et non dans le seul réglage projet Vercel) pour être revue
 * en PR et s'appliquer aussi aux crons et aux déploiements Preview.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

const vercel = JSON.parse(
  readFileSync(resolve(__dirname, '../../../vercel.json'), 'utf8'),
) as { regions?: string[] };

describe('région des fonctions Vercel (cliquet vercel.json)', () => {
  it('épinglée sur cdg1 (Paris), co-localisée avec Supabase eu-west-3', () => {
    expect(vercel.regions).toEqual(['cdg1']);
  });
});
