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
});
