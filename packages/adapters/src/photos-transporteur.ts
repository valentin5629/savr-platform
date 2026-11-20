// Photos prises par le livreur, relues chez le transporteur à la demande de
// l'Admin : A Toute! (décision Val 2026-11-03) et MTS-1 (décision Val
// 2026-11-20, qui retire le rangement automatique à la relève). L'Admin les
// affiche dans la fiche collecte et n'importe que celles qu'il retient : rien
// n'est stocké sans son choix.
//
// Point d'entrée neutre pour le code métier (garde-fou 3) : la route Admin ne
// connaît ni le transporteur ni son API.
//
// Une photo importée arrive NON cochée « Visible du client » (décision Val
// 2026-11-03).

import { createHash } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { logger } from '@savr/shared/src/logger/index.js';
import { uploadObject } from '@savr/shared/src/r2/upload.js';

import { EverestClient } from './everest/client.js';
import type { TypeTms } from './index.js';
import { photosDeLaCommandeMts1 } from './mts1/adapter.js';
import { Mts1Client } from './mts1/client.js';
import {
  prestatairesDuType,
  retenirTourneesDuProvider,
  type TourneeProvider,
} from './provider-tournees.js';

const ENTITE_COLLECTE = 'plateforme.collectes';

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Transporteurs dont les photos du livreur se relisent. */
type TypePhotos = Extract<TypeTms, 'a_toutes' | 'mts1'>;

function lisLesPhotos(typeTms: string | null): typeTms is TypePhotos {
  return typeTms === 'a_toutes' || typeTms === 'mts1';
}

/** Une photo du livreur proposée à l'Admin. */
export interface PhotoTransporteur {
  /** Identifiant opaque, stable : empreinte de la course et de la photo. */
  id: string;
  /**
   * Adresse de l'image chez le transporteur, quand le navigateur peut la lire
   * (A Toute!). `null` : l'aperçu passe par Savr (MTS-1 exige sa clé d'API,
   * cf. `apercuPhotoTransporteur`).
   */
  url: string | null;
  prise_le: string | null;
  /** Rang de la course (camion ou vélo) qui l'a prise. */
  course: number;
  deja_importee: boolean;
}

export type PhotosTransporteur =
  | { pris_en_charge: false }
  | {
      pris_en_charge: true;
      photos: PhotoTransporteur[];
      /** Courses que le transporteur n'a pas pu rendre (les autres s'affichent). */
      courses_illisibles: number;
    };

export interface ResultatImport {
  importees: number;
  deja_importees: number;
  echecs: number;
  /** Non tentées faute de temps : à relancer. */
  restantes: number;
}

// La route est coupée à 60 s : aucun téléchargement ne démarre après 35 s
// (un téléchargement peut durer 30 s), le reste est rendu « à relancer ».
const BUDGET_IMPORT_MS = 35_000;

/** L'id d'une photo inconnue du transporteur (sélection périmée ou forgée). */
export class PhotoTransporteurInconnueError extends Error {
  override readonly name = 'PhotoTransporteurInconnueError';
}

// Photo lue, avec de quoi la télécharger (jamais rendu au navigateur).
interface PhotoLue extends PhotoTransporteur {
  telechargement: string;
}

type Lecture =
  | { pris_en_charge: false }
  | {
      pris_en_charge: true;
      typeTms: TypePhotos;
      photos: PhotoLue[];
      courses_illisibles: number;
    };

// Même principe que les photos MTS-1 : la clé ne montre aucun identifiant du
// transporteur, elle est déterministe (la recherche de doublon la lit).
function empreinteEverest(ref: string, mediaId: string): string {
  return createHash('sha256')
    .update(JSON.stringify(['a_toutes', ref, mediaId]))
    .digest('hex');
}

function prefixe(collecteId: string): string {
  return `photos/collectes/${collecteId}/`;
}

