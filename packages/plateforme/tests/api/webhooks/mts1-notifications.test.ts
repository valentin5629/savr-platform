// Notifications entrantes MTS-1 — étape 1 : enregistrement seul.
//
// Ce qui est prouvé : la route refuse tout sans jeton configuré ou avec un
// mauvais jeton, sans rien écrire ; avec le bon jeton elle enregistre la
// notification dans `integrations_inbox` et ne touche à AUCUNE autre table
// (aucun effet sur les collectes ni les tournées).

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const insertions: Array<{ table: string; ligne: Record<string, unknown> }> = [];
let reponseInsertion: { error: { code?: string; message: string } | null } = {
  error: null,
};
const tablesLues: string[] = [];

vi.mock('@savr/shared/src/supabase-client.js', () => ({
  createAdminSupabaseClient: () => ({
    from: (table: string) => {
      tablesLues.push(table);
      return {
        insert: async (ligne: Record<string, unknown>) => {
          insertions.push({ table, ligne });
          return reponseInsertion;
        },
      };
    },
  }),
}));

const JETON = 'jeton-de-test-0123456789';

/** Raisons des refus écrits au journal (`webhook.signature_invalid`). */
function refusJournalises(): string[] {
  return vi
    .mocked(console.log)
    .mock.calls.map((c) => String(c[0]))
    .filter((l) => l.includes('webhook.signature_invalid'))
    .map((l) => /"raison":"([a-z_]+)"/.exec(l)?.[1] ?? '?');
}
const TOUR_UPDATE = ['v3', 'webhook', 'tour', 'update'];

function requete(
  corps: string,
  enTetes: Record<string, string> = { 'x-mts1-webhook-token': JETON },
): NextRequest {
  return new NextRequest(
    'http://localhost/api/webhooks/mts1/v3/webhook/tour/update',
    {
      method: 'POST',
      body: corps,
      headers: { 'content-type': 'application/json', ...enTetes },
    },
  );
}

async function appelerSur(
  req: NextRequest,
  chemin: string[] | undefined,
): Promise<Response> {
  const { POST } =
    await import('@/app/api/webhooks/mts1/[[...chemin]]/route.js');
  return POST(req, { params: Promise.resolve({ chemin }) });
}

const appeler = (req: NextRequest) => appelerSur(req, TOUR_UPDATE);

