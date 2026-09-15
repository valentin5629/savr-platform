import { NextResponse } from 'next/server';
import type { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';

type AdminSupabase = ReturnType<typeof createAdminSupabaseClient>;

// ─── Validation d'ENTRÉE de `collectes.lieu_overrides` ────────────────────────
//
// `lieu_overrides` est un `jsonb` libre : aucun schéma, aucun CHECK en base. Sans
// validation, un appel malformé d'un programmateur pourtant légitime stocke des
// valeurs de n'importe quel type, et l'adapter logistique les concatène telles
// quelles dans l'adresse transmise au transporteur — `{"ville":["a","b"],
// "code_postal":123,"adresse_acces":{}}` produit « [object Object], 123 a,b ».
// Le camion part alors sur une adresse impossible à parser.
//
// L'allowlist de SORTIE (`CHAMPS_LIEU_SURCHARGEABLES`, packages/adapters) borne ce
// qui atteint le wire ; ce module borne ce qui ENTRE, pour que la donnée stockée
// soit propre et que l'écran Admin qui affiche le diff override/officiel ne montre
// pas de valeurs aberrantes.

/** `plateforme.difficulte_acces_enum` — colonnes `stationnement`, `acces_office`. */
const DIFFICULTE_ACCES = ['facile', 'difficile', 'tres_difficile'] as const;

/** `plateforme.type_vehicule_enum` — colonne `type_vehicule_max`. */
const TYPE_VEHICULE = [
  'velo_cargo',
  'camionnette',
  'fourgon',
  'vul',
  'poids_lourd',
] as const;

/**
 * Postgres REFUSE `\u0000` dans un `jsonb` (22P05). Sans ce filtre, une chaîne
 * porteuse d'un caractère de contrôle traverse la validation, casse à l'INSERT et
 * ressort en 500 — alors que c'est une valeur invalide, donc un 422. Les autres
 * caractères de contrôle n'ont aucun sens dans une adresse et brouilleraient
 * l'affichage du diff override/officiel.
 */
function contientCaractereDeControle(valeur: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u001F\u007F]/.test(valeur);
}

type RegleChamp =
  | { kind: 'texte'; max: number; obligatoire: boolean }
  | { kind: 'enum'; valeurs: readonly string[] }
  | { kind: 'liste_texte'; maxItems: number; maxParItem: number };

/**
 * Champs du lieu éditables à la programmation (CDC §06.01 l.104 : « tous les champs
 * associés au lieu (sauf le nom du lieu) s'affichent en autocomplete pré-remplis et
 * éditables »), miroir exact de `LieuEdits` (lieu-champs-editables.tsx). Le nom du
 * lieu reste figé (identifiant) et les champs admin/ops-only (`commentaire_lieu`,
 * `siren`, `email_gestionnaire`, `reference_citeo`, l.106) ne sont jamais
 * surchargeables — toute autre clé est refusée.
 *
 * Alignement sur `plateforme.lieux` : les trois enums reprennent les valeurs des
 * types Postgres correspondants (une valeur hors liste ne pourrait pas être stockée
 * dans la colonne), `flux_autorises` reste une liste (colonne `text[]`), et les
 * champs NOT NULL en base (`adresse_acces`, `code_postal`, `ville`) refusent le
 * vide — un override qui efface l'adresse produit exactement l'adresse impossible
 * que l'on cherche à empêcher. Les colonnes étant des `text` sans contrainte de
 * longueur, les bornes ci-dessous sont applicatives : dimensionnées sur une saisie
 * de terrain plausible, elles n'existent que pour borner ce qui part au transporteur.
 */
const CHAMPS_LIEU_OVERRIDABLES: Record<string, RegleChamp> = {
  adresse_acces: { kind: 'texte', max: 200, obligatoire: true },
  code_postal: { kind: 'texte', max: 16, obligatoire: true },
  ville: { kind: 'texte', max: 120, obligatoire: true },
  acces_details: { kind: 'texte', max: 1000, obligatoire: false },
  contraintes_horaires: { kind: 'texte', max: 500, obligatoire: false },
  stationnement: { kind: 'enum', valeurs: DIFFICULTE_ACCES },
  acces_office: { kind: 'enum', valeurs: DIFFICULTE_ACCES },
  type_vehicule_max: { kind: 'enum', valeurs: TYPE_VEHICULE },
  flux_autorises: { kind: 'liste_texte', maxItems: 20, maxParItem: 64 },
};

/**
 * Valide UNE valeur d'override. Retourne la valeur normalisée (chaînes trimées,
 * « non renseigné » → `null`) ou `null` de refus.
 *
 * Un `null` est toujours accepté sur un champ facultatif : c'est la façon d'effacer
 * une surcharge. Côté fusion, un `null` n'écrase jamais la valeur de référence du
 * lieu — « non renseigné » veut donc bien dire « pas de surcharge », et non
 * « adresse vide ».
 */