export async function transporteurDeLaCollecte(
  supabase: SupabaseClient,
  collecteId: string,
): Promise<string | null> {
  const { data: collecte, error } = await supabase
    .from('collectes')
    .select('prestataire_logistique_id')
    .eq('id', collecteId)
    .maybeSingle();
  if (error) throw new Error(`collecte illisible : ${error.message}`);
  const prestataireId = (
    collecte as { prestataire_logistique_id: string | null } | null
  )?.prestataire_logistique_id;
  // Sans prestataire : le transporteur de l'attribution AG validée, comme la
  // fiche collecte Admin qui décide d'ouvrir cette fenêtre.
  if (!prestataireId) return transporteurDeLAttribution(supabase, collecteId);
  const { data: transporteur, error: errT } = await supabase
    .from('transporteurs')
    .select('type_tms')
    .eq('prestataire_logistique_id', prestataireId)
    .maybeSingle();
  if (errT) throw new Error(`transporteur illisible : ${errT.message}`);
  return (transporteur as { type_tms: string } | null)?.type_tms ?? null;
}

async function transporteurDeLAttribution(
  supabase: SupabaseClient,
  collecteId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('attributions_antgaspi')
    .select('valide_at, transporteurs!transporteur_id(type_tms)')
    .eq('collecte_id', collecteId)
    .maybeSingle();
  if (error) throw new Error(`attribution illisible : ${error.message}`);
  type T = { type_tms: string };
  const att = data as {
    valide_at: string | null;
    transporteurs: T | T[] | null;
  } | null;
  if (!att?.valide_at) return null;
  const t = Array.isArray(att.transporteurs)
    ? att.transporteurs[0]
    : att.transporteurs;
  return t?.type_tms ?? null;
}

type TourneeLue = TourneeProvider & { tms_reference: string | null };

export async function tourneesALire(
  supabase: SupabaseClient,
  collecteId: string,
  typeTms: TypePhotos = 'a_toutes',
): Promise<TourneeLue[]> {
  // Le rang est porté par le lien collecte ↔ tournée, pas par la tournée.
  // borne-par-nature: une ligne par camion de la collecte (quelques unités).
  const { data, error } = await supabase
    .from('collecte_tournees')
    .select(
      'rang, tournees!inner(id, statut, external_ref_commande, prestataire_logistique_id, tms_reference)',
    )
    .eq('collecte_id', collecteId);
  if (error) throw new Error(`tournées illisibles : ${error.message}`);
  type Tournee = Omit<TourneeLue, 'rang'>;
  const tournees: TourneeLue[] = (
    (data ?? []) as Array<{
      rang: number;
      tournees: Tournee | Tournee[] | null;
    }>
  ).flatMap((l) => {
    const t = Array.isArray(l.tournees) ? l.tournees[0] : l.tournees;
    return t ? [{ ...t, rang: l.rang }] : [];
  });
  // Même cloisonnement que l'adapter : une tournée résiduelle vivante d'un autre
  // transporteur lève l'alerte Ops habituelle (idempotente), voulu ici aussi.
  const prestataires = await prestatairesDuType(supabase, typeTms);
  const retenues = await retenirTourneesDuProvider({
    supabase,
    typeTms,
    prestataires,
    collecteId,
    tournees,
  });
  return retenues
    .filter((t) => typeof t.external_ref_commande === 'string')
    .sort((a, b) => a.rang - b.rang);
}

async function clesDejaImportees(
  supabase: SupabaseClient,
  collecteId: string,
): Promise<Set<string>> {
  // borne-par-nature: les photos d'une seule collecte (quelques dizaines).
  const { data, error } = await supabase
    .schema('shared')
    .from('fichiers')
    .select('key')
    .eq('entity_type', ENTITE_COLLECTE)
    .eq('entity_id', collecteId)
    .is('deleted_at', null)
    .like('key', `${prefixe(collecteId)}%`);
  if (error) throw new Error(`photos illisibles : ${error.message}`);
  // Nom de l'objet jusqu'au premier point = empreinte de la photo (une photo
  // recadrée garde l'empreinte de son original : `<empreinte>.jpg.recadree.jpg`).
  return new Set(
    ((data ?? []) as Array<{ key: string }>).map(
      (f) => f.key.slice(prefixe(collecteId).length).split('.')[0] as string,
    ),
  );
}

