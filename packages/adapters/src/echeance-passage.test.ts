// M1.5a — échéance d'un ordre réservé (borne du passage tenue dans le code).
//
// Ce fichier prouve le mécanisme seul (calcul, contexte, refus) et deux cliquets
// de structure : tout appel réseau d'un client prestataire passe par le contrôle
// d'échéance, et aucun n'attend plus longtemps que ce que la marge suppose.
// Ce que le worker en FAIT est prouvé dans outbox-worker.echeance.test.ts.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BAIL_RESERVATION_MS,
  MARGE_APPEL_MS,
  MARGE_ECRITURE_MS,
  avecEcheance,
  echeanceOrdre,
  limiteEcriture,
  verifierEcheance,
} from './echeance-passage.js';
import { LogistiqueTransientError } from './index.js';

const T0 = Date.parse('2027-01-20T22:00:00.000Z');
/** Plus longue attente d'une réponse que les clients s'autorisent. */
const DUREE_MAX_APPEL_MS = 30_000;

afterEach(() => {
  vi.useRealTimers();
});

describe("M1.5a / passage borné — échéance d'un ordre réservé", () => {
  it('M1.5a/passage_borne_calcul — un appel démarré à temps a répondu ou échoué avant la limite d’écriture, elle-même avant la fin du bail', () => {
    expect(BAIL_RESERVATION_MS).toBe(120_000);
    expect(echeanceOrdre(T0)).toBe(T0 + 80_000);
    expect(limiteEcriture(T0)).toBe(T0 + 115_000);

    // Dernier appel démarré juste avant l'échéance, resté sans réponse jusqu'à l'abandon.
    const finDuDernierAppel = echeanceOrdre(T0) + DUREE_MAX_APPEL_MS;
    expect(finDuDernierAppel).toBeLessThan(limiteEcriture(T0));
    expect(limiteEcriture(T0)).toBeLessThan(T0 + BAIL_RESERVATION_MS);
    expect(MARGE_APPEL_MS).toBeGreaterThan(
      DUREE_MAX_APPEL_MS + MARGE_ECRITURE_MS,
    );
  });

  it('hors d’un passage (relève entrante, healthcheck) : aucun contrôle, jamais de refus', () => {
    expect(() => verifierEcheance('MTS-1 GET /v3/tours/1')).not.toThrow();
  });

  it('M1.5a/passage_borne_refus — avant l’échéance l’appel passe ; à l’échéance et après, il est refusé en erreur passagère qui nomme l’appel', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const echeance = T0 + 1_000;

    await avecEcheance(echeance, async () => {
      vi.setSystemTime(echeance - 1);
      expect(() => verifierEcheance('MTS-1 POST /v3/tours')).not.toThrow();

      vi.setSystemTime(echeance);
      expect(() => verifierEcheance('MTS-1 POST /v3/tours')).toThrow(
        LogistiqueTransientError,
      );

      vi.setSystemTime(echeance + 60_000);
      expect(() => verifierEcheance('MTS-1 POST /v3/tours')).toThrow(
        'Échéance du passage atteinte : MTS-1 POST /v3/tours non démarré',
      );
    });
  });

  it('l’échéance suit le traitement à travers les attentes, et ne survit pas à sa fin', async () => {
    const passee = Date.now() - 1;

    await avecEcheance(passee, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      await Promise.resolve();
      expect(() => verifierEcheance('appel')).toThrow(LogistiqueTransientError);
    });

    expect(() => verifierEcheance('appel')).not.toThrow();
  });

  it('deux traitements simultanés gardent chacun leur échéance', async () => {
    const passee = Date.now() - 1;
    const lointaine = Date.now() + 3_600_000;
    const vus: string[] = [];

    await Promise.all([
      avecEcheance(passee, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        try {
          verifierEcheance('a');
          vus.push('a passe');
        } catch {
          vus.push('a refusé');
        }
      }),
      avecEcheance(lointaine, async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        try {
          verifierEcheance('b');
          vus.push('b passe');
        } catch {
          vus.push('b refusé');
        }
      }),
    ]);

    expect(vus.sort()).toEqual(['a refusé', 'b passe']);
  });

  it('le résultat et l’erreur du traitement sont rendus tels quels', async () => {
    await expect(
      avecEcheance(Date.now() + 1_000, async () => 'adapter_mts1'),
    ).resolves.toBe('adapter_mts1');
    await expect(
      avecEcheance(Date.now() + 1_000, async () => {
        throw new Error('503');
      }),
    ).rejects.toThrow('503');
  });
});