describe('Notifications MTS-1 — enregistrement seul', () => {
  beforeEach(() => {
    insertions.length = 0;
    tablesLues.length = 0;
    reponseInsertion = { error: null };
    vi.stubEnv('MTS1_WEBHOOK_TOKEN', JETON);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('M1.5b/notifications_mts1_non_configurees — sans jeton configuré, la route refuse tout (503) et n’écrit rien', async () => {
    vi.stubEnv('MTS1_WEBHOOK_TOKEN', '');

    const res = await appeler(requete('{"tourId":"T-1"}'));

    expect(res.status).toBe(503);
    expect(tablesLues).toEqual([]);
    expect(refusJournalises()).toEqual(['jeton_non_configure']);
  });

  it('M1.5b/notifications_mts1_jeton_refuse — jeton absent, faux, ou de même longueur mais différent : 401, rien n’est écrit', async () => {
    const faux: Record<string, string>[] = [
      {},
      { 'x-mts1-webhook-token': 'autre' },
      { 'x-mts1-webhook-token': JETON.replace('9', '8') },
      { authorization: `Bearer ${JETON}x` },
      { 'x-mts1-webhook-token': '' },
    ];
    for (const enTetes of faux) {
      const res = await appeler(requete('{"tourId":"T-1"}', enTetes));
      expect(res.status).toBe(401);
    }

    expect(tablesLues).toEqual([]);
    // Chaque refus laisse une trace, sans le jeton reçu ni le jeton attendu.
    expect(refusJournalises()).toEqual(faux.map(() => 'jeton_invalide'));
    const journal = vi.mocked(console.log).mock.calls.map((c) => String(c[0]));
    expect(journal.join('\n')).not.toContain(JETON);
    expect(journal.join('\n')).not.toContain('autre');
  });

  it('jeton posé dans l’hébergeur avec un saut de ligne : MTS-1 est quand même accepté', async () => {
    vi.stubEnv('MTS1_WEBHOOK_TOKEN', `${JETON}\n`);

    const res = await appeler(requete('{"tourId":"T-1"}'));

    expect(res.status).toBe(200);
    expect(refusJournalises()).toEqual([]);
  });

  it('M1.5b/notifications_mts1_enregistree — bon jeton : la notification est enregistrée telle quelle, sous son type et son empreinte', async () => {
    const corps = '{"tourId":"T-1","eventType":"UPDATED"}';

    const res = await appeler(requete(corps));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(insertions).toHaveLength(1);
    expect(insertions[0]!.table).toBe('integrations_inbox');
    expect(insertions[0]!.ligne).toMatchObject({
      source: 'mts1_notification',
      event_type: 'tour/update',
      event_id_externe: createHash('sha256')
        .update(`v3/webhook/tour/update\n${corps}`)
        .digest('hex'),
      payload: {
        chemin: 'v3/webhook/tour/update',
        corps: { tourId: 'T-1', eventType: 'UPDATED' },
      },
      traite: true,
    });
  });

  it('M1.5b/notifications_mts1_sans_effet_metier — seule la table de réception est touchée', async () => {
    await appeler(requete('{"tourId":"T-1"}'));

    expect(tablesLues).toEqual(['integrations_inbox']);
  });

  it('le jeton est aussi accepté dans Authorization, avec ou sans préfixe Bearer', async () => {
    const avec = await appeler(
      requete('{"a":1}', { authorization: `Bearer ${JETON}` }),
    );
    const sans = await appeler(requete('{"a":2}', { authorization: JETON }));

    expect(avec.status).toBe(200);
    expect(sans.status).toBe(200);
    expect(insertions).toHaveLength(2);
  });

  it('le jeton n’est jamais lu dans l’URL', async () => {
    const req = new NextRequest(
      `http://localhost/api/webhooks/mts1/v3/webhook/tour/update?token=${JETON}`,
      { method: 'POST', body: '{}' },
    );

    const res = await appeler(req);

    expect(res.status).toBe(401);
    expect(tablesLues).toEqual([]);
  });

  it('M1.5b/notifications_mts1_rejeu — même chemin et même contenu déjà enregistrés : 200, signalé comme doublon', async () => {
    reponseInsertion = {
      error: { code: '23505', message: 'duplicate key value' },
    };

    const res = await appeler(requete('{"tourId":"T-1"}'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, doublon: true });
  });

  it('enregistrement refusé par la base : 500 sans détail, pour que MTS-1 garde la notification en échec', async () => {
    reponseInsertion = {
      error: { code: '42501', message: 'permission denied for table x' },
    };

    const res = await appeler(requete('{"tourId":"T-1"}'));

    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('permission');
  });

  it('corps qui n’est pas du JSON : enregistré brut, tronqué à 2 000 caractères', async () => {
    const res = await appeler(requete(`pas du json ${'x'.repeat(3_000)}`));

    expect(res.status).toBe(200);
    const corps = (
      insertions[0]!.ligne['payload'] as { corps: { brut: string } }
    ).corps;
    expect(corps.brut.startsWith('pas du json x')).toBe(true);
    expect(corps.brut).toHaveLength(2_000);
  });

  it('M1.5b/notifications_mts1_taille — au-delà de 256 Ko : 413, rien n’est écrit ; 256 Ko juste : enregistré', async () => {
    const res = await appeler(requete('x'.repeat(256 * 1024 + 1)));

    expect(res.status).toBe(413);
    expect(tablesLues).toEqual([]);

    const limite = await appeler(requete('x'.repeat(256 * 1024)));
    expect(limite.status).toBe(200);
  });

  it.each([
    [['v3', 'webhook', 'stop', 'progress'], 'stop/progress'],
    [['v3', 'webhook', 'customerOrder', 'update'], 'customerOrder/update'],
    [['tour', 'progress'], 'tour/progress'],
    [undefined, 'inconnu'],
    [[], 'inconnu'],
    [['v3', 'webhook'], 'inconnu'],
    [['tour', 'update; drop'], 'inconnu'],
    [['a', 'b', 'c', 'd'], 'inconnu'],
    [['tour', 'x'.repeat(32)], `tour/${'x'.repeat(32)}`],
    [['tour', 'x'.repeat(33)], 'inconnu'],
  ])('type lu dans le chemin %j → %s', async (chemin, type) => {
    await appelerSur(requete('{}'), chemin as string[] | undefined);

    expect(insertions[0]!.ligne['event_type']).toBe(type);
  });

  it('le journal ne porte ni le contenu ni un identifiant de la notification', async () => {
    const journal = vi.mocked(console.log);

    await appeler(requete('{"tourId":"T-SECRET-42"}'));

    const lignes = journal.mock.calls.map((c) => String(c[0]));
    const trace = lignes.find((l) =>
      l.includes('mts1.notification.enregistree'),
    );
    expect(trace).toBeDefined();
    expect(trace).toContain('tour/update');
    expect(lignes.join('\n')).not.toContain('T-SECRET-42');
  });
});

// ── Cliquet de structure : l'étape 1 n'a pas d'effet métier ──────────────────

describe('Notifications MTS-1 — la route d’enregistrement ne sait rien faire d’autre', () => {
  const source = readFileSync(
    path.resolve(
      __dirname,
      '../../../src/app/api/webhooks/mts1/[[...chemin]]/route.ts',
    ),
    'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('M1.5b/notifications_mts1_structure — ni adapter, ni appel sortant, ni fonction SQL, ni autre écriture que l’insertion en table de réception', () => {
    expect(source).not.toMatch(/@savr\/adapters/);
    expect(source).not.toMatch(/\bfetch\(/);
    expect(source).not.toMatch(/\.rpc\(/);
    // Une seule lecture de table, et c'est une insertion (le `.update(` du
    // calcul d'empreinte n'est pas une écriture en base).
    expect(source).not.toMatch(/\.(upsert|delete)\(/);
    expect(source.match(/\.from\(\s*'/g)).toHaveLength(1);
    expect(source).toContain(".from('integrations_inbox').insert(");
  });
});
