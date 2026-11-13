// Photos prises par le livreur, relues chez le transporteur (décision Val
// 2026-11-03). Seul A Toute! les expose aujourd'hui : l'Admin les voit dans la
// fiche collecte et importe celles qu'il garde. MTS-1 n'est pas concerné, ses
// photos arrivent seules à la relève (`sync`).
//
// Point d'entrée neutre pour le code métier (garde-fou 3) : la route Admin ne
// connaît ni le transporteur ni son API.
//
// Une photo importée arrive NON cochée « Visible du client » (décision Val
// 2026-11-03), comme une photo remontée par MTS-1.

import { createHash } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { logger } from '@savr/shared/src/logger/index.js';
import { uploadObject } from '@savr/shared/src/r2/upload.js';

import { EverestClient } from './everest/client.js';
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

/** Une photo du livreur proposée à l'Admin. */
export interface PhotoTransporteur {
  /** Identifiant opaque, stable : empreinte de la course et de la photo. */
  id: string;
  /** Adresse de l'image chez le transporteur (aperçu). */
  url: string;
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

// Même principe que les photos MTS-1 : la clé ne montre aucun identifiant du
// transporteur, elle est déterministe (la recherche de doublon la lit).
function empreinte(ref: string, mediaId: string): string {
  return createHash('sha256')
    .update(JSON.stringify(['a_toutes', ref, mediaId]))
    .digest('hex');
}

function prefixe(collecteId: string): string {
  return `photos/collectes/${collecteId}/`;
}

async function transporteurDeLaCollecte(
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

async function tourneesALire(
  supabase: SupabaseClient,
  collecteId: string,
): Promise<TourneeProvider[]> {
  // Le rang est porté par le lien collecte ↔ tournée, pas par la tournée.
  const { data, error } = await supabase
    .from('collecte_tournees')
    .select(
      'rang, tournees!inner(id, statut, external_ref_commande, prestataire_logistique_id)',
    )
    .eq('collecte_id', collecteId);
  if (error) throw new Error(`tournées illisibles : ${error.message}`);
  type Tournee = Omit<TourneeProvider, 'rang'>;
  const tournees: TourneeProvider[] = (
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
  const prestataires = await prestatairesDuType(supabase, 'a_toutes');
  const retenues = await retenirTourneesDuProvider({
    supabase,
    typeTms: 'a_toutes',
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
  const { data, error } = await supabase
    .schema('shared')
    .from('fichiers')
    .select('key')
    .eq('entity_type', ENTITE_COLLECTE)
    .eq('entity_id', collecteId)
    .is('deleted_at', null)
    .like('key', `${prefixe(collecteId)}%`);
  if (error) throw new Error(`photos illisibles : ${error.message}`);
  // Nom de l'objet sans extension = empreinte de la photo.
  return new Set(
    ((data ?? []) as Array<{ key: string }>).map((f) =>
      f.key.slice(prefixe(collecteId).length).replace(/\.[a-z]+$/, ''),
    ),
  );
}

async function lirePhotos(
  supabase: SupabaseClient,
  collecteId: string,
  correlationId: string,
): Promise<
  | { pris_en_charge: false }
  | {
      pris_en_charge: true;
      photos: PhotoTransporteur[];
      courses_illisibles: number;
    }
> {
  const typeTms = await transporteurDeLaCollecte(supabase, collecteId);
  if (typeTms !== 'a_toutes') return { pris_en_charge: false };

  const tournees = await tourneesALire(supabase, collecteId);
  const deja = await clesDejaImportees(supabase, collecteId);
  const client = new EverestClient(supabase);
  const photos: PhotoTransporteur[] = [];
  let coursesIllisibles = 0;
  for (const t of tournees) {
    const ref = t.external_ref_commande as string;
    // Une course illisible n'empêche pas de montrer les photos des autres.
    let mission;
    try {
      mission = await client.getMission(ref, correlationId);
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
    for (const p of mission.photos ?? []) {
      const id = empreinte(ref, p.id);
      photos.push({
        id,
        url: p.src,
        prise_le: p.prise_le,
        course: t.rang,
        deja_importee: deja.has(id),
      });
    }
  }
  return {
    pris_en_charge: true,
    photos,
    courses_illisibles: coursesIllisibles,
  };
}

/** Photos du livreur d'une collecte, relues chez son transporteur. */
export async function listerPhotosTransporteur(
  supabase: SupabaseClient,
  collecteId: string,
  correlationId: string,
): Promise<PhotosTransporteur> {
  return lirePhotos(supabase, collecteId, correlationId);
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

  const client = new EverestClient(supabase);
  const resultat: ResultatImport = {
    importees: 0,
    deja_importees: 0,
    echecs: 0,
    restantes: 0,
  };
  for (const id of new Set(ids)) {
    const photo = parId.get(id) as PhotoTransporteur;
    if (photo.deja_importee) {
      resultat.deja_importees++;
      continue;
    }
    if (Date.now() - debut > BUDGET_IMPORT_MS) {
      resultat.restantes++;
      continue;
    }
    try {
      const { contenu, content_type } = await client.downloadPhoto(photo.url);
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
