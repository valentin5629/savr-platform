/**
 * M0.5 — adresse de contact Savr (décision Val 2026-10-08).
 *
 * `contact@gosavr.io` remplace l'ancienne adresse partout : messages lus par les
 * utilisateurs (connexion, inscription) et boîte qui reçoit les notifications de
 * l'équipe Savr (demandes d'annulation, de renouvellement de pack, d'ajout de
 * lieu, incidents, modifications, alertes pack).
 *
 * Ce fichier verrouille un PÉRIMÈTRE, pas un comportement : l'ancienne adresse
 * n'apparaît plus dans aucun fichier des dossiers scannés (RACINES), commentaires
 * et tests compris. Le destinataire de chaque notification est vérifié par les
 * tests de ses appelants.
 *
 * Ce qu'il ne voit pas : `specs/` (le CDC dérivé cite encore l'ancienne adresse
 * tant que le Vault n'est pas patché), une adresse assemblée par concaténation,
 * et la configuration hors dépôt (variables d'environnement, console Resend).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const DEPOT = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const RACINES = ['packages', 'apps', 'supabase', 'scripts'];
const IGNORES = new Set([
  'node_modules',
  '.next',
  '.turbo',
  'dist',
  'coverage',
]);
const EXTENSIONS = /\.(?:[cm]?[jt]sx?|sql|html|json|md|sh|ya?ml|toml)$/;

// Assemblées ici pour que ce fichier ne se signale pas lui-même.
const ANCIENNE = ['hello', 'gosavr.io'].join('@');
const ACTUELLE = ['contact', 'gosavr.io'].join('@');

function fichiers(dossier: string): string[] {
  const trouves: string[] = [];
  for (const nom of readdirSync(dossier)) {
    if (IGNORES.has(nom)) continue;
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) trouves.push(...fichiers(chemin));
    else if (EXTENSIONS.test(nom)) trouves.push(chemin);
  }
  return trouves;
}

const CONTENUS = RACINES.flatMap((racine) => fichiers(join(DEPOT, racine))).map(
  (chemin) => ({
    chemin: relative(DEPOT, chemin),
    texte: readFileSync(chemin, 'utf8'),
  }),
);

const citant = (adresse: string): string[] =>
  CONTENUS.filter(({ texte }) => texte.includes(adresse)).map(
    ({ chemin }) => chemin,
  );

describe('M0.5/adresse_contact_savr — une seule adresse de contact', () => {
  it('l’ancienne adresse n’apparaît plus dans le code, les tests ni les migrations', () => {
    expect(citant(ANCIENNE)).toEqual([]);
  });

  it('le balayage lit bien les fichiers : la nouvelle adresse est trouvée chez ses appelants', () => {
    const fichiersCitant = citant(ACTUELLE);
    expect(fichiersCitant).toContain(
      'packages/plateforme/src/lib/packs/notify-pack-etat.ts',
    );
    expect(fichiersCitant).toContain(
      'packages/plateforme/src/app/login/page.tsx',
    );
    expect(fichiersCitant.length).toBeGreaterThanOrEqual(10);
  });
});
