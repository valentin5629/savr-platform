// Libellé d'un appel sortant qui n'a pas abouti : rien de ce que le moteur
// recopie dans son erreur (valeur d'en-tête, adresse) n'en sort.
//
// Deux familles de preuves :
//   1. LE VRAI MOTEUR — `fetch` est appelé pour de bon, avec une fausse clé mal
//      formée. Aucun échange réseau : l'en-tête et l'adresse sont refusés avant
//      toute connexion, et le port 9 est de ceux que `fetch` refuse d'appeler.
//      C'est la mesure du comportement sous la version de Node qui joue le test
//      (Node 20 en CI).
//   2. DES ERREURS FABRIQUÉES — la fausse clé posée dans chaque champ de
//      l'erreur : la preuve ne dépend plus de ce qu'écrit telle version du moteur.

import { describe, expect, it } from 'vitest';

import { decrireErreurReseau, libelleErreurReseau } from './erreur-reseau.js';

// Jamais une vraie clé : une chaîne reconnaissable, coupée en deux par le
// caractère interdit, dont AUCUNE moitié ne doit ressortir.
const DEBUT = 'FAUSSE-CLE-DE-TEST';
const FIN = 'SUITE-DE-LA-FAUSSE-CLE';
const ADRESSE_MORTE = 'http://127.0.0.1:9/sonde';

async function rejetDe(appel: () => Promise<unknown>): Promise<unknown> {
  try {
    await appel();
  } catch (err) {
    return err;
  }
  throw new Error("l'appel aurait dû échouer");
}

function sansLaCle(texte: string): void {
  expect(texte).not.toContain(DEBUT);
  expect(texte).not.toContain(FIN);
}

describe('M0.9/erreur_reseau_vrai_moteur — ce que rend le vrai `fetch` ne sort jamais du libellé', () => {
  it.each([
    ['un saut de ligne', '\n'],
    ['un retour chariot', '\r'],
    ['un caractère NUL', '\0'],
  ])(
    'clé portant %s en son milieu : libellé « en-tête refusé », sans la clé',
    async (_nom, interdit) => {
      const err = await rejetDe(() =>
        fetch(ADRESSE_MORTE, {
          headers: { Authorization: `Bearer ${DEBUT}${interdit}${FIN}` },
        }),
      );

      // Mesure, lisible dans le journal du run : le moteur de CETTE version de
      // Node recopie-t-il la valeur refusée dans son message ? (vrai sous
      // Node 22.23.2 et 25.9.0, mesuré le 2026-10-13.)
      console.info(
        `[mesure erreur-reseau] node=${process.version} undici=${process.versions['undici']} valeur citée par le moteur=${String(err).includes(DEBUT)}`,
      );

      const decrite = decrireErreurReseau(err);
      expect(decrite.categorie).toBe('entete_invalide');
      expect(decrite.libelle).toBe(
        'en-tête de requête refusé (clé ou jeton mal formé)',
      );
      sansLaCle(decrite.libelle);
    },
  );

  it("en-tête maison (secret d'un service interne) : même libellé, sans le secret", async () => {
    const err = await rejetDe(() =>
      fetch(ADRESSE_MORTE, {
        headers: { 'X-Internal-Token': `${DEBUT}\n${FIN}` },
      }),
    );
    expect(decrireErreurReseau(err).categorie).toBe('entete_invalide');
    sansLaCle(libelleErreurReseau(err));
  });

  it('caractère hors de la plage autorisée dans la clé : « en-tête refusé », sans la clé', async () => {
    const err = await rejetDe(() =>
      fetch(ADRESSE_MORTE, {
        headers: { Authorization: `Bearer ${DEBUT}€${FIN}` },
      }),
    );
    expect(decrireErreurReseau(err).categorie).toBe('entete_invalide');
    sansLaCle(libelleErreurReseau(err));
  });

  it('adresse illisible portant un jeton : « adresse illisible », sans l’adresse', async () => {
    const err = await rejetDe(() =>
      fetch(`http://hote illisible.invalid/hook?jeton=${DEBUT}${FIN}`),
    );
    const decrite = decrireErreurReseau(err);
    expect(decrite.categorie).toBe('adresse_invalide');
    sansLaCle(decrite.libelle);
    expect(decrite.libelle).not.toContain('illisible.invalid');
  });

  it('adresse de base absente (chemin seul) : « adresse illisible »', async () => {
    const err = await rejetDe(() => fetch('/v3/carrier'));
    expect(decrireErreurReseau(err)).toEqual({
      categorie: 'adresse_invalide',
      libelle: "adresse d'appel illisible (URL de base absente ou mal formée)",
    });
  });

  it('appel abandonné par un minuteur (`AbortController`) : « délai dépassé »', async () => {
    const minuteur = new AbortController();
    minuteur.abort();
    const err = await rejetDe(() =>
      fetch(ADRESSE_MORTE, { signal: minuteur.signal }),
    );
    expect(decrireErreurReseau(err)).toEqual({
      categorie: 'delai_depasse',
      libelle: 'délai dépassé',
    });
  });

  it('appel abandonné par `AbortSignal.timeout` : « délai dépassé »', async () => {
    const err = await rejetDe(() =>
      fetch(ADRESSE_MORTE, {
        signal: AbortSignal.abort(new DOMException('délai', 'TimeoutError')),
      }),
    );
    expect(decrireErreurReseau(err).categorie).toBe('delai_depasse');
  });

  it('transport en échec : « service injoignable »', async () => {
    const err = await rejetDe(() => fetch(ADRESSE_MORTE));
    const decrite = decrireErreurReseau(err);
    expect(decrite.categorie).toBe('reseau');
    expect(decrite.libelle).toMatch(/^service injoignable( \([A-Z0-9_]+\))?$/);
  });
});

