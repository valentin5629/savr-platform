/**
 * chargerIdentiteSession — organisation et utilisateur affichés en bas de la
 * barre latérale (Val 2026-10-30). Lecture sous le rôle de l'utilisateur,
 * best-effort : toute panne retombe sur l'email.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const lignes: Record<string, unknown> = {};
const filtres: Array<[string, string, unknown]> = [];
let panne = false;

vi.mock('@/lib/api-auth', () => ({
  createSupabaseServerClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: (col: string, val: unknown) => {
          filtres.push([table, col, val]);
          return {
            maybeSingle: () =>
              panne
                ? Promise.reject(new Error('réseau'))
                : Promise.resolve({ data: lignes[table] ?? null, error: null }),
          };
        },
      }),
    }),
  }),
}));

import { chargerIdentiteSession } from './identite-session';

const LOGO = 'savr-dev/logos/0b8e6f5c-2f1a-4c47-9d3e-6a1f2b3c4d5e.png';
const args = { userId: 'u1', email: 'c@viparis.fr', logoAffichable: true };

beforeEach(() => {
  panne = false;
  filtres.length = 0;
  lignes.users = { prenom: 'Camille', nom: 'Martin', organisation_id: 'org1' };
  lignes.organisations = { nom: 'Viparis', logo_url: LOGO };
});

describe('chargerIdentiteSession', () => {
  it('lit SA fiche puis SON organisation : nom, logo versionné, prénom nom', async () => {
    const id = await chargerIdentiteSession(args);
    expect(filtres).toEqual([
      ['users', 'id', 'u1'],
      ['organisations', 'id', 'org1'],
    ]);
    expect(id.organisation).toBe('Viparis');
    expect(id.utilisateur).toBe('Camille Martin');
    expect(id.logoSrc).toMatch(
      /^\/api\/v1\/mon-organisation\/logo\?v=[0-9a-f]{10}$/,
    );
    // La clé R2 n'apparaît pas dans l'URL.
    expect(id.logoSrc).not.toContain('logos/');
  });

  it('sans logo, ou logo non affichable (staff) : logoSrc null', async () => {
    lignes.organisations = { nom: 'Viparis', logo_url: null };
    expect((await chargerIdentiteSession(args)).logoSrc).toBeNull();
    lignes.organisations = { nom: 'Savr', logo_url: LOGO };
    expect(
      (await chargerIdentiteSession({ ...args, logoAffichable: false }))
        .logoSrc,
    ).toBeNull();
  });

  it('poste lu sur SA fiche, rogné ; vide = null (Val 2026-11-01)', async () => {
    lignes.users = {
      prenom: 'Camille',
      nom: 'Martin',
      poste: '  Responsable RSE ',
      organisation_id: 'org1',
    };
    expect((await chargerIdentiteSession(args)).poste).toBe('Responsable RSE');
    lignes.users = { prenom: 'C', nom: 'M', poste: ' ', organisation_id: 'o' };
    expect((await chargerIdentiteSession(args)).poste).toBeNull();
    lignes.users = { prenom: 'C', nom: 'M', organisation_id: 'o' };
    expect((await chargerIdentiteSession(args)).poste).toBeNull();
  });

  it('logoAffichable transmis (faux pour le staff : pas de tuile dans le bandeau)', async () => {
    expect((await chargerIdentiteSession(args)).logoAffichable).toBe(true);
    expect(
      (await chargerIdentiteSession({ ...args, logoAffichable: false }))
        .logoAffichable,
    ).toBe(false);
  });

  it('nom vide : repli sur l’email', async () => {
    lignes.users = { prenom: ' ', nom: '', organisation_id: 'org1' };
    expect((await chargerIdentiteSession(args)).utilisateur).toBe(
      'c@viparis.fr',
    );
  });

  it('fiche illisible ou panne : email seul, jamais d’erreur', async () => {
    lignes.users = null;
    expect(await chargerIdentiteSession(args)).toEqual({
      organisation: null,
      logoSrc: null,
      logoAffichable: true,
      utilisateur: 'c@viparis.fr',
      poste: null,
    });
    panne = true;
    expect((await chargerIdentiteSession(args)).utilisateur).toBe(
      'c@viparis.fr',
    );
  });
});
