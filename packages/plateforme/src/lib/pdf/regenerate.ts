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
//
// Le rapport de recyclage ZD n'en fait plus partie : il n'est plus stocké, chaque
// téléchargement le fabrique au clic (décision Val 2026-10-16,
// lib/collectes/rapport-a-la-demande).

import type { SupabaseClient } from '@savr/shared/src/supabase-client.js';
import { logger } from '@savr/shared/src/logger/index.js';
import { messageErreur } from '@/lib/api-helpers.js';
import {
  isPdfDocumentType,
  type PdfDocumentType,
} from '@savr/shared/src/pdf/document-types.js';
import { logoKeyToDataUri } from './logo-inline.js';
import {
  cleLogoAttestation,
  cleLogoSansExcedent,
  lireLogosEvenementDeCollecte,
} from './logo-rapport-de-don.js';

// Champ du payload qui porte le logo du client, par document (Val 2026-10-30) :
// relu à chaque régénération, pour qu'un logo déposé ou changé sur l'événement
// s'applique au rapport déjà fabriqué. Le reste du payload reste figé.
const CHAMP_LOGO: Partial<Record<PdfDocumentType, string>> = {
  'attestation-don': 'logo_client_url',
  'rapport-evenement-sans-excedent': 'logo_url',
};

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
// rapports_rse. Le rapport de recyclage ZD, fabriqué au clic, n'est pas ici.
const DOC_ENTITY: Partial<Record<PdfDocumentType, DocEntity>> = {
  'bordereau-zd': { table: 'bordereaux_savr', entityType: 'bordereaux_savr' },
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

/**
 * Échec DB de la régénération → message NEUTRE. Les routes `…/regenerate`
 * renvoient `result.message` au client : y placer `pgError.message` faisait fuiter
 * la structure interne (classe fermée par la PR #276). Le message réel est loggé
 * côté serveur (`api_route.error`, §07/02). Les autres codes (`UNKNOWN_TYPE`,
 * `NO_DOCUMENT`, `NO_PRIOR_JOB`) portent un libellé métier écrit par nous et
 * restent renvoyés tels quels.
 */
function dbError(err: unknown, event: string): RegenerateResult {
  logger.error('api_route.error', {
    route: event,
    error_code: (err as { code?: string } | null)?.code ?? 'UNKNOWN',
    error: messageErreur(err),
  });
  return { ok: false, code: 'DB_ERROR', message: 'Erreur serveur' };
}

export async function regenerateCollecteDocument(
  supabase: SupabaseClient,
  collecteId: string,
  type: string,
  actor: { userId: string; role?: string },
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
    return dbError(docErr, 'pdf.regenerate.lecture_document');
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
    return dbError(jobErr, 'pdf.regenerate.lecture_job');
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
    regenere_le: new Date().toLocaleDateString('fr-FR', {
      timeZone: 'Europe/Paris',
    }),
  };

  // 3bis. Rapport de don : logo du client relu sur l'événement (le seul champ qui
  //       n'est pas figé). Lecture en échec → aucun rendu, plutôt qu'un rapport
  //       refait avec un logo périmé.
  const champLogo = CHAMP_LOGO[type];
  if (champLogo) {
    let logos;
    try {
      logos = await lireLogosEvenementDeCollecte(supabase, collecteId);
    } catch (e) {
      return dbError(e, 'pdf.regenerate.lecture_logos');
    }
    const cle = logos
      ? type === 'attestation-don'
        ? cleLogoAttestation(logos)
        : cleLogoSansExcedent(logos)
      : undefined;
    const uri = await logoKeyToDataUri(cle);
    // Logo présent mais illisible (stockage indisponible, fichier trop lourd) :
    // le logo figé est gardé plutôt que d'imprimer « Savr » seul.
    payload[champLogo] = uri ?? (cle ? (frozen[champLogo] ?? null) : null);
  }

  // Version courante du rapport, lue AVANT la mise en file : une lecture en échec
  // ne doit ni lancer un rendu, ni faire retomber la version à 2.
  let nextVersion = 0;
  if (cfg.table === 'rapports_rse') {
    const { data: cur, error: curErr } = await supabase
      .from('rapports_rse')
      .select('version')
      .eq('id', entityId)
      .single();
    if (curErr) return dbError(curErr, 'pdf.regenerate.lecture_version');
    nextVersion = ((cur as { version: number } | null)?.version ?? 1) + 1;
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
    return dbError(insErr, 'pdf.regenerate.mise_en_file');
  }

  // 6. Rapport RSE : marquer la régénération (picto ⟳ « Rapport régénéré », §06.06
  //    l.170) — regenere_at + regenere_par_user_id + bump version (≠ version initiale).
  //    Document porté par rapports_rse régénérable : le rapport « Événement sans
  //    excédent » AG (§12 §1.3-bis, régénération Admin).
  if (cfg.table === 'rapports_rse') {
    const { error: majErr } = await supabase
      .from('rapports_rse')
      .update({
        regenere_at: new Date().toISOString(),
        regenere_par_user_id: actor.userId,
        version: nextVersion,
      })
      .eq('id', entityId);
    // Marquage en échec : la ligne dirait une version, le PDF à venir une autre.
    // On retire le job qu'on vient de poser (le dernier payload figé redevient
    // celui d'avant) et on répond en erreur. Si ce retrait échoue lui aussi,
    // l'écart subsiste : il est journalisé à part.
    if (majErr) {
      const { error: retraitErr } = await supabase
        .from('jobs_pdf')
        .delete()
        .eq('id', (newJob as { id: string }).id);
      if (retraitErr) dbError(retraitErr, 'pdf.regenerate.retrait_job');
      return dbError(majErr, 'pdf.regenerate.marquage_rapport');
    }
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
