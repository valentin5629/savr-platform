import { createAdminSupabaseClient } from '../supabase-client.js';

// Ligne plateforme.integrations_logs — colonnes RÉELLES (migration Bloc 7
// 20260611171641, divergence assumée du DDL cible A6 / BLOC7_20260624). Volontairement
// SANS colonne d'en-têtes : la table ne porte pas de `request_headers`, aucun Bearer
// (INSEE) n'est donc jamais journalisé (§04 l.2323 « Sans Authorization ni secret » —
// ici garanti par omission). `correlation_id` = référence métier vérifiée (SIRET / TVA),
// strict nécessaire à la corrélation Ops sur une table lue par le staff seul (RLS DENY ALL).
export interface IntegrationLogEntry {
  integration: string; // 'insee' | 'vies' | 'pennylane' | 'resend' | <adapters logistiques>…
  direction: 'sortant' | 'entrant';
  methode: string;
  endpoint: string;
  statut_http: number | null;
  duree_ms: number;
  correlation_id: string | null;
  erreur: string | null;
}

// Journalise un appel tiers dans integrations_logs. BEST-EFFORT : l'observabilité ne
// fait JAMAIS échouer le flux appelant (try/catch silencieux — createAdminSupabaseClient
// peut throw hors environnement serveur). Écriture service_role (RLS DENY ALL, lecture
// réservée au staff), sur le modèle de logPennylane()/log() des adapters logistiques.
export async function logIntegration(
  entry: IntegrationLogEntry,
): Promise<void> {
  try {
    const supabase = createAdminSupabaseClient();
    await supabase.from('integrations_logs').insert(entry);
  } catch {
    /* jamais bloquant */
  }
}
