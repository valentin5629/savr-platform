// GET /api/v1/admin/lieux/[id]/activite
// Alimente l'onglet « Activité » de la fiche lieu Admin (§06.06 §7) :
//   - traiteurs opérant sur le lieu (« information indicative, alimentée auto via
//     collectes ») = traiteur opérationnel des événements du lieu, avec le nombre
//     de collectes de chacun ;
//   - historique des écritures sur le lieu = audit_log (table_name='lieux'), écrit
//     par les routes (aucun trigger d'audit sur cette table) : création,
//     modification, normalisation, modification signalée à la programmation.
// Accès : admin_savr + ops_savr (requireStaff).

import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';
import { serverError } from '@/lib/api-helpers.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Colonnes techniques jamais présentées comme « champ modifié ».
const COLONNES_TECHNIQUES = new Set([
  'id',
  'created_at',
  'updated_at',
  'latitude',
  'longitude',
]);

type Valeurs = Record<string, unknown> | null;

// Champs réellement changés par une écriture de l'audit_log.
function champsModifies(action: string, avant: Valeurs, apres: Valeurs) {
  if (action === 'lieu_override_programmation') {
    const overrides = (apres?.lieu_overrides ?? null) as Valeurs;
    return overrides ? Object.keys(overrides) : [];
  }
  if (action !== 'UPDATE' || !apres) return [];
  return Object.keys(apres).filter(
    (k) =>
      !COLONNES_TECHNIQUES.has(k) &&
      JSON.stringify(apres[k] ?? null) !== JSON.stringify(avant?.[k] ?? null),
  );
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const { id } = await params;
  const supabase = createAdminSupabaseClient();

  const { data: evenements, error: evtErr } = await supabase
    .from('evenements')
    .select('traiteur_operationnel_organisation_id, collectes(count)')
    .eq('lieu_id', id);
  if (evtErr) return serverError(evtErr, 'admin.lieux.activite.evenements');

  const nbParTraiteur = new Map<string, number>();
  for (const e of (evenements ?? []) as {
    traiteur_operationnel_organisation_id: string;
    collectes: { count: number }[] | null;
  }[]) {
    const nb = e.collectes?.[0]?.count ?? 0;
    if (nb === 0) continue;
    const t = e.traiteur_operationnel_organisation_id;
    nbParTraiteur.set(t, (nbParTraiteur.get(t) ?? 0) + nb);
  }

  const nomParOrg = new Map<string, string>();
  if (nbParTraiteur.size > 0) {
    const { data: orgs, error: orgErr } = await supabase
      .from('organisations')
      .select('id, nom, raison_sociale')
      .in('id', [...nbParTraiteur.keys()]);
    if (orgErr) return serverError(orgErr, 'admin.lieux.activite.traiteurs');
    for (const o of (orgs ?? []) as {
      id: string;
      nom: string | null;
      raison_sociale: string | null;
    }[]) {
      nomParOrg.set(o.id, o.raison_sociale ?? o.nom ?? o.id);
    }
  }

  const traiteurs = [...nbParTraiteur.entries()]
    .map(([orgId, nb]) => ({
      id: orgId,
      nom: nomParOrg.get(orgId) ?? orgId,
      nb_collectes: nb,
    }))
    .sort(
      (a, b) =>
        b.nb_collectes - a.nb_collectes || a.nom.localeCompare(b.nom, 'fr'),
    );

  const { data: audit, error: auditErr } = await supabase
    .from('audit_log')
    .select(
      'id, created_at, user_id, action, old_values, new_values, impersonator_id',
    )
    .eq('table_name', 'lieux')
    .eq('record_id', id)
    .order('created_at', { ascending: false })
    .limit(200);
  if (auditErr) return serverError(auditErr, 'admin.lieux.activite.audit');

  const lignes = (audit ?? []) as {
    id: string;
    created_at: string;
    user_id: string | null;
    action: string;
    old_values: Valeurs;
    new_values: Valeurs;
    impersonator_id: string | null;
  }[];

  const userIds = [
    ...new Set(lignes.map((l) => l.user_id).filter(Boolean)),
  ] as string[];
  const auteurParId = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: users } = await supabase
      .from('users')
      .select('id, prenom, nom, email')
      .in('id', userIds);
    for (const u of (users ?? []) as {
      id: string;
      prenom: string | null;
      nom: string | null;
      email: string | null;
    }[]) {
      const nomComplet = `${u.prenom ?? ''} ${u.nom ?? ''}`.trim();
      auteurParId.set(u.id, nomComplet || u.email || u.id);
    }
  }

  const historique = lignes.map((l) => ({
    id: l.id,
    created_at: l.created_at,
    action: l.action,
    auteur: l.user_id ? (auteurParId.get(l.user_id) ?? null) : null,
    champs: champsModifies(l.action, l.old_values, l.new_values),
    impersonation: Boolean(l.impersonator_id),
  }));

  return NextResponse.json({ traiteurs, historique });
}