function validerValeur(
  regle: RegleChamp,
  valeur: unknown,
): { ok: true; valeur: unknown } | { ok: false } {
  if (regle.kind === 'enum') {
    // Le formulaire propose « Non renseigné » (`<option value="">`) sur les trois
    // selects : la chaîne vide est une saisie légitime, normalisée en `null`.
    if (valeur === null || valeur === '') return { ok: true, valeur: null };
    if (typeof valeur !== 'string' || !regle.valeurs.includes(valeur)) {
      return { ok: false };
    }
    return { ok: true, valeur };
  }

  if (regle.kind === 'liste_texte') {
    if (valeur === null) return { ok: true, valeur: null };
    if (!Array.isArray(valeur) || valeur.length > regle.maxItems) {
      return { ok: false };
    }
    const items: string[] = [];
    for (const item of valeur) {
      if (
        typeof item !== 'string' ||
        item.length > regle.maxParItem ||
        contientCaractereDeControle(item)
      ) {
        return { ok: false };
      }
      const propre = item.trim();
      if (propre === '') return { ok: false };
      items.push(propre);
    }
    return { ok: true, valeur: items };
  }

  if (valeur === null) {
    return regle.obligatoire ? { ok: false } : { ok: true, valeur: null };
  }
  // Le point du défaut : sans ce test, un objet, un tableau ou un nombre traverse
  // jusqu'à la concaténation de l'adresse chez l'adapter.
  if (
    typeof valeur !== 'string' ||
    valeur.length > regle.max ||
    contientCaractereDeControle(valeur)
  ) {
    return { ok: false };
  }
  const propre = valeur.trim();
  if (regle.obligatoire && propre === '') return { ok: false };
  return { ok: true, valeur: propre };
}

/**
 * Valide `lieu_overrides` reçu d'un client. Suit la convention `readJsonBody` :
 * `{ overrides }` en cas de succès, `{ error }` (422, erreur typée `champs_invalides`
 * comme les refus `champs_verrouilles` des routes d'édition de collecte) sinon.
 *
 * Absent / `null` / non-objet vide → `null` (pas d'override).
 */
export function validerLieuOverrides(
  input: unknown,
): { overrides: Record<string, unknown> | null } | { error: NextResponse } {
  if (input === undefined || input === null) return { overrides: null };

  if (typeof input !== 'object' || Array.isArray(input)) {
    return {
      error: NextResponse.json(
        {
          error:
            'Modification du lieu invalide : un objet de champs du lieu est attendu.',
        },
        { status: 422 },
      ),
    };
  }

  const source = input as Record<string, unknown>;
  const inconnus: string[] = [];
  const invalides: string[] = [];
  const overrides: Record<string, unknown> = {};

  // `Object.keys` = propriétés propres énumérables seulement : une clé `__proto__`
  // posée par `JSON.parse` est bien vue ici, et refusée par l'allowlist.
  for (const cle of Object.keys(source)) {
    const regle = Object.hasOwn(CHAMPS_LIEU_OVERRIDABLES, cle)
      ? CHAMPS_LIEU_OVERRIDABLES[cle]
      : undefined;
    if (!regle) {
      inconnus.push(cle);
      continue;
    }
    const resultat = validerValeur(regle, source[cle]);
    if (!resultat.ok) {
      invalides.push(cle);
      continue;
    }
    overrides[cle] = resultat.valeur;
  }

  if (inconnus.length > 0 || invalides.length > 0) {
    const raisons = [
      inconnus.length > 0
        ? 'champs non modifiables pour une collecte'
        : undefined,
      invalides.length > 0
        ? 'valeurs invalides (type, longueur ou valeur hors liste)'
        : undefined,
    ].filter(Boolean);
    return {
      error: NextResponse.json(
        {
          error: `Modification du lieu invalide : ${raisons.join(' ; ')}.`,
          champs_invalides: [...inconnus, ...invalides],
        },
        { status: 422 },
      ),
    };
  }

  return { overrides };
}

export interface OverrideLieuParams {
  evenementId: string;
  lieuId: string;
  overrides: Record<string, unknown>;
  userId: string;
  role: string | null;
}

/**
 * BL-P1-PROG-01 — signalement léger d'un override de lieu à la programmation.
 * CDC §06.01 l.111 : « Notification Admin Savr (signalement léger — le diff avant/après
 * est lisible via lieu_overrides vs lieux officiel + tracé audit_log) ». Le référentiel
 * lieux n'est PAS mis à jour automatiquement (l.112).
 *
 * Best-effort / non bloquant : n'échoue jamais la programmation.
 */
export async function notifierOverrideLieu(
  supabase: AdminSupabase,
  params: OverrideLieuParams,
): Promise<void> {
  const champs = Object.keys(params.overrides).join(', ');

  // Notification Admin in-app dédupliquée (aucun email — signalement léger).
  try {
    await supabase.rpc('f_upsert_alerte_admin', {
      p_code: 'lieu_override_programmation',
      p_titre: 'Lieu modifié à la programmation',
      p_message: `Des champs du lieu (${champs}) ont été modifiés à la programmation (override per-collecte). Le référentiel lieu n'est pas mis à jour automatiquement.`,
      p_entity_type: 'evenements',
      p_entity_id: params.evenementId,
    });
  } catch {
    // best-effort : n'échoue jamais la programmation.
  }

  // Trace audit_log : le diff avant/après est lisible via lieu_overrides vs lieu officiel.
  try {
    await supabase.from('audit_log').insert({
      table_name: 'lieux',
      record_id: params.lieuId,
      action: 'lieu_override_programmation',
      user_id: params.userId,
      role: params.role,
      new_values: {
        evenement_id: params.evenementId,
        lieu_overrides: params.overrides,
      },
    });
  } catch {
    // best-effort.
  }
}
