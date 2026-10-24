/**
 * M1.2 / §06.02 §3 — email_recap_bonjour_prenom (couche envoi).
 * Demande Val 2026-10-08 : l'email récapitulatif de programmation s'adresse au
 * programmeur par son prénom. Vérifie que `envoyerRecapProgrammation` lit le
 * prénom en base et le transmet au template, puis rend le corps du gabarit
 * (migration 20261024100000, lot B2) avec ces variables (le modèle et
 * l'appelant, bout à bout).
 * M1.2 / email_recap_une_ligne_par_collecte : une ligne par collecte annoncée
 * (décision Val 2026-10-24, B2-Q3).
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
type LigneCollecte = {
  id: string;
  type: string;
  date_collecte: string;
  heure_collecte: string | null;
  pax: number | null;
  created_at: string | null;
};

const AG = {
  id: 'col-ag',
  type: 'anti_gaspi',
  date_collecte: '2030-01-15',
  heure_collecte: '22:00:00',
  pax: 80,
  created_at: '2030-01-01T10:00:00Z',
};

// Supabase minimal : users(id) → la ligne fixée ; collectes(evenement_id) →
// les collectes de l'événement. `colonnesLues` garde le SELECT de `users`,
// pour vérifier que le prénom est bien lu en base.
function makeSupabase(ligne: LigneUser, collectes: LigneCollecte[] = [AG]) {
  const colonnesLues: string[] = [];
  const supabase = {
    from: (table: string) => ({
      select: (colonnes: string) => {
        if (table === 'users') colonnesLues.push(colonnes);
        return {
          eq: () =>
            table === 'users'
              ? { maybeSingle: async () => ({ data: ligne, error: null }) }
              : Promise.resolve({ data: collectes, error: null }),
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
  organisationId: 'org-1',
  lieuId: 'lieu-1',
  collecteIds: ['col-ag'],
};

const CORPS = (() => {
  const sql = readFileSync(
    fileURLToPath(
      new URL(
        '../../../../../supabase/migrations/20261024100000_plateforme_programmation_collectes_par_carte.sql',
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
    // L'écran de confirmation relit l'envoi par ce template et cette entité
    // (suivi-recap-email.ts) : s'ils changent ici, l'écran dirait « non envoyé »
    // d'un email parti. Valeurs écrites en toutes lettres, pas reprises du code.
    expect(email.options).toEqual({
      entityType: 'evenement',
      entityId: 'evt-1',
    });
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

describe('M1.2/email_recap_une_ligne_par_collecte — envoyerRecapProgrammation (décision Val 2026-10-24, B2-Q3)', () => {
  let emails: CapturedEmail[] = [];
  beforeEach(() => {
    emails = [];
    setEmailCaptureSink((e) => emails.push(e));
  });
  afterEach(() => setEmailCaptureSink(null));

  const ZD1 = {
    id: 'col-zd1',
    type: 'zero_dechet',
    date_collecte: '2030-11-12',
    heure_collecte: '19:00:00',
    pax: 120,
    created_at: '2030-01-01T10:00:00Z',
  };
  const ZD2 = { ...ZD1, id: 'col-zd2', date_collecte: '2030-11-13', pax: 80 };
  const AG1 = {
    ...ZD1,
    id: 'col-ag1',
    type: 'anti_gaspi',
    heure_collecte: '22:00:00',
    pax: 1,
  };

  it('une puce par collecte, numérotée par type, avec date longue, heure et convives', async () => {
    const { supabase } = makeSupabase(
      { email: 'julie@traiteur.local', prenom: 'Julie' },
      // Ordre de la base quelconque : l'email range Zéro Déchet puis Anti-Gaspi,
      // par date.
      [AG1, ZD2, ZD1],
    );
    await envoyerRecapProgrammation(supabase, {
      ...PARAMS,
      collecteIds: ['col-zd1', 'col-zd2', 'col-ag1'],
      lienCollectes: 'https://app.test/traiteur/collectes',
    });

    expect(emails).toHaveLength(1);
    const v = emails[0]!.variables;
    expect(v.nombre_collectes).toBe('3 collectes');
    expect(v.liste_collectes).toBe(
      '<ul><li>Collecte Zéro Déchet #1 — mardi 12 novembre 2030 à 19:00 — 120 convives</li>' +
        '<li>Collecte Zéro Déchet #2 — mercredi 13 novembre 2030 à 19:00 — 80 convives</li>' +
        '<li>Collecte Anti-Gaspi #1 — mardi 12 novembre 2030 à 22:00 — 1 convive</li></ul>',
    );
    const html = interpolate(CORPS, v);
    expect(html).toContain(
      '<p>Votre événement « Gala » est programmé. Nous réaliserons 3 collectes :</p>',
    );
    expect(html).toContain(
      '<a href="https://app.test/traiteur/collectes">Voir mes collectes</a>',
    );
  });

  it('collecte ajoutée : seule la collecte annoncée est listée, avec son numéro dans l’événement ; sans lien, aucun bouton', async () => {
    const { supabase } = makeSupabase(
      { email: 'julie@traiteur.local', prenom: 'Julie' },
      [ZD1, ZD2],
    );
    await envoyerRecapProgrammation(supabase, {
      ...PARAMS,
      collecteIds: ['col-zd2'],
    });

    const v = emails[0]!.variables;
    expect(v.nombre_collectes).toBe('1 collecte');
    expect(v.liste_collectes).toBe(
      '<ul><li>Collecte Zéro Déchet #2 — mercredi 13 novembre 2030 à 19:00 — 80 convives</li></ul>',
    );
    expect(interpolate(CORPS, v)).not.toContain('Voir mes collectes');
  });

  it('aucune collecte annoncée retrouvée : aucun email', async () => {
    const { supabase } = makeSupabase(
      { email: 'julie@traiteur.local', prenom: 'Julie' },
      [ZD1],
    );
    await envoyerRecapProgrammation(supabase, {
      ...PARAMS,
      collecteIds: ['inconnue'],
    });
    expect(emails).toEqual([]);
  });
});
