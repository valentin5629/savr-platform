// Cible de redirection post-login (`/login?next=…`). Le middleware n'y pose que
// des pathnames internes, mais le paramètre vient de l'URL : un lien forgé
// (`?next=https://evil.example`, `//evil.example`, `/\evil.example`) ferait sortir
// l'utilisateur du domaine juste après sa connexion (open redirect → phishing).
//
// Seul un chemin relatif à l'origine est accepté, sinon `/` (qui redirige vers
// l'espace du rôle). Refusé :
//  • tout ce qui ne commence pas par `/` (URL absolue, `javascript:`, relatif) ;
//  • `//` et `/\` : le parseur WHATWG les lit comme une autorité (hôte externe) ;
//  • les caractères de contrôle : le parseur retire tab/CR/LF, `/\t/evil` devient
//    `//evil`.
// Les règles s'appliquent à la valeur brute ET décodée (`%2F%2Fevil`), et une
// résolution contre une origine factice sert de filet final.
const ORIGINE_FACTICE = 'https://savr.invalid';
const FALLBACK = '/';

function estCheminInterne(valeur: string): boolean {
  return (
    valeur.startsWith('/') &&
    !valeur.startsWith('//') &&
    !valeur.startsWith('/\\') &&
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001F\u007F]/.test(valeur)
  );
}

export function safeNextPath(next: string | null | undefined): string {
  if (!next) return FALLBACK;

  let decode: string;
  try {
    decode = decodeURIComponent(next);
  } catch {
    return FALLBACK;
  }
  if (!estCheminInterne(next) || !estCheminInterne(decode)) return FALLBACK;

  try {
    if (new URL(next, ORIGINE_FACTICE).origin !== ORIGINE_FACTICE) {
      return FALLBACK;
    }
  } catch {
    return FALLBACK;
  }
  return next;
}
