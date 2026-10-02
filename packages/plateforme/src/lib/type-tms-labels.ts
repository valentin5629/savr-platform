// Libellés UI du mode d'envoi d'un transporteur (`transporteurs.type_tms`),
// partagés par la fiche collecte (Bloc 0 dispatch) et le formulaire
// d'attribution AG. Seules références UI aux noms des TMS hors
// packages/adapters/ — fichier allowlisté (scripts/coupling-allowlist.txt),
// aucun appel ni couplage : du texte pour l'Admin.

// Bouton d'envoi TMS forké par type_tms (§06.06 §3 « Spec V1 fork » : MTS-1 pour
// Strike/Marathon, A Toutes! pour le vélo cargo, manuel sinon).
export function libelleDispatch(
  typeTms: string | null | undefined,
  dejaEnvoye: boolean,
): string {
  const verbe = dejaEnvoye ? 'Renvoyer' : 'Envoyer';
  if (typeTms === 'mts1') return `${verbe} à MTS-1`;
  if (typeTms === 'a_toutes') return `${verbe} à A Toutes!`;
  return 'Dispatcher (manuel)';
}

// Mode d'envoi du transporteur en clair sur une carte / une option de liste.
export function libelleTypeTms(typeTms: string | null | undefined): string {
  if (typeTms === 'mts1') return 'Envoi MTS-1';
  if (typeTms === 'a_toutes') return 'A Toutes! · vélo cargo';
  if (typeTms === 'par_mail') return 'Dispatch par email';
  if (typeTms === 'par_telephone') return 'Dispatch par téléphone';
  return 'Dispatch manuel';
}

// L'ordre part-il automatiquement chez le prestataire (adapter) ou par un
// dispatch manuel (mail / téléphone / autre) ?
export function envoiAutomatique(typeTms: string | null | undefined): boolean {
  return typeTms === 'mts1' || typeTms === 'a_toutes';
}

// Nom du canal d'un envoi automatique (texte Admin de la fiche collecte :
// bloc « ordre en file d'envoi », bloc « Chauffeur »). Manuel → null.
export function libelleCanalEnvoi(
  typeTms: string | null | undefined,
): string | null {
  if (typeTms === 'mts1') return 'MTS-1';
  if (typeTms === 'a_toutes') return 'A Toutes!';
  return null;
}

// Bouton unique « valider l'attribution + envoyer » (décision Val 2026-10-01) :
// la validation d'attribution AG EST la décision de dispatch (§06.09 §3).
export function libelleValiderEtEnvoyer(
  typeTms: string | null | undefined,
): string {
  if (!typeTms) return "Valider l'attribution";
  if (typeTms === 'mts1') return 'Valider et envoyer à MTS-1';
  if (typeTms === 'a_toutes') return 'Valider et envoyer à A Toutes!';
  return 'Valider et dispatcher (manuel)';
}
