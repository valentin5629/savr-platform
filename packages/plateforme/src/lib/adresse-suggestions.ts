// Suggestions d'adresse pendant la saisie (quick-add lieu hors référentiel §06.01).
// Même source que le géocodage serveur (lib/geocoding.ts) : la Base Adresse Nationale,
// servie par la Géoplateforme IGN (data.geopf.fr/geocodage — successeur officiel
// d'api-adresse.data.gouv.fr, qui y redirige). FR, sans clé. Appelée CÔTÉ SERVEUR
// uniquement, via la route /api/v1/programmation/adresses : l'IGN ne voit jamais l'IP
// de l'utilisateur (arbitrage Val 2026-09-28). Le navigateur n'importe d'ici que le type.
//
// Fail-open : erreur réseau, timeout ou réponse inattendue → [] (le champ reste une
// saisie libre, jamais bloquant).

export interface SuggestionAdresse {
  id: string;
  /** Libellé complet affiché dans la liste (« 39 Avenue de Wagram 75017 Paris »). */
  label: string;
  /** Numéro + voie, sans code postal ni ville (« 39 Avenue de Wagram »). */
  adresse: string;
  codePostal: string;
  ville: string;
}

// Priorise (sans exclure) les adresses proches de Paris : l'activité V1 est en
// Île-de-France (multi-régions = V2). Une adresse de province reste proposée.
const PRIORITE_PARIS = 'lat=48.8566&lon=2.3522';

// L'API refuse les requêtes de moins de 3 caractères.
const MIN_CARACTERES_SUGGESTION = 3;

interface FeatureBan {
  properties?: {
    id?: string;
    label?: string;
    name?: string;
    postcode?: string;
    city?: string;
    type?: string;
  };
}

export async function suggererAdresses(
  saisie: string,
  signal?: AbortSignal,
): Promise<SuggestionAdresse[]> {
  const q = saisie.trim();
  if (q.length < MIN_CARACTERES_SUGGESTION) return [];

  try {
    const url = `https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(q)}&autocomplete=1&limit=5&${PRIORITE_PARIS}`;
    // Même plafond que lib/geocoding.ts : une API muette ne laisse pas de requête pendante.
    const timeout = AbortSignal.timeout(5000);
    const res = await fetch(url, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!res.ok) return [];

    const body = (await res.json()) as { features?: FeatureBan[] };
    return (body.features ?? []).flatMap((f) => {
      const p = f.properties;
      // Une commune seule n'est pas une adresse d'accès : son « name » est le nom de
      // la ville, il écraserait le champ adresse.
      if (!p?.id || !p.label || !p.name || p.type === 'municipality') return [];
      return [
        {
          id: p.id,
          label: p.label,
          adresse: p.name,
          codePostal: p.postcode ?? '',
          ville: p.city ?? '',
        },
      ];
    });
  } catch {
    return [];
  }
}
