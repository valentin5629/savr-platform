// Libellé maîtrisé d'un appel sortant qui n'a pas abouti (`fetch` rejeté).
//
// RÈGLE : ne jamais écrire `String(err)` ni `err.message` d'un `fetch` rejeté
// dans un texte enregistré en base, journalisé, envoyé en alerte ou affiché.
// Le moteur y recopie la valeur qu'il refuse. Mesuré le 2026-10-13 sous
// Node 25.9.0 (undici 7.24.4), avec une fausse clé :
//   • valeur d'en-tête portant un caractère NUL où que ce soit, ou un saut de
//     ligne ou un retour chariot ailleurs qu'à ses extrémités →
//       « Headers.append: "Bearer <clé entière>" is an invalid header value. »
//   • adresse illisible → « Failed to parse URL from <adresse entière> », et la
//     même adresse dans `cause.input`.
// Non mesuré sous Node 20 (version de production d'après `.nvmrc`) : la règle
// ne dépend pas de la réponse.
//
// On CLASSE donc l'échec et on ne rend qu'un libellé écrit ici, complété au
// plus d'un code machine (`cause.code`, ex. ECONNREFUSED) et d'un nom de classe
// d'erreur (`name`), refusés l'un comme l'autre s'ils n'en ont pas la forme. Le
// message du moteur est LU pour classer ; il n'est jamais rendu.
//
// Reste assumé : un `name` fait de lettres seules ou un `code` fait de
// majuscules, chiffres et tirets bas sort tel quel. Le moteur n'y range jamais
// la valeur qu'il refuse (17 erreurs du vrai `fetch` essayées en revue sécurité,
// Node 22.23.2 et 25.9.0) : il faudrait une erreur fabriquée pour y loger un
// secret.
//
// Cliquet : `pnpm check:api-error-leak`, règle F — dans un fichier serveur qui
// touche au moteur HTTP, l'erreur attrapée ne se lit pas : on la passe ici.

export type CategorieErreurReseau =
  | 'delai_depasse'
  | 'adresse_invalide'
  | 'entete_invalide'
  | 'reseau'
  | 'autre';

export interface ErreurReseau {
  categorie: CategorieErreurReseau;
  libelle: string;
}

// Un code machine (ECONNREFUSED, UND_ERR_SOCKET, ERR_INVALID_URL…) et un nom de
// classe (TypeError, AbortError…) : rien d'autre ne sort de l'erreur.
const FORME_CODE = /^[A-Z][A-Z0-9_]{1,39}$/;
const FORME_NOM = /^[A-Za-z]{1,40}$/;

// Codes de `node:http` pour une valeur ou un nom d'en-tête refusé.
const CODES_ENTETE = new Set([
  'ERR_INVALID_CHAR',
  'ERR_HTTP_INVALID_HEADER_VALUE',
  'ERR_INVALID_HTTP_TOKEN',
]);

// Lecture qui ne lève jamais : cette fonction est appelée depuis un `catch`,
// et une erreur exotique (accesseur qui lève, Proxy) ne doit pas en sortir à la
// place du libellé.
function champ(objet: unknown, cle: string): unknown {
  if (typeof objet !== 'object' || objet === null) return undefined;
  try {
    return (objet as Record<string, unknown>)[cle];
  } catch {
    return undefined;
  }
}

function deForme(valeur: unknown, forme: RegExp): string | null {
  return typeof valeur === 'string' && forme.test(valeur) ? valeur : null;
}

export function decrireErreurReseau(err: unknown): ErreurReseau {
  const nom = deForme(champ(err, 'name'), FORME_NOM);
  const code =
    deForme(champ(champ(err, 'cause'), 'code'), FORME_CODE) ??
    deForme(champ(err, 'code'), FORME_CODE);
  const brut = champ(err, 'message');
  const texte = typeof brut === 'string' ? brut : '';

  // Dans nos clients, le seul abandon d'un appel est celui du minuteur de délai
  // (`AbortController` → AbortError, `AbortSignal.timeout` → TimeoutError).
  if (nom === 'AbortError' || nom === 'TimeoutError') {
    return { categorie: 'delai_depasse', libelle: 'délai dépassé' };
  }
  if (
    code === 'ERR_INVALID_URL' ||
    /^(Failed to parse URL|Invalid URL)/.test(texte)
  ) {
    return {
      categorie: 'adresse_invalide',
      libelle: "adresse d'appel illisible (URL de base absente ou mal formée)",
    };
  }
  if (
    (code !== null && CODES_ENTETE.has(code)) ||
    /invalid header (value|name)|ByteString/i.test(texte)
  ) {
    return {
      categorie: 'entete_invalide',
      libelle: 'en-tête de requête refusé (clé ou jeton mal formé)',
    };
  }
  // « fetch failed » : la forme sous laquelle le moteur rend tout échec de
  // transport (connexion refusée, nom introuvable, coupure, certificat) ; la
  // cause précise est dans `cause.code`.
  if (texte === 'fetch failed') {
    return {
      categorie: 'reseau',
      libelle: code ? `service injoignable (${code})` : 'service injoignable',
    };
  }
  const precisions = [nom, code].filter((p): p is string => p !== null);
  return {
    categorie: 'autre',
    libelle: precisions.length
      ? `erreur inattendue (${precisions.join(', ')})`
      : 'erreur inattendue',
  };
}

/** Le seul texte d'une erreur de `fetch` qu'on a le droit d'écrire quelque part. */
export function libelleErreurReseau(err: unknown): string {
  return decrireErreurReseau(err).libelle;
}
