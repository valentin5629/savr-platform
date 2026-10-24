import { NextResponse } from 'next/server';
import type { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { jourParis } from '@savr/shared/src/temps/index.js';
import { validerChampsTexteLibre } from '@/lib/champs-texte-libre.js';
import { refusHeureCollecte } from '@/lib/heure-collecte.js';
import { refusPaxCollecte } from '@/lib/pax-collecte.js';

type AdminSupabase = ReturnType<typeof createAdminSupabaseClient>;

/**
 * Carte d'une collecte du formulaire de programmation (refonte, lot B2 ;
 * décisions Val 2026-10-22, C1–C2) : chaque collecte porte sa date, son heure,
 * ses convives, son type d'événement, ses contacts et ses informations
 * supplémentaires. Forme attendue par les RPC `fn_creer_collecte_carte` et
 * `fn_enregistrer_programmation`.
 */
export interface CarteCollecte {
  type: 'zd' | 'ag';
  date_collecte: string;
  heure_collecte: string;
  pax: number;
  informations_supplementaires: string | null;
  type_evenement_id: string;
  contact_principal_nom: string;
  contact_principal_telephone: string;
  contact_secours_nom: string | null;
  contact_secours_telephone: string | null;
}

/** Au plus 10 collectes Zéro Déchet et 10 Anti-Gaspi par programmation (B2-Q4). */
export const PLAFOND_COLLECTES_PAR_TYPE = 10;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** AAAA-MM-JJ d'un jour qui existe (le 2030-02-30 est refusé). */
function dateValide(valeur: string): boolean {
  const m = DATE.exec(valeur);
  if (!m) return false;
  const [a, mo, j] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(a, mo - 1, j));
  return (
    d.getUTCFullYear() === a &&
    d.getUTCMonth() === mo - 1 &&
    d.getUTCDate() === j
  );
}

const refus = (error: string, extra: Record<string, unknown> = {}) => ({
  error: NextResponse.json({ error, ...extra }, { status: 422 }),
});

/**
 * Valide et normalise les cartes reçues, AVANT toute écriture (422) :
 *   · au moins une carte ; avec `plafond`, au plus 10 par type ;
 *   · date d'aujourd'hui ou après (jour de Paris), heure, convives ;
 *   · type d'événement : un type actif du référentiel ;
 *   · contact principal (nom et téléphone) obligatoire, contact de secours
 *     facultatif (vide = absent) ; bornes de validerChampsTexteLibre ;
 *   · informations supplémentaires facultatives, bornées.
 * Le type d'événement est vérifié en une seule lecture pour toutes les cartes.
 */
export async function validerCartes(
  admin: AdminSupabase,
  brut: unknown,
  opts: { plafond: boolean },
): Promise<{ cartes: CarteCollecte[] } | { error: NextResponse }> {
  if (!Array.isArray(brut) || brut.length === 0) {
    return refus('Au moins une collecte est requise.');
  }

  const today = jourParis();
  const cartes: CarteCollecte[] = [];
  for (const [rang, c] of brut.entries()) {
    if (typeof c !== 'object' || c === null || Array.isArray(c)) {
      return refus('Collecte invalide.', { collecte: rang });
    }
    const carte = c as Record<string, unknown>;
    if (carte.type !== 'zd' && carte.type !== 'ag') {
      return refus('Chaque collecte est Zéro Déchet ou Anti-Gaspi.', {
        collecte: rang,
      });
    }
    if (
      typeof carte.date_collecte !== 'string' ||
      !carte.date_collecte ||
      !carte.heure_collecte
    ) {
      return refus(
        'Chaque collecte requiert : type, date_collecte, heure_collecte',
        { collecte: rang },
      );
    }
    // Date au format AAAA-MM-JJ et réelle : sinon la conversion en base
    // échouerait (500) au lieu d'un refus.
    if (!dateValide(carte.date_collecte)) {
      return refus(`Date de collecte invalide : ${carte.date_collecte}`, {
        collecte: rang,
        champ: 'date_collecte',
      });
    }
    const refusHeure = refusHeureCollecte(carte.heure_collecte);
    if (refusHeure) return { error: refusHeure };
    const refusPax = refusPaxCollecte(carte.pax);
    if (refusPax) return { error: refusPax };
    if (carte.date_collecte < today) {
      return refus(`Date de collecte dans le passé : ${carte.date_collecte}`, {
        collecte: rang,
      });
    }
    if (
      typeof carte.type_evenement_id !== 'string' ||
      !UUID.test(carte.type_evenement_id)
    ) {
      return refus("Type d'événement requis pour chaque collecte.", {
        collecte: rang,
        champ: 'type_evenement_id',
      });
    }
    // Contact principal : présence exigée ici ; non vide et borné par
    // validerChampsTexteLibre (champ `obligatoire`).
    for (const champ of [
      'contact_principal_nom',
      'contact_principal_telephone',
    ] as const) {
      if (!Object.hasOwn(carte, champ)) {
        return refus(
          'Le contact principal et son téléphone sont obligatoires pour chaque collecte.',
          { collecte: rang, champ },
        );
      }
    }
    const textes = validerChampsTexteLibre(carte);
    if ('error' in textes) return textes;

    cartes.push({
      type: carte.type,
      date_collecte: carte.date_collecte,
      heure_collecte: String(carte.heure_collecte),
      pax: carte.pax as number,
      informations_supplementaires:
        textes.valeurs.informations_supplementaires ?? null,
      type_evenement_id: carte.type_evenement_id,
      contact_principal_nom: textes.valeurs.contact_principal_nom!,
      contact_principal_telephone: textes.valeurs.contact_principal_telephone!,
      contact_secours_nom: textes.valeurs.contact_secours_nom ?? null,
      contact_secours_telephone:
        textes.valeurs.contact_secours_telephone ?? null,
    });
  }

  if (opts.plafond) {
    for (const type of ['zd', 'ag'] as const) {
      if (
        cartes.filter((c) => c.type === type).length >
        PLAFOND_COLLECTES_PAR_TYPE
      ) {
        return refus(
          `Au plus ${PLAFOND_COLLECTES_PAR_TYPE} collectes Zéro Déchet et ${PLAFOND_COLLECTES_PAR_TYPE} Anti-Gaspi par programmation.`,
        );
      }
    }
  }

  const types = [...new Set(cartes.map((c) => c.type_evenement_id))];
  const { data, error } = await admin
    .from('types_evenements')
    .select('id')
    .in('id', types)
    .eq('actif', true);
  if (error) {
    return {
      error: NextResponse.json({ error: 'Erreur serveur' }, { status: 500 }),
    };
  }
  const connus = new Set((data ?? []).map((t: { id: string }) => t.id));
  const inconnu = cartes.findIndex((c) => !connus.has(c.type_evenement_id));
  if (inconnu >= 0) {
    return refus("Type d'événement inconnu.", {
      collecte: inconnu,
      champ: 'type_evenement_id',
    });
  }

  return { cartes };
}
