// Déclaration du coursier à l'enlèvement (« Colis récupéré »), relue chez le
// transporteur (décisions Val 2026-11-17). Seul A Toute! l'expose : depuis le
// 2026-11-17, le coursier y saisit le poids exact pesé (champ obligatoire) et
// cinq champs de suppléments (tranches de poids, caisse, attente).
//
// - Le poids devient le poids du don d'une collecte AG, aux règles de MTS-1
//   (décision Val 2026-11-13) : l'Admin garde le dernier mot, plusieurs vélos =
//   somme quand chacun est pesé.
// - Tous les champs sont montrés à l'Admin dans la fiche collecte.
//
// Lus dans l'historique des étapes de la course, jamais dans la notification
// (non signée) ni dans la relecture de la course, qui ne garde que l'étape
// courante : à « Colis remis », le poids n'y est plus.
//
// Point d'entrée neutre (garde-fou 3) : ni le webhook ni la route Admin ne
// parlent au transporteur.

import type { SupabaseClient } from '@supabase/supabase-js';

import { LogistiqueTransientError } from './index.js';
import { EverestClient } from './everest/client.js';
import type { EtapeHistoriqueEverest } from './everest/mock.js';
import {
  tourneesALire,
  transporteurDeLaCollecte,
} from './photos-transporteur.js';

/** Un champ saisi par le coursier, tel qu'il s'affiche. */
export interface ChampDeclare {
  nom: string;
  /** « Oui » / « Non » pour une case, sinon la saisie ; vide si non remplie. */
  valeur: string;
}

/** Ce que le coursier d'une course a déclaré à l'enlèvement. */
export interface DeclarationCourse {
  /** Rang de la course (vélo) de la collecte. */
  course: number;
  declare_le: string | null;
  /** Poids pesé, en kg, ou null s'il n'est pas lisible. */
  poids_kg: number | null;
  champs: ChampDeclare[];
}

export type DeclarationsCoursier =
  | { pris_en_charge: false }
  | {
      pris_en_charge: true;
      /** Courses dont le coursier a déclaré l'enlèvement, par rang. */
      courses: DeclarationCourse[];
      /** Courses de la collecte encore sans déclaration. */
      courses_sans_declaration: number;
    };

// Nom du champ du poids sur le compte A Toute! (« Poids en Kg obligatoire »,
// mail d'A Toute! du 2026-11-17), lu sans casse, accents ni espaces doublés.
const DEBUT_NOM_POIDS = 'poids en kg';

// Statuts où le poids du don s'écrit : les mêmes que MTS-1 (adapter.ts,
// STATUTS_POIDS_DON). Jamais sur une collecte clôturée, annulée ou sans
// excédent.
const STATUTS_POIDS_DON = new Set(['validee', 'en_cours', 'realisee']);

function normaliser(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function estChampPoids(nom: string): boolean {
  return normaliser(nom).startsWith(DEBUT_NOM_POIDS);
}

/** Poids saisi, en kg : nombre strictement positif (virgule acceptée), sinon null. */
export function lirePoidsSaisi(valeur: string): number | null {
  const texte = valeur.trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(texte)) return null;
  const poids = Number(texte);
  return Number.isFinite(poids) && poids > 0 ? poids : null;
}

// Une case « oui ou non » : le type du champ quand A Toute! le donne, à défaut
// son libellé.
function estCase(champ: EtapeHistoriqueEverest['champs'][number]): boolean {
  if (champ.type) return champ.type === 'true_false';
  return normaliser(champ.name).includes('oui ou non');
}

function valeurAffichee(
  champ: EtapeHistoriqueEverest['champs'][number],
): string {
  const brute = champ.value.trim();
  if (!estCase(champ)) return brute;
  const v = normaliser(brute);
  if (v === '1' || v === 'true' || v === 'oui') return 'Oui';
  if (v === '0' || v === 'false' || v === 'non') return 'Non';
  return brute;
}

/**
 * L'étape de l'enlèvement : la plus récente qui porte le champ du poids. Une
 * course repassée par « Colis récupéré » garde sa dernière saisie.
 */
export function etapeDeclaree(
  historique: EtapeHistoriqueEverest[],
): EtapeHistoriqueEverest | null {
  let retenue: EtapeHistoriqueEverest | null = null;
  for (const etape of historique) {
    if (!etape.champs.some((c) => estChampPoids(c.name))) continue;
    if (!retenue || etape.date >= retenue.date) retenue = etape;
  }
  return retenue;
}

function declaration(
  course: number,
  etape: EtapeHistoriqueEverest,
): DeclarationCourse {
  const poids = etape.champs.find((c) => estChampPoids(c.name));
  return {
    course,
    declare_le: new Date(etape.date * 1000).toISOString(),
    poids_kg: poids ? lirePoidsSaisi(poids.value) : null,
    champs: etape.champs.map((c) => ({
      nom: c.name.trim(),
      valeur: valeurAffichee(c),
    })),
  };
}

// Courses vivantes de la collecte chez A Toute!, avec leur référence, ou null
// si la collecte n'est pas confiée à A Toute!.
async function coursesALire(
  supabase: SupabaseClient,
  collecteId: string,
): Promise<Array<{ rang: number; ref: string }> | null> {
  if ((await transporteurDeLaCollecte(supabase, collecteId)) !== 'a_toutes') {
    return null;
  }
  const tournees = await tourneesALire(supabase, collecteId);
  return tournees
    .filter((t) => t.statut !== 'annulee')
    .map((t) => ({ rang: t.rang, ref: t.external_ref_commande as string }));
}

