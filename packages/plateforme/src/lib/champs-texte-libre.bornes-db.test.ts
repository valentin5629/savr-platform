/**
 * Cliquet anti-drift entre la borne APPLICATIVE (`BORNES_TEXTE_LIBRE`) et la borne
 * en BASE (CHECK de la migration 20260915180000).
 *
 * #312 avait refusé de recopier des longueurs en SQL au motif que « les recopier
 * garantirait le drift entre des nombres SQL et des nombres TS ». L'objection est
 * juste tant que rien ne relie les deux jeux de nombres : ce fichier les relie. Si
 * la borne bouge d'un côté seulement, la CI rougit ici — et non en production, où
 * la conséquence serait un 500 (la contrainte refuse ce que la route a laissé
 * passer) ou une borne applicative devenue décorative (la contrainte est plus
 * large qu'elle).
 *
 * Il lit le fichier de migration plutôt que la base : le cliquet doit tenir dans
 * un job CI sans Postgres. La vérification du comportement RÉEL des contraintes,
 * elle, est en pgTAP (`supabase/tests/bornes_texte_libre.test.sql`).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  BORNES_TEXTE_LIBRE,
  type ChampTexteLibre,
} from './champs-texte-libre.js';

const MIGRATION = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../supabase/migrations',
  '20260915180000_plateforme_bornes_texte_libre_contact_secours_infos_suppl.sql',
);

/**
 * Contrainte portant chaque champ. Ajouter une borne à `BORNES_TEXTE_LIBRE` sans
 * la contrainte correspondante fait rougir le premier test ci-dessous : une borne
 * applicative seule est contournable en PostgREST direct (#308).
 */
const CONTRAINTES: Record<ChampTexteLibre, string> = {
  contact_secours_nom: 'chk_evenements_contact_secours_nom_borne',
  contact_secours_telephone: 'chk_evenements_contact_secours_telephone_borne',
  informations_supplementaires:
    'chk_collectes_informations_supplementaires_borne',
};

const sql = readFileSync(MIGRATION, 'utf8');

/** Le corps du CHECK, hors en-tête de commentaires (`--` en début de ligne). */
const sqlActif = sql
  .split('\n')
  .filter((ligne) => !ligne.trimStart().startsWith('--'))
  .join('\n');

describe('bornes texte libre — parité TS / CHECK en base', () => {
  it('chaque champ borné en TS a une contrainte en base', () => {
    expect(Object.keys(BORNES_TEXTE_LIBRE).sort()).toEqual(
      Object.keys(CONTRAINTES).sort(),
    );
    for (const contrainte of Object.values(CONTRAINTES)) {
      expect(sqlActif).toContain(`ADD CONSTRAINT ${contrainte}`);
    }
  });

  it('la longueur maximale est la MÊME des deux côtés', () => {
    for (const [champ, borne] of Object.entries(BORNES_TEXTE_LIBRE)) {
      const motif = new RegExp(`length\\(${champ}\\)\\s*<=\\s*(\\d+)`);
      const trouve = motif.exec(sqlActif);
      expect(
        trouve,
        `aucun \`length(${champ}) <= …\` dans la migration`,
      ).not.toBeNull();
      expect(Number(trouve?.[1]), `borne SQL de ${champ}`).toBe(borne.max);
    }
  });

  it('chaque champ refuse les caractères de contrôle, les blancs exceptés pour le seul champ multiligne', () => {
    for (const [champ, borne] of Object.entries(BORNES_TEXTE_LIBRE)) {
      // Une seule clause par champ : on isole le bloc CHECK qui le concerne.
      const bloc = sqlActif.slice(sqlActif.indexOf(`length(${champ})`));
      const finBloc = bloc.indexOf('EXCEPTION WHEN duplicate_object');
      const clause = bloc.slice(0, finBloc === -1 ? undefined : finBloc);

      expect(clause).toContain('[[:cntrl:]]');
      // `translate(..., chr(9) || chr(10) || chr(13), '')` retire tabulation et
      // sauts de ligne avant le test — l'exception `<textarea>`, et elle seule.
      expect(
        clause.includes('translate('),
        `exception blancs sur ${champ}`,
      ).toBe(borne.multiligne);
    }
  });
});
