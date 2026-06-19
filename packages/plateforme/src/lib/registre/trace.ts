import type { SupabaseClient } from '@savr/shared/src/supabase-client.js';
import type { RegistreFilters } from './registre.js';

// Traçabilité des exports (§04 exports_registre) : chaque export client est
// enregistré (qui, quoi, quand, filtres). Le staff (organisation_id null,
// périmètre global) n'est PAS tracé ici — exports_registre.organisation_id est
// NOT NULL et la policy er_insert exige organisation_id = jwt org ; les actions
// staff relèvent de l'audit_log.

export interface TraceParams {
  userId: string;
  organisationId: string | null;
  isStaff: boolean;
  typeExport: 'registre_dechets' | 'bordereaux_batch';
  format: 'csv' | 'zip';
  nbLignes: number;
  filters: RegistreFilters;
  /** Dates des lignes exportées — sert à dériver la période si pas de filtre. */
  dates: (string | null)[];
  now: Date;
}

export async function traceExport(
  supabase: SupabaseClient,
  p: TraceParams,
): Promise<void> {
  if (p.isStaff || !p.organisationId) return;

  const today = p.now.toISOString().slice(0, 10);
  const sorted = p.dates.filter((d): d is string => !!d).sort();
  const debut = p.filters.from ?? sorted[0] ?? today;
  let fin = p.filters.to ?? sorted[sorted.length - 1] ?? today;
  if (fin < debut) fin = debut;

  await supabase.from('exports_registre').insert({
    organisation_id: p.organisationId,
    user_id: p.userId,
    periode_debut: debut,
    periode_fin: fin,
    nb_lignes: p.nbLignes,
    type_export: p.typeExport,
    format: p.format,
    filtres_appliques: {
      lieu_ids: p.filters.lieuIds,
      traiteur_ids: p.filters.traiteurIds,
      flux_codes: p.filters.fluxCodes,
      bordereau: p.filters.bordereauStatut ?? null,
    },
  });
}
