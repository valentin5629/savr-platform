import { NextRequest, NextResponse } from 'next/server';
import { requireUser, createSupabaseServerClient } from '@/lib/api-auth.js';

/**
 * GET /api/v1/dashboards/synthese-pdf/filtres — options des filtres de la modale
 * d'export synthèse (§12 §1.6 étape 2) qui ne sont PAS déjà sur la barre du
 * dashboard : « Client organisateur » (traiteur + agence) et « Commercial »
 * (manager traiteur uniquement). Décision Val 2026-07-07 : ces 2 filtres sont
 * construits DANS la modale (indépendants de la barre 5-dim traiteur/agence
 * BL-P2-12, encore déférée).
 *
 * Scopé par rôle (RLS + périmètre §1.6) — 0 fuite inter-organisation :
 *   - traiteur (manager/commercial) → evenements.traiteur_operationnel_organisation_id = org.
 *   - agence → evenements.organisation_id = org.
 *   - gestionnaire → Client organisateur/Commercial non applicables (§1.6 l.264-268) → [].
 * Le nom du client est lu sur l'événement (evenements.nom_client_organisateur) —
 * pas via organisations (RLS = self). Les commerciaux = créateurs d'événements
 * (evenements.created_by) résolus via users (même pattern que /dashboards/blocs).
 */

const ALLOWED_ROLES = [
  'traiteur_manager',
  'traiteur_commercial',
  'agence',
  'gestionnaire_lieux',
] as const;

interface Option {
  id: string;
  nom: string;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, [...ALLOWED_ROLES]);
  if (auth.error) return auth.error;

  const role = auth.ctx.role;
  const org = auth.ctx.organisationId;
  const supabase = createSupabaseServerClient();

  if (role === 'gestionnaire_lieux') {
    // Client organisateur + Commercial non applicables au gestionnaire (§1.6).
    return NextResponse.json({ data: { clients: [], commerciaux: [] } });
  }

  const scopeCol =
    role === 'agence'
      ? 'organisation_id'
      : 'traiteur_operationnel_organisation_id';

  // ── Client organisateur — distinct (id, nom depuis l'événement) ──
  const { data: cliRows, error: cliErr } = await supabase
    .from('evenements')
    .select('client_organisateur_organisation_id, nom_client_organisateur')
    .eq(scopeCol, org)
    .not('client_organisateur_organisation_id', 'is', null);
  if (cliErr)
    return NextResponse.json({ error: cliErr.message }, { status: 500 });

  const clientsMap = new Map<string, string>();
  for (const r of (cliRows ?? []) as {
    client_organisateur_organisation_id: string | null;
    nom_client_organisateur: string | null;
  }[]) {
    const id = r.client_organisateur_organisation_id;
    if (!id) continue;
    if (!clientsMap.has(id))
      clientsMap.set(id, r.nom_client_organisateur ?? 'Client organisateur');
  }
  const clients: Option[] = [...clientsMap.entries()]
    .map(([id, nom]) => ({ id, nom }))
    .sort((a, b) => a.nom.localeCompare(b.nom));

  // ── Commercial — manager traiteur uniquement (§1.6 l.268) ──
  let commerciaux: Option[] = [];
  if (role === 'traiteur_manager') {
    const { data: evRows, error: evErr } = await supabase
      .from('evenements')
      .select('created_by')
      .eq(scopeCol, org)
      .not('created_by', 'is', null);
    if (evErr)
      return NextResponse.json({ error: evErr.message }, { status: 500 });
    const ids = [
      ...new Set(
        (evRows ?? [])
          .map((r) => (r as { created_by: string | null }).created_by)
          .filter((x): x is string => !!x),
      ),
    ];
    if (ids.length > 0) {
      const { data: users } = await supabase
        .from('users')
        .select('id, prenom, nom')
        .in('id', ids);
      commerciaux = (users ?? [])
        .map((u) => ({
          id: u.id as string,
          nom:
            `${(u.prenom as string) ?? ''} ${(u.nom as string) ?? ''}`.trim() ||
            'Commercial',
        }))
        .sort((a, b) => a.nom.localeCompare(b.nom));
    }
  }

  return NextResponse.json({ data: { clients, commerciaux } });
}
