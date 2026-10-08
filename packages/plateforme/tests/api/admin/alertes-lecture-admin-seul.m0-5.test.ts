/**
 * M0.5 — GET /api/v1/admin/alertes : le contenu des alertes n'est servi qu'à
 * admin_savr.
 *
 * Depuis le lot « emails en échec définitif » (décision Val 2026-10-08), le
 * message de l'alerte `email_echec_definitif` cite l'adresse email du
 * destinataire. Cette route est le seul endroit du code qui sélectionne
 * `message` ; elle lit par le service role, donc hors policy RLS : ce qui
 * empêche ops_savr et les rôles clients de recevoir ce contenu, c'est sa garde
 * `requireAdmin`. (La page Alertes elle-même s'ouvre pour tout le staff — le
 * layout du back-office n'exige que le staff et la page n'a pas de garde de
 * rôle : pour ops_savr elle reste sans données, la liste lui étant refusée.)
 *
 * Le fichier voisin `alertes.test.ts` simule cette garde. Ici la VRAIE garde
 * est exercée, rôle par rôle, à partir d'un JWT : servir la liste à un autre
 * rôle fait rougir ces cas, qui nomment ce qui fuirait.
 * (La lecture directe de la table, elle, est tenue par le pgTAP
 * `SECU__alertes_admin_message_admin_seul.test.sql`.)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const ADRESSE = 'contact@traiteur-secu.test';
const ALERTE = {
  id: 'a-1',
  code: 'email_echec_definitif',
  titre: 'Email non remis',
  message: `L’email « collecte_programmee » destiné à ${ADRESSE} n’a pas pu être envoyé après 4 tentatives.`,
  entity_type: 'emails_envoyes',
  entity_id: 'em-1',
  statut: 'ouverte',
  created_at: '2026-10-08T08:00:00.000Z',
  resolue_at: null,
};

// Lectures faites par la route sur la base (aucune ne doit avoir lieu quand la
// garde refuse).
const lectures: string[] = [];

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => ({
    from: (table: string) => {
      lectures.push(table);
      const requete = {
        select: () => requete,
        order: () => requete,
        eq: () => requete,
        then: (siOk: (r: { data: unknown; error: null }) => unknown) =>
          Promise.resolve({ data: [ALERTE], error: null }).then(siOk),
      };
      return requete;
    },
  }),
}));

function makeJwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
}

const mockGetUser = vi.fn();
const mockGetSession = vi.fn();
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
  }),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: () => {} }),
}));

function connecter(role: string | null): void {
  mockGetUser.mockResolvedValue({
    data: { user: role ? { id: 'user-1' } : null },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: {
      session: role ? { access_token: makeJwt({ user_role: role }) } : null,
    },
    error: null,
  });
}

async function lireAlertes(): Promise<Response> {
  const { GET } = await import('@/app/api/v1/admin/alertes/route.js');
  return GET(new NextRequest('http://localhost/api/v1/admin/alertes'));
}

describe('M0.5 — GET admin/alertes : contenu servi à admin_savr seul', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lectures.length = 0;
  });

  it('admin_savr → 200, l’alerte et son message (adresse du destinataire comprise)', async () => {
    connecter('admin_savr');

    const res = await lireAlertes();

    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).toContain(ADRESSE);
    expect(lectures).toEqual(['alertes_admin']);
  });

  it.each([
    'ops_savr',
    'traiteur_manager',
    'traiteur_commercial',
    'agence',
    'gestionnaire_lieux',
    'client_organisateur',
  ])(
    '%s → 403 : aucune alerte lue, l’adresse du destinataire ne sort pas',
    async (role) => {
      connecter(role);

      const res = await lireAlertes();

      expect(res.status).toBe(403);
      expect(JSON.stringify(await res.json())).not.toContain(ADRESSE);
      expect(lectures).toEqual([]);
    },
  );

  it('non connecté → 401, aucune alerte lue', async () => {
    connecter(null);

    const res = await lireAlertes();

    expect(res.status).toBe(401);
    expect(lectures).toEqual([]);
  });
});
