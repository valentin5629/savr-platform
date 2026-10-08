/**
 * M1.2 / §06.02 §3 — email_recap_bonjour_prenom (couche envoi).
 * Demande Val 2026-10-08 : l'email récapitulatif de programmation s'adresse au
 * programmeur par son prénom. Vérifie que `envoyerRecapProgrammation` lit le
 * prénom en base et le transmet au template, puis rend le corps de la migration
 * 20261008150000 avec ces variables (le modèle et l'appelant, bout à bout).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  interpolate,
  setEmailCaptureSink,
  type CapturedEmail,
} from '@savr/shared/src/email/index.js';
import { envoyerRecapProgrammation } from './recap-email.js';

type LigneUser = { email?: string; prenom?: string | null } | null;

// Supabase minimal : users(id) → la ligne fixée. `colonnesLues` garde le SELECT
// demandé, pour vérifier que le prénom est bien lu en base.
function makeSupabase(ligne: LigneUser) {
  const colonnesLues: string[] = [];
  const supabase = {
    from: () => ({
      select: (colonnes: string) => {
        colonnesLues.push(colonnes);
        return {
          eq: () => ({
            maybeSingle: async () => ({ data: ligne, error: null }),
          }),
        };
      },
    }),
  } as unknown as Parameters<typeof envoyerRecapProgrammation>[0];
  return { supabase, colonnesLues };
}

// Collecte AG seule : pas de calcul de tarif ZD, le test ne porte que sur l'appel.
const PARAMS = {
  programmeurUserId: 'user-1',
  evenementId: 'evt-1',
  nomEvenement: 'Gala',
  pax: 80,
  organisationId: 'org-1',
  lieuId: 'lieu-1',
  collectes: [{ type: 'ag', date_collecte: '2030-01-15' }],
};

const CORPS = (() => {
  const sql = readFileSync(
    fileURLToPath(
      new URL(
        '../../../../../supabase/migrations/20261008150000_plateforme_email_recap_programmation_prenom.sql',
        import.meta.url,
      ),
    ),
    'utf8',
  );
  const m = sql.match(/\$tpl\$([\s\S]*?)\$tpl\$/);
  if (!m) throw new Error('corps du template introuvable dans la migration');
  return m[1]!;
})();

describe('M1.2/email_recap_bonjour_prenom — envoyerRecapProgrammation', () => {
  let emails: CapturedEmail[] = [];
  beforeEach(() => {
    emails = [];
    setEmailCaptureSink((e) => emails.push(e));
  });
  afterEach(() => setEmailCaptureSink(null));

  it('lit le prénom du programmeur et l’email s’ouvre par « Bonjour Julie, »', async () => {
    const { supabase, colonnesLues } = makeSupabase({
      email: 'julie@traiteur.local',
      prenom: 'Julie',
    });
    await envoyerRecapProgrammation(supabase, PARAMS);

    expect(colonnesLues).toEqual(['email, prenom']);
    expect(emails).toHaveLength(1);
    const email = emails[0]!;
    expect(email.slug).toBe('collecte_programmee');
    expect(email.to).toBe('julie@traiteur.local');
    expect(email.variables.prenom).toBe('Julie');
    expect(
      interpolate(CORPS, email.variables).startsWith('<p>Bonjour Julie,</p>'),
    ).toBe(true);
  });

  it('rogne les espaces autour du prénom', async () => {
    const { supabase } = makeSupabase({
      email: 'julie@traiteur.local',
      prenom: '  Julie ',
    });
    await envoyerRecapProgrammation(supabase, PARAMS);
    expect(emails[0]!.variables.prenom).toBe('Julie');
  });

  it.each([
    ['vide', ''],
    ['fait d’espaces', '   '],
    ['nul', null],
    ['absent', undefined],
  ])(
    'prénom %s : l’email part quand même, ouvert par « Bonjour, »',
    async (_cas, prenom) => {
      const { supabase } = makeSupabase({
        email: 'julie@traiteur.local',
        ...(prenom === undefined ? {} : { prenom }),
      });
      await envoyerRecapProgrammation(supabase, PARAMS);

      expect(emails).toHaveLength(1);
      expect(emails[0]!.variables.prenom).toBe('');
      const html = interpolate(CORPS, emails[0]!.variables);
      expect(html.startsWith('<p>Bonjour,</p>')).toBe(true);
      expect(html).not.toContain('Bonjour ,');
    },
  );
});
