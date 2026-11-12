import { describe, it, expect } from 'vitest';
import {
  creerApiPlafonnee,
  PLAFOND_IDS,
  PLAFOND_LIGNES,
} from './api-donnees-plafonnee';

// Le banc des tests de volume doit lui-même amputer et refuser comme l'API de
// données : sinon un test « au-delà du plafond » passerait sans rien prouver.

const lignes = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `l-${String(i).padStart(5, '0')}`,
    rang: i,
  }));

type Client = {
  from: (table: string) => {
    select: (
      colonnes?: string,
      options?: { count?: string },
    ) => {
      in: (colonne: string, valeurs: unknown[]) => PromiseLike<Reponse>;
      order: (colonne: string) => {
        range: (de: number, a: number) => PromiseLike<Reponse>;
        limit: (n: number) => PromiseLike<Reponse>;
      };
    } & PromiseLike<Reponse>;
  };
};
type Reponse = {
  data: { id: string }[] | null;
  error: { message: string } | null;
  count: number | null;
};

/** Requête sur ce que rend une fonction : mêmes maillons qu'une table. */
type RequeteRpc = PromiseLike<{ data: unknown; error: unknown }> & {
  eq: (colonne: string, valeur: unknown) => RequeteRpc;
  select: (colonnes: string) => RequeteRpc;
  order: (colonne: string) => RequeteRpc;
  limit: (n: number) => RequeteRpc;
};
type ClientRpc = {
  rpc: (nom: string, args?: Record<string, unknown>) => RequeteRpc;
};

describe('banc — fausse API de données plafonnée', () => {
  it(`une lecture unique est amputée à ${PLAFOND_LIGNES} lignes, sans erreur`, async () => {
    const api = creerApiPlafonnee({ t: lignes(PLAFOND_LIGNES + 500) });
    const { data, error } = await (api.client as Client).from('t').select('id');
    expect(error).toBeNull();
    expect(data).toHaveLength(PLAFOND_LIGNES);
  });

  it('une plage demandée au-delà du plafond est servie amputée, total exact à part', async () => {
    const api = creerApiPlafonnee({ t: lignes(PLAFOND_LIGNES + 500) });
    const { data, count } = await (api.client as Client)
      .from('t')
      .select('id', { count: 'exact' })
      .order('id')
      .range(200, 200 + 1999);
    expect(data).toHaveLength(PLAFOND_LIGNES);
    expect(data![0]!.id).toBe('l-00200');
    expect(count).toBe(PLAFOND_LIGNES + 500);
  });

  it(`un filtre in de plus de ${PLAFOND_IDS} identifiants fait échouer la lecture`, async () => {
    const api = creerApiPlafonnee({ t: lignes(10) });
    const client = api.client as Client;
    const ids = (n: number) => lignes(n).map((l) => l.id);

    const passe = await client
      .from('t')
      .select('id')
      .in('id', ids(PLAFOND_IDS));
    expect(passe.error).toBeNull();
    expect(passe.data).toHaveLength(10);

    const echoue = await client
      .from('t')
      .select('id')
      .in('id', ids(PLAFOND_IDS + 1));
    expect(echoue.data).toBeNull();
    expect(echoue.error?.message).toMatch(/fetch failed/);
  });

  it('une panne posée sur une table est rendue telle quelle', async () => {
    const api = creerApiPlafonnee({ t: lignes(3) });
    api.pannes['t'] = { message: 'panne', code: 'XX000' };
    const { data, error } = await (api.client as Client).from('t').select('id');
    expect(data).toBeNull();
    expect(error).toEqual({ message: 'panne', code: 'XX000' });
  });

  it('ce que rend une fonction se filtre, se trie et se borne comme une table', async () => {
    const api = creerApiPlafonnee();
    // Rendues dans l'ordre inverse : le tri demandé doit se voir.
    api.rpcs['f_lignes'] = () =>
      lignes(30)
        .map((l) => ({ ...l, pair: l.rang % 2 === 0 }))
        .reverse();

    const { data, error } = await (api.client as ClientRpc)
      .rpc('f_lignes', { p: 1 })
      .eq('pair', true)
      .select('id, rang')
      .order('id')
      .limit(5);

    expect(error).toBeNull();
    expect((data as { id: string }[]).map((l) => l.id)).toEqual([
      'l-00000',
      'l-00002',
      'l-00004',
      'l-00006',
      'l-00008',
    ]);
    expect(api.appelsRpc).toEqual([{ nom: 'f_lignes', args: { p: 1 } }]);
    // La requête est consignée sous le nom de la fonction, maillons compris.
    expect(api.lecturesDe('rpc.f_lignes')).toEqual([
      {
        table: 'rpc.f_lignes',
        colonnes: 'id, rang',
        filtres: [['eq', 'pair', true]],
        tris: ['id'],
        limite: 5,
        plage: null,
        rendues: 5,
      },
    ]);
  });

  it(`une réponse de fonction est amputée à ${PLAFOND_LIGNES} lignes, sans erreur`, async () => {
    const api = creerApiPlafonnee();
    api.rpcs['f_lignes'] = () => lignes(PLAFOND_LIGNES + 500);
    const { data, error } = await (api.client as ClientRpc).rpc('f_lignes');
    expect(error).toBeNull();
    expect(data).toHaveLength(PLAFOND_LIGNES);
  });

  it('une fonction qui rend une valeur seule la rend telle quelle', async () => {
    const api = creerApiPlafonnee();
    api.rpcs['f_nombre'] = () => 7;
    expect(await (api.client as ClientRpc).rpc('f_nombre')).toEqual({
      data: 7,
      error: null,
    });
  });

  it('une panne posée sur une fonction est rendue telle quelle, sans appeler la fonction', async () => {
    const api = creerApiPlafonnee();
    let appelee = false;
    api.rpcs['f_lignes'] = () => {
      appelee = true;
      return lignes(3);
    };
    api.pannes['rpc.f_lignes'] = { message: 'panne', code: 'XX000' };
    expect(
      await (api.client as ClientRpc).rpc('f_lignes').eq('rang', 1).limit(2),
    ).toEqual({ data: null, error: { message: 'panne', code: 'XX000' } });
    expect(appelee).toBe(false);
  });

  it('une fonction que le test ne fournit pas fait échouer l’appel', async () => {
    const api = creerApiPlafonnee();
    await expect(
      Promise.resolve((api.client as ClientRpc).rpc('f_inconnue')),
    ).rejects.toThrow('rpc non prévue par le test : f_inconnue');
  });

  it('des appels de fonction lancés ensemble sont comptés ensemble, des appels à la suite un par un', async () => {
    const ensemble = creerApiPlafonnee();
    ensemble.rpcs['f_nombre'] = () => 1;
    const client = ensemble.client as ClientRpc;
    await Promise.all([
      client.rpc('f_nombre'),
      client.rpc('f_nombre'),
      client.rpc('f_nombre').limit(1),
    ]);
    expect(ensemble.rpcSimultanesMax).toBe(3);

    const aLaSuite = creerApiPlafonnee();
    aLaSuite.rpcs['f_nombre'] = () => 1;
    await (aLaSuite.client as ClientRpc).rpc('f_nombre');
    await (aLaSuite.client as ClientRpc).rpc('f_nombre');
    expect(aLaSuite.rpcSimultanesMax).toBe(1);
  });
});
