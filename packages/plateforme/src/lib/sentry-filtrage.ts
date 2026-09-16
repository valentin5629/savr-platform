import type { Breadcrumb, ErrorEvent } from '@sentry/nextjs';

// Filtrage de ce qui part vers Sentry (serveur ET navigateur).
//
// Pourquoi un filtre explicite plutôt que les défauts du SDK (@sentry/* 10.57, lu
// dans les sources) :
//  - le breadcrumb d'un fetch sortant garde le CHEMIN de l'URL (getBreadcrumbData,
//    @sentry/node-core) et recopie la query dans `data['http.query']`. Le chemin
//    d'un webhook Slack EST son jeton (`/services/T…/B…/<secret>`), et la query
//    porte des données (adresse géocodée, URL présignée de stockage) ;
//  - `integrations: []` ne coupe PAS les intégrations par défaut (v8+) : ces
//    breadcrumbs existent dès que le SDK est initialisé ;
//  - un event d'erreur embarque la requête entrante (en-têtes dont
//    `x-webhook-token` / `x-internal-token`, query dont `?token=` d'un webhook
//    transporteur), et `onRequestError` recopie `request.path` — query comprise —
//    dans `contexts.nextjs.request_path`.
// Le SDK filtre déjà une partie de ces clés par liste de motifs ; on ne s'y fie
// pas : on retire ces champs en entier, ce qui ne dépend d'aucun nom de clé.

export const VALEUR_FILTREE = '[Filtered]';

// Hôtes dont le chemin d'URL porte un secret ou une donnée personnelle : chemin
// entier masqué, où qu'il apparaisse (breadcrumb, message, exception, console).
//  - hooks.slack.com : le chemin EST le jeton du webhook ;
//  - api.insee.fr / ec.europa.eu : SIRET et n° de TVA interpolés dans le chemin
//    (un SIRET d'entreprise individuelle est une donnée personnelle ; le logger
//    le masque déjà par clé, cf. sanitizePayload).
const HOTES_CHEMIN_MASQUE = ['hooks.slack.com', 'api.insee.fr', 'ec.europa.eu'];

function estHoteMasque(hote: string): boolean {
  const h = hote.toLowerCase();
  return HOTES_CHEMIN_MASQUE.some((s) => h === s || h.endsWith(`.${s}`));
}

/**
 * URL sans query, fragment ni identifiants ; chemin masqué pour un hôte de
 * `HOTES_CHEMIN_MASQUE`. Une URL relative (`/api/x?token=…`) perd sa query de
 * la même façon.
 */
export function assainirUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    // Non parsable : pas de récursion vers assainirTexte (elle rappellerait
    // cette fonction sur la même chaîne). Query coupée ; tout masqué si un hôte
    // de la liste y figure.
    const brut = url.split(/[?#]/, 1)[0] ?? '';
    const h = brut.toLowerCase();
    return HOTES_CHEMIN_MASQUE.some((s) => h.includes(s))
      ? VALEUR_FILTREE
      : brut;
  }
  const chemin = estHoteMasque(u.hostname) ? `/${VALEUR_FILTREE}` : u.pathname;
  return `${u.protocol}//${u.host}${chemin}`;
}

const URL_DANS_TEXTE = /https?:\/\/[^\s"'<>]+/gi;

/** Applique `assainirUrl` à toute URL absolue contenue dans un texte libre. */
export function assainirTexte(texte: string): string {
  return texte.replace(URL_DANS_TEXTE, (url) => assainirUrl(url));
}

// Budget TOTAL de nœuds visités par valeur : le parcours tourne à chaque appel
// console, de façon synchrone. Il borne à la fois la largeur (Buffer de 5 Mo
// ≈ 4 s sans borne), la profondeur et les références circulaires.
const NOEUDS_MAX = 500;

/**
 * Assainit récursivement les chaînes d'une valeur quelconque. Une `Error` (que
 * Next passe telle quelle à `console.error`) est réduite à name/message/stack
 * assainis : ses propriétés natives ne sont pas énumérables et échapperaient au
 * parcours. Binaire ou budget dépassé : valeur masquée, jamais
 * copiée telle quelle.
 */
export function assainirValeur(valeur: unknown): unknown {
  let budget = NOEUDS_MAX;
  const visiter = (v: unknown): unknown => {
    if (typeof v === 'string') return assainirTexte(v);
    if (v === null || typeof v !== 'object') return v;
    if (--budget < 0) return VALEUR_FILTREE;
    if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer)
      return VALEUR_FILTREE;
    if (v instanceof Error) {
      return {
        name: v.name,
        message: assainirTexte(v.message),
        ...(v.stack ? { stack: assainirTexte(v.stack) } : {}),
      };
    }
    if (Array.isArray(v)) {
      const copie: unknown[] = [];
      for (const el of v) {
        if (budget <= 0) {
          copie.push(VALEUR_FILTREE);
          break;
        }
        copie.push(visiter(el));
      }
      return copie;
    }
    const copie: Record<string, unknown> = {};
    for (const cle in v) {
      if (!Object.prototype.hasOwnProperty.call(v, cle)) continue;
      if (budget <= 0) {
        copie['…'] = VALEUR_FILTREE;
        break;
      }
      try {
        copie[cle] = visiter((v as Record<string, unknown>)[cle]);
      } catch {
        // Getter ou Proxy qui lève : cette clé seule est masquée.
        copie[cle] = VALEUR_FILTREE;
      }
    }
    return copie;
  };
  try {
    return visiter(valeur);
  } catch {
    // Proxy qui lève dès l'inspection : masquer plutôt que laisser partir le brut.
    return VALEUR_FILTREE;
  }
}

export function filtrerBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  const b: Breadcrumb = { ...breadcrumb };
  if (b.data) {
    const data: Record<string, unknown> = { ...b.data };
    delete data['http.query'];
    delete data['http.fragment'];
    // `url` : fetch/xhr ; `from`/`to` : navigation navigateur.
    for (const cle of ['url', 'from', 'to']) {
      if (typeof data[cle] === 'string') data[cle] = assainirUrl(data[cle]);
    }
    // `arguments` : breadcrumb console (arguments bruts du console.*).
    if (Array.isArray(data['arguments'])) {
      // Budget par argument : un premier argument volumineux ne doit pas
      // priver les suivants d'assainissement (ils seraient masqués en bloc).
      data['arguments'] = data['arguments'].map((a: unknown) =>
        assainirValeur(a),
      );
    }
    b.data = data;
  }
  if (typeof b.message === 'string') b.message = assainirTexte(b.message);
  return b;
}

export function filtrerEvenement(event: ErrorEvent): ErrorEvent {
  const e: ErrorEvent = { ...event };

  if (e.request) {
    const { url, method } = e.request;
    e.request = {
      ...(url !== undefined ? { url: assainirUrl(url) } : {}),
      ...(method !== undefined ? { method } : {}),
    };
  }

  const nextjs = e.contexts?.['nextjs'];
  if (nextjs && typeof nextjs['request_path'] === 'string') {
    e.contexts = {
      ...e.contexts,
      nextjs: { ...nextjs, request_path: assainirUrl(nextjs['request_path']) },
    };
  }

  if (typeof e.message === 'string') e.message = assainirTexte(e.message);
  if (e.exception?.values) {
    e.exception = {
      ...e.exception,
      values: e.exception.values.map((v) =>
        typeof v.value === 'string'
          ? { ...v, value: assainirTexte(v.value) }
          : v,
      ),
    };
  }
  if (e.breadcrumbs) e.breadcrumbs = e.breadcrumbs.map(filtrerBreadcrumb);

  return e;
}
