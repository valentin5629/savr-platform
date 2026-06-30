// Revalidation SIRET asynchrone — BL-P1-ONB-02 (CDC §15 §2.6 l.73).
// Quand INSEE est injoignable au signup (verifySiret → 'down'), l'entité reste
// `en_attente` et une ligne est enqueue ici. Le cron `revalidation-siret` re-tente
// selon 3 paliers (15 min / 1 h / 24 h) :
//   - 'verifie'  → entité verifie, file 'resolu' ;
//   - 'echec'    → entité echec, file 'resolu', email org (SIRET à corriger) ;
//   - 'down'     → palier suivant ; après 3 tentatives → file 'epuise' + alerte Admin.
// La facturation reste conditionnée à siret_verification='verifie' (gating §4).

import type { createAdminSupabaseClient } from '../supabase-client.js';
import { verifySiret } from '../api/siret.js';
import { sendEmail } from '../email/index.js';

type AdminSupabase = ReturnType<typeof createAdminSupabaseClient>;

// Paliers cumulatifs : délai (s) avant chaque tentative à partir de l'enqueue.
// tentatives=0 → +15 min (enqueue) ; après down à tentatives t → +PALIERS[t+1] ;
// t+1 >= longueur (3) → épuisé.
const PALIERS_SECONDS = [15 * 60, 60 * 60, 24 * 60 * 60];

// Enqueue une revalidation (idempotent : index UNIQUE partiel sur la file active).
export async function enqueueSiretRevalidation(
  supabase: AdminSupabase,
  entiteFacturationId: string,
  nowMs?: number,
): Promise<void> {
  const now = nowMs ?? Date.now();
  const prochaine = new Date(now + PALIERS_SECONDS[0]! * 1000).toISOString();
  await supabase.from('file_revalidation_siret').insert({
    entite_facturation_id: entiteFacturationId,
    statut: 'en_attente',
    tentatives: 0,
    prochaine_tentative_le: prochaine,
  });
}

export interface SiretRevalidationResult {
  scanned: number;
  retried: number;
  verifie: number;
  echec: number;
  requeue: number;
  epuise: number;
}

interface FileRow {
  id: string;
  entite_facturation_id: string;
  tentatives: number;
}

interface EntiteRow {
  id: string;
  siret: string | null;
  raison_sociale: string | null;
  organisation_id: string;
}

export async function runSiretRevalidationWorker(
  supabase: AdminSupabase,
  nowMs?: number,
): Promise<SiretRevalidationResult> {
  const now = nowMs ?? Date.now();
  const nowIso = new Date(now).toISOString();

  const { data: rows } = await supabase
    .from('file_revalidation_siret')
    .select('id, entite_facturation_id, tentatives')
    .eq('statut', 'en_attente')
    .lte('prochaine_tentative_le', nowIso);

  const dues = (rows ?? []) as unknown as FileRow[];
  const result: SiretRevalidationResult = {
    scanned: dues.length,
    retried: 0,
    verifie: 0,
    echec: 0,
    requeue: 0,
    epuise: 0,
  };

  for (const row of dues) {
    const { data: entiteData } = await supabase
      .from('entites_facturation')
      .select('id, siret, raison_sociale, organisation_id')
      .eq('id', row.entite_facturation_id)
      .maybeSingle();
    const entite = entiteData as EntiteRow | null;

    // Entité disparue ou SIRET vidé → clôturer la ligne (plus rien à revalider).
    if (!entite?.siret) {
      await supabase
        .from('file_revalidation_siret')
        .update({ statut: 'resolu', updated_at: nowIso })
        .eq('id', row.id);
      continue;
    }

    const verdict = await verifySiret(entite.siret);
    result.retried += 1;

    if (verdict === 'verifie') {
      await supabase
        .from('entites_facturation')
        .update({ siret_verification: 'verifie', siret_verifie_le: nowIso })
        .eq('id', entite.id);
      await supabase
        .from('file_revalidation_siret')
        .update({ statut: 'resolu', updated_at: nowIso })
        .eq('id', row.id);
      result.verifie += 1;
      continue;
    }

    if (verdict === 'echec') {
      await supabase
        .from('entites_facturation')
        .update({ siret_verification: 'echec', siret_verifie_le: nowIso })
        .eq('id', entite.id);
      await supabase
        .from('file_revalidation_siret')
        .update({
          statut: 'resolu',
          derniere_erreur: 'INSEE: SIRET inexistant/inactif',
          updated_at: nowIso,
        })
        .eq('id', row.id);
      await notifierEchecSiret(supabase, entite);
      result.echec += 1;
      continue;
    }

    // verdict === 'down' → palier suivant ou épuisement.
    const nextTentatives = row.tentatives + 1;
    if (nextTentatives >= PALIERS_SECONDS.length) {
      await supabase
        .from('file_revalidation_siret')
        .update({
          statut: 'epuise',
          tentatives: nextTentatives,
          derniere_erreur: 'INSEE injoignable après 3 paliers',
          updated_at: nowIso,
        })
        .eq('id', row.id);
      // Alerte Admin in-app (INSEE durablement down → action manuelle). L'entité reste
      // en_attente (jamais 'echec' : down ≠ invalide).
      await supabase.rpc('f_upsert_alerte_admin', {
        p_code: 'siret_revalidation_epuisee',
        p_titre: 'Revalidation SIRET épuisée — INSEE injoignable',
        p_message: `SIRET ${entite.siret} (${entite.raison_sociale ?? 'org'}) : 3 paliers de revalidation épuisés, INSEE toujours injoignable. Vérifier manuellement.`,
        p_entity_type: 'entites_facturation',
        p_entity_id: entite.id,
      });
      result.epuise += 1;
      continue;
    }

    await supabase
      .from('file_revalidation_siret')
      .update({
        tentatives: nextTentatives,
        prochaine_tentative_le: new Date(
          now + PALIERS_SECONDS[nextTentatives]! * 1000,
        ).toISOString(),
        derniere_erreur: 'INSEE injoignable',
        updated_at: nowIso,
      })
      .eq('id', row.id);
    result.requeue += 1;
  }

  return result;
}

// Notifie l'organisation que son SIRET est invalide (template seedé siret_verification_echec,
// variables organisation_nom + siret). Best-effort : adressé au 1er utilisateur de l'orga.
async function notifierEchecSiret(
  supabase: AdminSupabase,
  entite: EntiteRow,
): Promise<void> {
  const { data: user } = await supabase
    .from('users')
    .select('email')
    .eq('organisation_id', entite.organisation_id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  const to = (user as { email?: string } | null)?.email;
  if (!to) return;
  await sendEmail(
    'siret_verification_echec',
    to,
    {
      organisation_nom: entite.raison_sociale ?? '',
      siret: entite.siret ?? '',
    },
    { entityType: 'entites_facturation', entityId: entite.id },
  ).catch(() => null);
}
