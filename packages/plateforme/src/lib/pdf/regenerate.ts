// Régénération manuelle d'un PDF de collecte (Admin — §06.06 Bloc 3 « Documents »,
// actions l.283-284). Le bouton « Régénérer » de la fiche collecte re-render un
// document déjà généré (rapport RSE / bordereau ZD / attestation de don).
//
// Mécanique (BL-P1-BOA-07) : jobs_pdf n'est jamais purgé → on RE-ENQUEUE une copie
// du dernier payload figé de l'entité (jobs_pdf.payload), plutôt que de reconstruire
// le payload (ce qui dupliquerait la logique du batch J+1). Le document est un
// snapshot immuable : re-render du MÊME payload = reproduction fidèle. Le worker PDF
// (pdf-worker.ts) écrit le nouveau fichier sur le MÊME entity_id (overwrite pdf +
// genere_at + statut='emis'/'emise' + template_version courant).
//
// Le rapport RSE porte en plus regenere_at / regenere_par_user_id / version → alimente
// le picto ⟳ « Rapport régénéré » (§06.06 l.170 : version actuelle ≠ initiale).

import type { SupabaseClient } from '@savr/shared/src/supabase-client.js';
import {
  isPdfDocumentType,
  type PdfDocumentType,
} from '@savr/shared/src/pdf/document-types.js';
import {
  resolveRapportBenchmark,
  type BenchmarkFilters,
} from './rapport-benchmark.js';

interface DocEntity {
  /** Table plateforme.* portant la ligne document (clé collecte_id). */
  table: 'bordereaux_savr' | 'rapports_rse' | 'attestations_don';
  /** entity_type persisté dans jobs_pdf.entity_type. */
  entityType: string;
}

// Partiel : seuls les documents ARCHIVÉS grain-collecte sont régénérables. La
// synthèse agrégée (type 'synthese-dashboard') n'a pas de table document (pas
// d'archivage §12 §1.6) et n'est jamais re-enqueue via ce flux → absente de la map.
// 'rapport-evenement-sans-excedent' (§12 §1.3-bis l.198 « Régénération : Admin Savr
// uniquement, correction motif chauffeur / plaque post-saisie ») est porté par
// rapports_rse → régénérable comme le rapport de recyclage.
const DOC_ENTITY: Partial<Record<PdfDocumentType, DocEntity>> = {
  'bordereau-zd': { table: 'bordereaux_savr', entityType: 'bordereaux_savr' },
  'rapport-recyclage-zd': { table: 'rapports_rse', entityType: 'rapports_rse' },
  'attestation-don': {
    table: 'attestations_don',
    entityType: 'attestations_don',
  },
  'rapport-evenement-sans-excedent': {
    table: 'rapports_rse',
    entityType: 'rapports_rse',
  },
};

export type RegenerateResult =
  | { ok: true; jobId: string; type: PdfDocumentType }
  | {
      ok: false;
      code: 'UNKNOWN_TYPE' | 'NO_DOCUMENT' | 'NO_PRIOR_JOB' | 'DB_ERROR';
      message: string;
    };

