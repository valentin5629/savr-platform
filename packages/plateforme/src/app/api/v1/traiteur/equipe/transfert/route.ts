import { NextRequest, NextResponse } from 'next/server';
import { requireUser, type ClientRole } from '@/lib/api-auth.js';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';

// CDC §06.04 §6 « Équipe » (l.671) — Transférer les collectes d'un commercial
// vers un autre (en cas de départ). MANAGER only.
//
// L'ownership commercial d'une collecte est porté par `evenements.created_by`
// (les RLS d'écriture commercial passent par la jointure `evenements.created_by
// = auth.uid()`). Transférer = réassigner `evenements.created_by` source → cible
// pour TOUS les événements de l'org (y compris collectes clôturées : un départ
// doit tout basculer). On passe donc en service_role : la policy RLS
// `evt_manager_update` est gated par `f_collecte_editable`, ce qui exclurait les
// collectes non éditables. Le cloisonnement inter-org est garanti par le filtre
// explicite `organisation_id = ctx.organisationId`.
//
// AUCUN event outbox E2 : `created_by` n'est pas un champ métier transmis au TMS
// (ni date, ni lieu, ni volume) — la réassignation d'attribution interne
// n'entraîne aucune re-confirmation logistique.

const MANAGER_ROLE: ClientRole[] = ['traiteur_manager'];
const ROLES_TRAITEUR = ['traiteur_commercial', 'traiteur_manager'];

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, MANAGER_ROLE);
  if (auth.error) return auth.error;

  let body: { source_user_id?: string; cible_user_id?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }

  const source = (body.source_user_id ?? '').trim();
  const cible = (body.cible_user_id ?? '').trim();
  if (!source || !cible)
    return NextResponse.json(
      { error: 'source_user_id et cible_user_id sont requis' },
      { status: 422 },
    );
  if (source === cible)
    return NextResponse.json(
      { error: 'La source et la cible doivent être différentes' },
      { status: 422 },
    );

  const admin = createAdminSupabaseClient();

  // Source ET cible DOIVENT appartenir à l'organisation du manager (cloisonnement).
  const { data: membres } = await admin
    .from('users')
    .select('id, role, organisation_id')
    .in('id', [source, cible])
    .eq('organisation_id', auth.ctx.organisationId);

  const rows = (membres ?? []) as {
    id: string;
    role: string;
    organisation_id: string;
  }[];
  const src = rows.find((r) => r.id === source);
  const dst = rows.find((r) => r.id === cible);
  if (!src || !dst)
    return NextResponse.json(
      {
        error:
          'La source et la cible doivent être des membres de votre organisation',
      },
      { status: 404 },
    );
  if (!ROLES_TRAITEUR.includes(src.role) || !ROLES_TRAITEUR.includes(dst.role))
    return NextResponse.json(
      { error: 'Le transfert ne concerne que les rôles traiteur' },
      { status: 422 },
    );

  // Réassignation de TOUS les événements de l'org créés par la source → cible.
  // Filtre organisation_id explicite : jamais d'écriture hors de l'org du manager.
  const { data: transferes, error } = await admin
    .from('evenements')
    .update({ created_by: cible })
    .eq('organisation_id', auth.ctx.organisationId)
    .eq('created_by', source)
    .select('id');

  if (error)
    return NextResponse.json({ error: error.message }, { status: 422 });

  return NextResponse.json({
    data: { transferes: (transferes ?? []).length },
  });
}
