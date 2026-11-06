/**
 * Échappe un texte destiné au corps HTML d'un email. Le moteur d'interpolation
 * (`interpolate`) insère les variables telles quelles : tout texte saisi par un
 * utilisateur passe par ici avant d'entrer dans une variable.
 */
export const escapeHtml = (v: string): string =>
  v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
