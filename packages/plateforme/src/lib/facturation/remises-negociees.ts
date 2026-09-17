// Remises négociées éligibles à une collecte — couche remise de la résolution du
// prix (05 - Règles métier §« Tarifs et remises — résolution du prix », étape 3) :
//   - scope=organisation : `organisation_id` = organisation programmatrice ;
//   - scope=gestionnaire : `gestionnaire_organisation_id` = gestionnaire du lieu
//     de l'événement (via `organisations_lieux`), `lieu_id` = ce lieu OU null
//     (null = tous les lieux du gestionnaire), quel que soit le traiteur.
// Pas de cumul (arbitrage Val 2026-09-17, diverge du « cumul multiplicatif » §05) :
// parmi toutes les remises éligibles, seule la plus élevée s'applique —
// prix = base × (1 − max(remise_pct)).
//
// Une erreur de lecture est levée (jamais avalée) : ignorer une remise éligible
// facturerait plein tarif sans signal. Les appelants rattrapent déjà par collecte.

import type { SupabaseClient } from '@savr/shared/src/supabase-client.js';

export async function facteurRemisesNegociees(
  supabase: SupabaseClient,
  params: {
    activite: 'zd' | 'ag';
    organisationId: string | null;
    lieuId: string | null;
    dateStr: string;
  },
): Promise<number> {
  const { activite, organisationId, lieuId, dateStr } = params;
  const taux: number[] = [];

  if (organisationId) {
    const { data, error } = await supabase
      .from('tarifs_negocie')
      .select('remise_pct')
      .eq('activite', activite)
      .eq('scope', 'organisation')
      .eq('organisation_id', organisationId)
      .lte('valide_du', dateStr)
      .or(`valide_jusqu_au.is.null,valide_jusqu_au.gte.${dateStr}`);
    if (error)
      throw new Error(`Lecture remises organisation : ${error.message}`);
    for (const r of (data ?? []) as { remise_pct: number }[])
      taux.push(Number(r.remise_pct));
  }

  if (lieuId) {
    const { data: liens, error: lErr } = await supabase
      .from('organisations_lieux')
      .select('organisation_id')
      .eq('lieu_id', lieuId);
    if (lErr) throw new Error(`Lecture gestionnaire du lieu : ${lErr.message}`);
    const gestionnaires = ((liens ?? []) as { organisation_id: string }[]).map(
      (l) => l.organisation_id,
    );

    if (gestionnaires.length > 0) {
      const { data, error } = await supabase
        .from('tarifs_negocie')
        .select('remise_pct, lieu_id')
        .eq('activite', activite)
        .eq('scope', 'gestionnaire')
        .in('gestionnaire_organisation_id', gestionnaires)
        .lte('valide_du', dateStr)
        .or(`valide_jusqu_au.is.null,valide_jusqu_au.gte.${dateStr}`);
      if (error)
        throw new Error(`Lecture remises gestionnaire : ${error.message}`);
      for (const r of (data ?? []) as {
        remise_pct: number;
        lieu_id: string | null;
      }[]) {
        if (r.lieu_id === null || r.lieu_id === lieuId)
          taux.push(Number(r.remise_pct));
      }
    }
  }

  return 1 - Math.max(0, ...taux);
}