// Photos d'une course. Lève si le transporteur ne rend pas la course.
async function photosDUneCourse(
  supabase: SupabaseClient,
  typeTms: TypePhotos,
  t: TourneeLue,
  correlationId: string,
): Promise<Array<Omit<PhotoLue, 'deja_importee'>>> {
  const ref = t.external_ref_commande as string;
  if (typeTms === 'mts1') {
    const photos = await photosDeLaCommandeMts1(
      new Mts1Client(supabase),
      ref,
      t.tms_reference,
    );
    return photos.map((p) => ({
      id: p.empreinte,
      url: null,
      prise_le: null,
      course: t.rang,
      telechargement: p.downloadUrl,
    }));
  }
  const mission = await new EverestClient(supabase).getMission(
    ref,
    correlationId,
  );
  return (mission.photos ?? []).map((p) => ({
    id: empreinteEverest(ref, p.id),
    url: p.src,
    prise_le: p.prise_le,
    course: t.rang,
    telechargement: p.src,
  }));
}

async function lirePhotos(
  supabase: SupabaseClient,
  collecteId: string,
  correlationId: string,
): Promise<Lecture> {
  const typeTms = await transporteurDeLaCollecte(supabase, collecteId);
  if (!lisLesPhotos(typeTms)) return { pris_en_charge: false };

  const tournees = await tourneesALire(supabase, collecteId, typeTms);
  const deja = await clesDejaImportees(supabase, collecteId);
  const photos: PhotoLue[] = [];
  const vues = new Set<string>();
  let coursesIllisibles = 0;
  for (const t of tournees) {
    // Une course illisible n'empêche pas de montrer les photos des autres.
    let lues;
    try {
      lues = await photosDUneCourse(supabase, typeTms, t, correlationId);
    } catch (err) {
      coursesIllisibles++;
      logger.warn('adapters.photos_transporteur.course_illisible', {
        collecte_id: collecteId,
        rang: t.rang,
        correlation_id: correlationId,
        erreur: err instanceof Error ? err.name : 'inconnue',
      });
      continue;
    }
    for (const p of lues) {
      // Deux camions regroupés sur un même tour MTS-1 : une photo, une fois.
      if (vues.has(p.id)) continue;
      vues.add(p.id);
      photos.push({ ...p, deja_importee: deja.has(p.id) });
    }
  }
  return {
    pris_en_charge: true,
    typeTms,
    photos,
    courses_illisibles: coursesIllisibles,
  };
}

function sansTelechargement(p: PhotoLue): PhotoTransporteur {
  return {
    id: p.id,
    url: p.url,
    prise_le: p.prise_le,
    course: p.course,
    deja_importee: p.deja_importee,
  };
}

/** Photos du livreur d'une collecte, relues chez son transporteur. */
export async function listerPhotosTransporteur(
  supabase: SupabaseClient,
  collecteId: string,
  correlationId: string,
): Promise<PhotosTransporteur> {
  const lu = await lirePhotos(supabase, collecteId, correlationId);
  if (!lu.pris_en_charge) return lu;
  return {
    pris_en_charge: true,
    photos: lu.photos.map(sansTelechargement),
    courses_illisibles: lu.courses_illisibles,
  };
}

// Téléchargement d'une photo choisie. `null` : le transporteur n'a rien rendu.
async function telecharger(
  supabase: SupabaseClient,
  typeTms: TypePhotos,
  photo: PhotoLue,
): Promise<{ contenu: Buffer; content_type: string } | null> {
  if (typeTms === 'mts1') {
    const contenu = await new Mts1Client(supabase).downloadPhoto(
      photo.telechargement,
    );
    return contenu ? { contenu, content_type: 'image/jpeg' } : null;
  }
  return new EverestClient(supabase).downloadPhoto(photo.telechargement);
}

// Aperçus MTS-1 : la fenêtre en demande un par photo, en même temps. La liste
// relue est gardée une minute par instance, pour ne pas relire le tour chez
// MTS-1 à chaque image.
const DUREE_LISTE_APERCU_MS = 60_000;
const listesApercu = new Map<
  string,
  { expire: number; lecture: Promise<Lecture> }
>();

function lectureApercu(
  supabase: SupabaseClient,
  collecteId: string,
  correlationId: string,
): Promise<Lecture> {
  const maintenant = Date.now();
  for (const [cle, l] of listesApercu) {
    if (l.expire <= maintenant) listesApercu.delete(cle);
  }
  const gardee = listesApercu.get(collecteId);
  if (gardee) return gardee.lecture;
  const lecture = lirePhotos(supabase, collecteId, correlationId);
  listesApercu.set(collecteId, {
    expire: maintenant + DUREE_LISTE_APERCU_MS,
    lecture,
  });
  lecture.catch(() => listesApercu.delete(collecteId));
  return lecture;
}

