import type { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { sendEmail } from '@savr/shared/src/email/index.js';
import { escapeHtml } from '@savr/shared/src/email/html.js';
import { formatDateParis } from '@savr/shared/src/temps/index.js';
import { heureCourte } from '@/lib/exports/shared';
import {
  estAnnulationTardive,
  infoFacturationAnnulation,
  instantReferenceAnnulation,
} from '@/lib/notifications/traiteur-operationnel.js';

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
 * Admin. Sans adresse résoluble, rien n'est envoyé.
 *
 * Annulation tardive (moins de 4 h avant le créneau, CDC §05) : une phrase dit
 * ce qui est facturé. Une demande d'annulation confirmée par l'Admin se juge à
 * l'heure de la demande (`statutAvant` + `annulationDemandeeAt`).
 */
export async function envoyerConfirmationAnnulation(
  admin: AdminSupabase,
  params: {
    programmateurId: string | null | undefined;
    dateCollecte: string;
    heureCollecte?: string | null;
    lieuNom: string;
    nomEvenement?: string | null;
    typeCollecte?: string | null;
    motif: string;
    statutAvant?: string | null;
    annulationDemandeeAt?: string | null;
    nowMs?: number;
    /** Phrase de facturation imposée (incident) ; sinon, règle des 4 h. */
    infoFacturation?: string;
  },
): Promise<void> {
  const prog = await lireCompte(admin, params.programmateurId);
  if (!prog?.email) return;
  const tardive = estAnnulationTardive(
    params.dateCollecte,
    params.heureCollecte,
    instantReferenceAnnulation(
      params.statutAvant,
      params.annulationDemandeeAt,
      params.nowMs ?? Date.now(),
    ),
  );
  // Le corps est du HTML interpolé tel quel : le texte saisi est échappé.
  await sendEmail('annulation_collecte', prog.email, {
    prenom: escapeHtml(prog.prenom),
    date_collecte: formatDateParis(params.dateCollecte),
    heure_collecte: heureCourte(params.heureCollecte),
    lieu_nom: escapeHtml(params.lieuNom),
    nom_evenement: escapeHtml((params.nomEvenement ?? '').trim()),
    motif: escapeHtml(params.motif),
    info_facturation: escapeHtml(
      params.infoFacturation ??
        infoFacturationAnnulation(params.typeCollecte, tardive),
    ),
  });
}
