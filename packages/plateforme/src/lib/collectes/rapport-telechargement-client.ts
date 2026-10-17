'use client';

// Téléchargement, côté navigateur, du rapport de recyclage ZD fabriqué au clic
// (décision Val 2026-10-16) : la route répond par le PDF lui-même, qu'on enregistre
// sous le nom qu'elle donne. Commun aux espaces clients, à l'Admin et au client
// organisateur.

export const ECHEC_FABRICATION =
  'La fabrication du rapport a échoué. Réessayez dans un instant.';

/** Corps de la demande : le choix du radar et, s'il est coché, ses filtres. */
export interface DemandeRapport {
  options: { benchmark: boolean };
  benchmark_filters?: {
    lieu_ids: string[];
    type_evenement_ids: string[];
    taille_evenement_codes: string[];
  };
}

/**
 * Fabrique et enregistre le rapport. Rend `null` si le PDF est parti, sinon le
 * message à afficher : le motif écrit par le serveur pour un refus (4xx),
 * l'échec générique sinon.
 */
export async function telechargerRapportRecyclage(
  url: string,
  demande?: DemandeRapport,
): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: demande ? 'POST' : 'GET',
      ...(demande
        ? {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(demande),
          }
        : {}),
    });
  } catch {
    return ECHEC_FABRICATION;
  }
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: unknown };
    return res.status >= 400 && res.status < 500 && typeof j.error === 'string'
      ? j.error
      : ECHEC_FABRICATION;
  }
  return (await enregistrerReponsePdf(res)) ? null : ECHEC_FABRICATION;
}

/** Enregistre le PDF d'une réponse sous le nom qu'elle donne. `false` si illisible. */
export async function enregistrerReponsePdf(res: Response): Promise<boolean> {
  try {
    const blob = await res.blob();
    const nom =
      /filename="([^"]+)"/.exec(
        res.headers.get('Content-Disposition') ?? '',
      )?.[1] ?? 'rapport-recyclage.pdf';
    const lien = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = lien;
    a.download = nom;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Laisser le navigateur ouvrir le téléchargement avant de libérer l'objet.
    setTimeout(() => URL.revokeObjectURL(lien), 30_000);
    return true;
  } catch {
    return false;
  }
}
