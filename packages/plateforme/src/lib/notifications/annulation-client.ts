import type { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { sendEmail } from '@savr/shared/src/email/index.js';
import { escapeHtml } from '@savr/shared/src/email/html.js';
import { formatDateParis } from '@savr/shared/src/temps/index.js';
import { heureCourte } from '@/lib/exports/shared';

type AdminSupabase = ReturnType<typeof createAdminSupabaseClient>;

export interface Compte {
  email: string;
  prenom: string;
  /** « Prénom Nom », ou l'email quand la personne n'a ni prénom ni nom. */
  nomComplet: string;
}

/** Lit l'email, le prénom et le nom d'un utilisateur ; null s'il est introuvable. */
export async function lireCompte(
  admin: AdminSupabase,
  userId: string | null | undefined,
): Promise<Compte | null> {
  if (!userId) return null;
  const { data } = await admin
    .from('users')
    .select('email, prenom, nom')
    .eq('id', userId)
    .maybeSingle();
  const u = data as {
    email?: string | null;
    prenom?: string | null;
    nom?: string | null;
  } | null;
  if (!u) return null;
  const email = u.email ?? '';
  const prenom = u.prenom?.trim() ?? '';
  const nom = [prenom, u.nom?.trim()].filter(Boolean).join(' ');
  return { email, prenom, nomComplet: nom || email };
}

/**
 * Template 5 (`annulation_collecte`, §06.02 §5) : confirmation d'annulation au
 * programmateur de la collecte (créateur de l'événement), comme sur le chemin
 * Admin. Sans adresse résoluble, rien n'est envoyé. Pas de phrase de
 * facturation (Val 2026-10-29) : l'équipe Savr est prévenue par le tpl 22.
 */
export async function envoyerConfirmationAnnulation(
  admin: AdminSupabase,
  params: {
    programmateurId: string | null | undefined;
    dateCollecte: string;
    heureCollecte?: string | null;
    lieuNom: string;
    nomEvenement?: string | null;
    motif: string;
  },
): Promise<void> {
  const prog = await lireCompte(admin, params.programmateurId);
  if (!prog?.email) return;
  // Le corps est du HTML interpolé tel quel : le texte saisi est échappé.
  await sendEmail('annulation_collecte', prog.email, {
    prenom: escapeHtml(prog.prenom),
    date_collecte: formatDateParis(params.dateCollecte),
    heure_collecte: heureCourte(params.heureCollecte),
    lieu_nom: escapeHtml(params.lieuNom),
    nom_evenement: escapeHtml((params.nomEvenement ?? '').trim()),
    motif: escapeHtml(params.motif),
  });
}
