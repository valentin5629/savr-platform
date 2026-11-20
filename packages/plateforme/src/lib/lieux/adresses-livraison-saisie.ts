import { NextResponse } from 'next/server';
import { geocodeAdresse } from '@/lib/geocoding.js';

// Saisie Admin/Ops des adresses de livraison n° 2 et n° 3 d'un lieu (Val
// 2026-11-19) et du libellé de l'adresse n° 1 : validation, tassement (une
// adresse n° 3 sans n° 2 devient la n° 2) et géocodage, comme pour l'adresse
// n° 1. Utilisé par POST et PATCH /api/v1/admin/lieux (routes staff seules).
//
// Bornes = CHECK de la migration 20261119150000 et de `validerLieuOverrides` :
// une adresse choisie à la programmation est recopiée dans `lieu_overrides`.

const MAX = { libelle: 60, adresse: 200, code_postal: 16, ville: 120 } as const;

const CLES_EMPLACEMENTS = [2, 3].flatMap((n) => [
  `libelle_adresse_${n}`,
  `adresse_acces_${n}`,
  `code_postal_${n}`,
  `ville_${n}`,
]);

/** Le corps mentionne-t-il une adresse de livraison ou le libellé n° 1 ? */
export function mentionneAdressesLivraison(
  body: Record<string, unknown>,
): boolean {
  return (
    'libelle_adresse_1' in body || CLES_EMPLACEMENTS.some((c) => c in body)
  );
}

interface Saisie {
  libelle: string | null;
  adresse: string | null;
  code_postal: string | null;
  ville: string | null;
}

function lire(v: unknown): string | null | 'invalide' {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') return 'invalide';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F-\u009F]/.test(v)) return 'invalide';
  const t = v.trim();
  return t === '' ? null : t;
}

function refus(message: string): { ok: false; reponse: NextResponse } {
  return {
    ok: false,
    reponse: NextResponse.json({ error: message }, { status: 422 }),
  };
}

type Resultat =
  | { ok: true; valeurs: Record<string, unknown> }
  | { ok: false; reponse: NextResponse };

/**
 * Colonnes à écrire pour les adresses de livraison, d'après le corps de la
 * requête. Un corps qui ne mentionne aucune clé des n° 2 et n° 3 ne les touche
 * pas. Dès qu'il en mentionne une, les n° 2 et n° 3 sont réécrits ensemble (le
 * tassement les lie) : une clé absente du corps garde la valeur du lieu
 * (`avant`, PATCH partiel), ou vaut vide à la création. `avant` sert aussi à ne
 * regéocoder qu'une adresse qui change.
 */
export async function lireAdressesLivraison(
  body: Record<string, unknown>,
  avant: Record<string, unknown> | null,
): Promise<Resultat> {
  const valeurs: Record<string, unknown> = {};

  if ('libelle_adresse_1' in body) {
    const l = lire(body.libelle_adresse_1);
    if (l === 'invalide' || (l && l.length > MAX.libelle))
      return refus(
        `Libellé de l'adresse n° 1 invalide (${MAX.libelle} caractères au plus).`,
      );
    valeurs.libelle_adresse_1 = l;
  }

  if (!CLES_EMPLACEMENTS.some((c) => c in body)) return { ok: true, valeurs };

  // Clé absente du corps = valeur actuelle du lieu (PATCH partiel).
  const champ = (cle: string) =>
    lire(cle in body ? body[cle] : (avant?.[cle] ?? null));
  const saisies: Saisie[] = [];
  for (const n of [2, 3]) {
    const s = {
      libelle: champ(`libelle_adresse_${n}`),
      adresse: champ(`adresse_acces_${n}`),
      code_postal: champ(`code_postal_${n}`),
      ville: champ(`ville_${n}`),
    };
    if (Object.values(s).includes('invalide'))
      return refus(`Adresse n° ${n} invalide.`);
    const saisie = s as Saisie;
    const remplis = [saisie.adresse, saisie.code_postal, saisie.ville].filter(
      Boolean,
    ).length;
    if (remplis === 0 && !saisie.libelle) continue;
    if (remplis < 3)
      return refus(
        `Adresse n° ${n} incomplète : renseignez l'adresse, le code postal et la ville, ou retirez-la.`,
      );
    if (
      saisie.adresse!.length > MAX.adresse ||
      saisie.code_postal!.length > MAX.code_postal ||
      saisie.ville!.length > MAX.ville ||
      (saisie.libelle && saisie.libelle.length > MAX.libelle)
    )
      return refus(`Adresse n° ${n} trop longue.`);
    saisies.push(saisie);
  }

  // Tassement : les emplacements remplis prennent les numéros 2 puis 3.
  for (const [i, n] of [2, 3].entries()) {
    const s = saisies[i];
    valeurs[`libelle_adresse_${n}`] = s?.libelle ?? null;
    valeurs[`adresse_acces_${n}`] = s?.adresse ?? null;
    valeurs[`code_postal_${n}`] = s?.code_postal ?? null;
    valeurs[`ville_${n}`] = s?.ville ?? null;
    if (!s) {
      valeurs[`latitude_${n}`] = null;
      valeurs[`longitude_${n}`] = null;
      continue;
    }
    const inchangee =
      avant !== null &&
      avant[`adresse_acces_${n}`] === s.adresse &&
      avant[`code_postal_${n}`] === s.code_postal &&
      avant[`ville_${n}`] === s.ville;
    if (inchangee) continue;
    // Géocodage fail-open, comme l'adresse n° 1 (cf. lib/geocoding.ts) : une
    // adresse non trouvée reste enregistrée, sans coordonnées.
    const coords = await geocodeAdresse(s.adresse!, s.code_postal!, s.ville!);
    valeurs[`latitude_${n}`] = coords?.latitude ?? null;
    valeurs[`longitude_${n}`] = coords?.longitude ?? null;
  }

  return { ok: true, valeurs };
}