async function declarationsDesCourses(
  supabase: SupabaseClient,
  courses: Array<{ rang: number; ref: string }>,
  correlationId: string,
): Promise<Array<DeclarationCourse | null>> {
  const historiques = await new EverestClient(supabase).getStatuses(
    courses.map((c) => c.ref),
    correlationId,
  );
  return courses.map((c) => {
    const etape = etapeDeclaree(historiques.get(c.ref) ?? []);
    return etape ? declaration(c.rang, etape) : null;
  });
}

/** Déclarations des coursiers d'une collecte, pour la fiche collecte Admin. */
export async function lireDeclarationsCoursier(
  supabase: SupabaseClient,
  collecteId: string,
  correlationId: string,
): Promise<DeclarationsCoursier> {
  const courses = await coursesALire(supabase, collecteId);
  if (courses === null) return { pris_en_charge: false };
  const lues = await declarationsDesCourses(supabase, courses, correlationId);
  const declarees = lues.filter((d): d is DeclarationCourse => d !== null);
  return {
    pris_en_charge: true,
    courses: declarees.sort((a, b) => a.course - b.course),
    courses_sans_declaration: lues.length - declarees.length,
  };
}

/**
 * Poids du don d'une collecte AG déclaré par ses coursiers →
 * `attributions_antgaspi.poids_repas_kg`. La base en déduit les repas
 * (`trg_calc_volume_repas_realise`) et refait le rapport de don
 * (`trg_regenerer_attestation`), comme après une saisie Admin.
 *
 * Mêmes règles que MTS-1 (décisions Val 2026-11-13, reprises le 2026-11-17) :
 * - plusieurs vélos : la SOMME, écrite seulement quand chaque course non
 *   annulée a un poids ; tant qu'il en manque un, rien ;
 * - l'Admin a le dernier mot : le poids n'est écrit que quand la somme déclarée
 *   change. Mémoire de la dernière somme écrite dans integrations_inbox
 *   (`poids_don_collecte`, même usage que MTS-1), purgée à 7 jours, plus que la
 *   clôture à 48 h, après laquelle plus rien n'est écrit.
 *
 * Rend `true` quand le poids a été écrit. Lève sur une lecture ou une écriture
 * en échec (l'appelant décide de la suite).
 */
export async function releverPoidsDonCoursier(
  supabase: SupabaseClient,
  collecteId: string,
  correlationId: string,
): Promise<boolean> {
  const { data: collecte, error } = await supabase
    .from('collectes')
    .select('type, statut')
    .eq('id', collecteId)
    .maybeSingle();
  if (error) {
    throw new LogistiqueTransientError(
      `Collecte ${collecteId} illisible — ${error.message}`,
    );
  }
  const c = collecte as { type: string; statut: string } | null;
  if (!c || c.type !== 'anti_gaspi' || !STATUTS_POIDS_DON.has(c.statut)) {
    return false;
  }

  const courses = await coursesALire(supabase, collecteId);
  if (!courses || courses.length === 0) return false;
  const lues = await declarationsDesCourses(supabase, courses, correlationId);
  let somme = 0;
  for (const d of lues) {
    if (d?.poids_kg == null) return false;
    somme += d.poids_kg;
  }
  somme = Math.round(somme * 1000) / 1000;

  const cle = `poids_don:${collecteId}`;
  const ecrite = await lireSommeEcrite(supabase, cle);
  if (ecrite !== undefined && Math.abs(ecrite - somme) <= 0.001) return false;

  const { data, error: errMaj } = await supabase
    .from('attributions_antgaspi')
    .update({ poids_repas_kg: somme })
    .eq('collecte_id', collecteId)
    .select('id')
    .maybeSingle();
  if (errMaj) {
    throw new LogistiqueTransientError(
      `Poids du don non écrit (collecte ${collecteId}) — ${errMaj.message}`,
    );
  }
  // Sans attribution, rien n'est noté : le poids s'écrira à la notification
  // suivante.
  if (!data) return false;
  await noterSommeEcrite(supabase, cle, somme);
  return true;
}

const SOURCE = 'everest';
const MEMOIRE = 'poids_don_collecte';

async function lireSommeEcrite(
  supabase: SupabaseClient,
  cle: string,
): Promise<number | undefined> {
  const { data, error } = await supabase
    .from('integrations_inbox')
    .select('payload')
    .eq('source', SOURCE)
    .eq('event_type', MEMOIRE)
    .eq('event_id_externe', cle)
    .maybeSingle();
  if (error) {
    throw new LogistiqueTransientError(
      `Mémoire ${MEMOIRE} illisible — ${error.message}`,
    );
  }
  const valeur = (data as { payload: { valeur?: unknown } | null } | null)
    ?.payload?.valeur;
  return typeof valeur === 'number' ? valeur : undefined;
}

// INSERT nu (index unique partiel : pas d'upsert, cf. CLAUDE.md §2), puis mise
// à jour si la clé existe déjà (23505).
async function noterSommeEcrite(
  supabase: SupabaseClient,
  cle: string,
  valeur: number,
): Promise<void> {
  const maintenant = new Date().toISOString();
  const { error } = await supabase.from('integrations_inbox').insert({
    source: SOURCE,
    event_type: MEMOIRE,
    event_id_externe: cle,
    payload: { valeur },
    traite: true,
    traite_at: maintenant,
  });
  if (!error) return;
  const { error: erreurMaj } =
    error.code === '23505'
      ? await supabase
          .from('integrations_inbox')
          .update({ payload: { valeur }, traite_at: maintenant })
          .eq('source', SOURCE)
          .eq('event_type', MEMOIRE)
          .eq('event_id_externe', cle)
      : { error };
  if (erreurMaj) {
    throw new LogistiqueTransientError(
      `Mémoire ${MEMOIRE} non notée — ${erreurMaj.message}`,
    );
  }
}