// ── Cliquets de structure ────────────────────────────────────────────────────

const RACINE = path.resolve(__dirname);

function sources(dossier: string): string[] {
  return readdirSync(dossier, { withFileTypes: true }).flatMap((e) => {
    const chemin = path.join(dossier, e.name);
    if (e.isDirectory()) return sources(chemin);
    return /\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [chemin] : [];
  });
}

interface AppelReseau {
  fichier: string;
  ligne: string;
  garde: boolean;
}

/** Chaque `fetch(` réseau des sources, et s'il est précédé du contrôle d'échéance. */
function appelsReseau(): AppelReseau[] {
  return sources(RACINE).flatMap((chemin) => {
    const lignes = readFileSync(chemin, 'utf8').split('\n');
    return lignes.flatMap((ligne, i) => {
      if (!/\bfetch\(/.test(ligne)) return [];
      // La méthode privée du client MTS-1 s'appelle aussi `fetch` : ni sa
      // déclaration ni ses appels ne sont un appel réseau.
      if (/this\.fetch\(|private async fetch\(/.test(ligne)) return [];
      const avant = lignes.slice(Math.max(0, i - 10), i).join('\n');
      return [
        {
          fichier: path.relative(RACINE, chemin),
          ligne: ligne.trim(),
          garde: avant.includes('verifierEcheance('),
        },
      ];
    });
  });
}

describe('M1.5a / passage borné — cliquets sur les clients prestataires', () => {
  it('M1.5a/passage_borne_tous_les_appels — tout appel réseau d’un client passe par le contrôle d’échéance, sauf les deux qu’aucun passage ne déclenche', () => {
    const appels = appelsReseau();

    expect(
      appels.filter((a) => !a.garde).map((a) => `${a.fichier} | ${a.ligne}`),
    ).toEqual([
      // Healthcheck : un GET sans effet, qui ne lève jamais.
      'mts1/client.ts | const res = await globalThis.fetch(`${this.baseUrl}/v3/carrier`, {',
      // Téléchargement d'une photo : relève entrante, jamais un passage du worker.
      'mts1/client.ts | res = await globalThis.fetch(downloadUrl, {',
    ]);
    expect(
      appels.filter((a) => a.garde).map((a) => `${a.fichier} | ${a.ligne}`),
    ).toEqual([
      'everest/client.ts | const resp = await fetch(`${this.baseUrl}/auth`, {',
      'everest/client.ts | return fetch(`${this.baseUrl}${path}`, {',
      'everest/client.ts | return fetch(`${this.baseUrl}${path}`, {',
      'mts1/client.ts | res = await globalThis.fetch(`${this.baseUrl}${path}`, {',
    ]);
  });

  it('M1.5a/passage_borne_duree_appel — aucun client n’attend la réponse d’un prestataire plus de 30 s (délais lus dans les sources, non mesurés à l’exécution)', () => {
    const delais = sources(RACINE).flatMap((chemin) => {
      const source = readFileSync(chemin, 'utf8');
      return [
        ...source.matchAll(/controller\.abort\(\),\s*([\d_]+)\s*\)/g),
        ...source.matchAll(/AbortSignal\.timeout\(\s*([\d_]+)\s*\)/g),
      ].map((m) => Number(m[1]!.replaceAll('_', '')));
    });

    // 3 délais côté MTS-1 (healthcheck, photo, appels), 3 côté Everest.
    expect(delais).toHaveLength(6);
    expect(Math.max(...delais)).toBe(DUREE_MAX_APPEL_MS);
  });
});
