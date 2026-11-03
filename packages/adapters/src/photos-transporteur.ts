// Photos prises par le livreur, relues chez le transporteur (décision Val
// 2026-11-03). Seul A Toutes! les expose aujourd'hui : l'Admin les voit dans la
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
  | { pris_en_charge: true; photos: PhotoTransporteur[] };

export interface ResultatImport {
  importees: number;
  deja_importees: number;
  echecs: number;
}

/** L'id d'une photo inconnue du transporteur (sélection périmée ou forgée). */
export class PhotoTransporteurInconnueError extends Error {
  override readonly name = 'PhotoTransporteurInconnueError';
}

type PhotoInterne = PhotoTransporteur & { src: string };

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
  if (!prestataireId) return null;
  const { data: transporteur, error: errT } = await supabase
    .from('transporteurs')
    .select('type_tms')
    .eq('prestataire_logistique_id', prestataireId)
    .maybeSingle();
  if (errT) throw new Error(`transporteur illisible : ${errT.message}`);
  return (transporteur as { type_tms: string } | null)?.type_tms ?? null;
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
  { pris_en_charge: false } | { pris_en_charge: true; photos: PhotoInterne[] }
> {
  const typeTms = await transporteurDeLaCollecte(supabase, collecteId);
  if (typeTms !== 'a_toutes') return { pris_en_charge: false };

  const tournees = await tourneesALire(supabase, collecteId);
  const deja = await clesDejaImportees(supabase, collecteId);
  const client = new EverestClient(supabase);
  const photos: PhotoInterne[] = [];
  for (const t of tournees) {
    const ref = t.external_ref_commande as string;
    const mission = await client.getMission(ref, correlationId);
    for (const p of mission.photos ?? []) {
      const id = empreinte(ref, p.id);
      photos.push({
        id,
        url: p.src,
        src: p.src,
        prise_le: p.prise_le,
        course: t.rang,
        deja_importee: deja.has(id),
      });
    }
  }
  return { pris_en_charge: true, photos };
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
    photos: lu.photos.map(({ src: _src, ...p }) => p),
  };
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
  const lu = await lirePhotos(supabase, collecteId, correlationId);
  if (!lu.pris_en_charge) {
    return {
      pris_en_charge: false,
      importees: 0,
      deja_importees: 0,
      echecs: 0,
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
  };
  for (const id of new Set(ids)) {
    const photo = parId.get(id) as PhotoInterne;
    if (photo.deja_importee) {
      resultat.deja_importees++;
      continue;
    }
    try {
      const { contenu, content_type } = await client.downloadPhoto(photo.src);
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
      if (error) throw new Error(error.message);
      resultat.importees++;
    } catch {
      resultat.echecs++;
    }
  }
  return { pris_en_charge: true, ...resultat };
}