/** Pour les tests : oublie les listes gardées pour les aperçus. */
export function _viderListesApercu(): void {
  listesApercu.clear();
}

/**
 * Image d'une photo du livreur, pour l'aperçu dans la fenêtre de choix, sans
 * rien stocker. L'id doit désigner une photo de la collecte (jamais une adresse
 * venue du navigateur). `null` : photo inconnue, ou que le transporteur ne rend
 * pas.
 */
export async function apercuPhotoTransporteur(
  supabase: SupabaseClient,
  opts: { collecteId: string; id: string; correlationId: string },
): Promise<{ contenu: Buffer; content_type: string } | null> {
  const lu = await lectureApercu(supabase, opts.collecteId, opts.correlationId);
  if (!lu.pris_en_charge) return null;
  const photo = lu.photos.find((p) => p.id === opts.id);
  if (!photo) return null;
  return telecharger(supabase, lu.typeTms, photo);
}

/**
 * Importe les photos choisies : relues chez le transporteur (jamais une adresse
 * venue du navigateur), téléchargées, déposées sur R2 puis enregistrées non
 * choisies pour le client. Une photo déjà importée est sautée.
 * Lève `PhotoTransporteurInconnueError` si un id n'est pas une photo de la
 * collecte : rien n'est importé.
 */
export async function importerPhotosTransporteur(
  supabase: SupabaseClient,
  opts: {
    collecteId: string;
    ids: string[];
    userId: string;
    correlationId: string;
  },
): Promise<ResultatImport & { pris_en_charge: boolean }> {
  const { collecteId, ids, userId, correlationId } = opts;
  const debut = Date.now();
  const lu = await lirePhotos(supabase, collecteId, correlationId);
  if (!lu.pris_en_charge) {
    return {
      pris_en_charge: false,
      importees: 0,
      deja_importees: 0,
      echecs: 0,
      restantes: 0,
    };
  }
  const parId = new Map(lu.photos.map((p) => [p.id, p]));
  const inconnues = ids.filter((id) => !parId.has(id));
  if (inconnues.length > 0) {
    throw new PhotoTransporteurInconnueError(
      `${inconnues.length} photo(s) inconnue(s) du transporteur`,
    );
  }

  const resultat: ResultatImport = {
    importees: 0,
    deja_importees: 0,
    echecs: 0,
    restantes: 0,
  };
  for (const id of new Set(ids)) {
    const photo = parId.get(id) as PhotoLue;
    if (photo.deja_importee) {
      resultat.deja_importees++;
      continue;
    }
    if (Date.now() - debut > BUDGET_IMPORT_MS) {
      resultat.restantes++;
      continue;
    }
    try {
      const telechargee = await telecharger(supabase, lu.typeTms, photo);
      if (!telechargee) throw new Error('photo absente chez le transporteur');
      const { contenu, content_type } = telechargee;
      const key = `${prefixe(collecteId)}${id}.${EXTENSIONS[content_type] ?? 'jpg'}`;
      // R2 d'abord, la ligne ensuite : jamais de ligne vers un objet absent.
      const { bucket } = await uploadObject(key, contenu, content_type);
      const { error } = await supabase
        .schema('shared')
        .from('fichiers')
        .insert({
          storage_provider: 'r2',
          bucket,
          key,
          content_type,
          size_bytes: contenu.length,
          entity_type: ENTITE_COLLECTE,
          entity_id: collecteId,
          created_by: userId,
          rang_client: null,
        });
      // 23505 : un import simultané l'a enregistrée à l'instant (index
      // uniq_fichiers_objet_vivant) ; elle est là, une seule fois.
      if (error?.code === '23505') {
        resultat.deja_importees++;
        continue;
      }
      if (error) throw new Error(error.message);
      resultat.importees++;
    } catch (err) {
      resultat.echecs++;
      // Ni l'adresse ni le contenu : l'empreinte suffit à retrouver la photo.
      logger.warn('adapters.photos_transporteur.import_echoue', {
        collecte_id: collecteId,
        photo: id,
        correlation_id: correlationId,
        erreur:
          err instanceof Error ? `${err.name}: ${err.message}` : 'inconnue',
      });
    }
  }
  return { pris_en_charge: true, ...resultat };
}