describe('M0.9/erreur_reseau_champs — la fausse clé posée dans chaque champ de l’erreur ne ressort d’aucun', () => {
  const CLE = `${DEBUT}${FIN}`;

  it('dans le message, quelle que soit sa tournure', () => {
    for (const message of [
      `Headers.append: "Bearer ${CLE}" is an invalid header value.`,
      `Invalid value "Bearer ${CLE}" for header "Authorization"`,
      `Failed to parse URL from https://hote.invalid/?jeton=${CLE}`,
      `fetch failed ${CLE}`,
      CLE,
    ]) {
      sansLaCle(libelleErreurReseau(new TypeError(message)));
    }
  });

  it('dans la cause (message, adresse d’entrée, pile)', () => {
    const cause = Object.assign(new Error(`connect ECONNREFUSED ${CLE}`), {
      code: 'ECONNREFUSED',
      input: `https://hote.invalid/?jeton=${CLE}`,
      stack: `Error: ${CLE}\n    at quelque part`,
    });
    const err = new TypeError('fetch failed', { cause });
    expect(decrireErreurReseau(err)).toEqual({
      categorie: 'reseau',
      libelle: 'service injoignable (ECONNREFUSED)',
    });
  });

  it('dans le code ou le nom : refusés dès qu’ils n’ont pas la forme d’un code ou d’un nom de classe', () => {
    const err = Object.assign(new Error('x'), {
      name: `Bearer ${CLE}`,
      code: `Bearer ${CLE}`,
      cause: { code: `${CLE}\nSUITE` },
    });
    expect(decrireErreurReseau(err)).toEqual({
      categorie: 'autre',
      libelle: 'erreur inattendue',
    });
  });

  it('valeur levée qui n’est pas une erreur (chaîne, rien) : libellé neutre', () => {
    for (const leve of [`Bearer ${CLE}`, null, undefined, 42]) {
      expect(libelleErreurReseau(leve)).toBe('erreur inattendue');
    }
  });

  it('erreur inconnue : le nom de sa classe et son code, rien de son message', () => {
    const err = Object.assign(new RangeError(`hors bornes ${CLE}`), {
      code: 'ERR_OUT_OF_RANGE',
    });
    expect(libelleErreurReseau(err)).toBe(
      'erreur inattendue (RangeError, ERR_OUT_OF_RANGE)',
    );
  });

  it('code d’en-tête refusé de node:http : « en-tête refusé »', () => {
    const err = Object.assign(new TypeError(`Invalid character ${CLE}`), {
      code: 'ERR_INVALID_CHAR',
    });
    expect(decrireErreurReseau(err).categorie).toBe('entete_invalide');
    sansLaCle(libelleErreurReseau(err));
  });
});