export async function regenerateCollecteDocument(
  supabase: SupabaseClient,
  collecteId: string,
  type: string,
  actor: { userId: string; role?: string },
  // Filtres benchmark choisis à la régénération (§12 §1.2 « défaut batch / choisis à la
  // régén »). Uniquement pris en compte pour 'rapport-recyclage-zd' ; sinon le PDF est
  // reproduit à l'identique depuis le payload figé.
  benchmarkFilters?: BenchmarkFilters,
): Promise<RegenerateResult> {
  if (!isPdfDocumentType(type)) {
    return {
      ok: false,
      code: 'UNKNOWN_TYPE',
      message: `type_document inconnu : ${type}`,
    };
  }
  const cfg = DOC_ENTITY[type];
  if (!cfg) {
    // type PDF connu mais non archivé (ex. 'synthese-dashboard') → rien à régénérer.
    return {
      ok: false,
      code: 'NO_DOCUMENT',
      message: `type_document non régénérable : ${type}`,
    };
  }

  // 1. Localiser la ligne document de la collecte (dernière version si plusieurs —
  //    attestations_don a une clé (collecte_id, version), les autres sont uniques).
  const { data: docRow, error: docErr } = await supabase
    .from(cfg.table)
    .select('id')
    .eq('collecte_id', collecteId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (docErr) {
    return { ok: false, code: 'DB_ERROR', message: docErr.message };
  }
  if (!docRow) {
    // Document jamais généré (batch J+1 pas encore passé / collecte non éligible).
    return {
      ok: false,
      code: 'NO_DOCUMENT',
      message: 'Document non encore généré — régénération impossible',
    };
  }
  const entityId = (docRow as { id: string }).id;

  // 2. Récupérer le dernier payload figé de cette entité (entrée du re-render).
  const { data: lastJob, error: jobErr } = await supabase
    .from('jobs_pdf')
    .select('payload')
    .eq('entity_type', cfg.entityType)
    .eq('entity_id', entityId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (jobErr) {
    return { ok: false, code: 'DB_ERROR', message: jobErr.message };
  }
  if (!lastJob) {
    return {
      ok: false,
      code: 'NO_PRIOR_JOB',
      message: 'Aucun rendu antérieur à régénérer pour ce document',
    };
  }

  // 3. Reconstituer le payload : copie du payload figé + mention de régénération
  //    (§12 §1.4 « Version mise à jour — générée le … » en pied de page).
  const frozen = (lastJob as { payload: Record<string, unknown> }).payload;
  const payload: Record<string, unknown> = {
    ...frozen,
    regenere_le: new Date().toLocaleDateString('fr-FR'),
  };

  // Rapport RSE : le demandeur peut surcharger les filtres benchmark à la régénération
  // (§12 §1.2). On recalcule alors le bloc benchmark + on ré-fige le snapshot
  // rapports_rse.filtres_benchmark. Sans filtres → reproduction fidèle du payload figé.
  if (type === 'rapport-recyclage-zd' && benchmarkFilters) {
    const bench = await resolveRapportBenchmark(
      supabase,
      collecteId,
      benchmarkFilters,
    );
    payload.benchmark_flux = bench.benchmark_flux;
    payload.benchmark_legende = bench.benchmark_legende;
    await supabase
      .from('rapports_rse')
      .update({ filtres_benchmark: bench.filtres_benchmark })
      .eq('id', entityId);
  }

  // 4. Ré-enqueuer un job frais (même contrat que le batch : statut pending, attempts 0).
  const { data: newJob, error: insErr } = await supabase
    .from('jobs_pdf')
    .insert({
      type_document: type,
      entity_type: cfg.entityType,
      entity_id: entityId,
      payload,
      statut: 'pending',
      attempts: 0,
    })
    .select('id')
    .single();

  if (insErr || !newJob) {
    return {
      ok: false,
      code: 'DB_ERROR',
      message: insErr?.message ?? 'Échec de la mise en file du job PDF',
    };
  }

  // 6. Rapport RSE : marquer la régénération (picto ⟳ « Rapport régénéré », §06.06
  //    l.170) — regenere_at + regenere_par_user_id + bump version (≠ version initiale).
  //    Couvre les deux documents portés par rapports_rse : recyclage ZD ET rapport
  //    « Événement sans excédent » AG (§12 §1.3-bis, régénération Admin).
  if (cfg.table === 'rapports_rse') {
    const { data: cur } = await supabase
      .from('rapports_rse')
      .select('version')
      .eq('id', entityId)
      .single();
    const nextVersion = ((cur as { version: number } | null)?.version ?? 1) + 1;
    await supabase
      .from('rapports_rse')
      .update({
        regenere_at: new Date().toISOString(),
        regenere_par_user_id: actor.userId,
        version: nextVersion,
      })
      .eq('id', entityId);
  }

  // 7. Audit (modèle poids/route.ts) — action tracée, table du document régénéré.
  await supabase.from('audit_log').insert({
    table_name: cfg.table,
    record_id: entityId,
    action: 'document_regenere',
    user_id: actor.userId,
    role: actor.role ?? null,
    new_values: {
      type_document: type,
      collecte_id: collecteId,
      job_id: (newJob as { id: string }).id,
    },
  });

  return { ok: true, jobId: (newJob as { id: string }).id, type };
}
