import { NextRequest, NextResponse } from 'next/server';
import {
  requireUser,
  createSupabaseServerClient,
  type ClientRole,
} from '@/lib/api-auth.js';
import { writeError } from '@/lib/api-helpers.js';

// CDC §06.04 §6 « Équipe » (l.683-686) — MANAGER only :
//   - Modifier le rôle d'un collaborateur (traiteur_commercial ↔ traiteur_manager) ;
//   - Suspendre un compte (soft-delete `actif=false`).
// ⚠ NON TRACÉ : §07 Observabilité/06 catalogue `user_role_modifie` et
//   `user_desactive` sur `users` sans restriction staff, mais cette route
//   n'écrit AUCUNE ligne `audit_log` — le geste légitime d'un manager n'est donc
//   pas tracé (idem `gestionnaire/mon-organisation/users/[id]`). Non câblé ici
//   parce que §07/06 l.81 rend le `motif` OBLIGATOIRE (≥ 10 car.) pour ces deux
//   actions, alors que §06.04 §6 ne prévoit aucun champ « motif » côté équipe :
//   contradiction CDC → Q3 de la divergence M3.1_20260921_users-role-auto-changement.
// RLS usr_manager_update (own-org). Le trigger anti-escalade interdit toute
// promotion vers un rôle staff (volets 1-2, 20260903120000) et tout changement
// de SON PROPRE rôle (volet 3, 20260921160000) ; l'allowlist ci-dessous
// restreint en plus aux deux rôles traiteur (jamais gestionnaire/agence/organisateur).
// ⚠ L'allowlist est applicative SEULE : elle n'est pas rejouée en base. Mesuré
//   le 2026-09-21 : en PostgREST direct, un manager pose n'importe quel rôle non
//   staff sur un collègue — et il peut CRÉER une seconde identité manager dans
//   son org (`usr_manager_insert` ne contraint ni `id` ni `role`) puis s'en
//   servir pour changer SON PROPRE rôle en deux temps. La garde « sur soi »
//   ci-dessous ferme donc complètement le P0 pour traiteur_commercial / agence /
//   client_organisateur (la RLS leur refuse l'INSERT) mais n'est qu'un
//   ralentisseur pour manager / gestionnaire. Fermeture = allowlist dans le
//   WITH CHECK des policies INSERT — lot distinct, arbitrage Val
//   (divergence M3.1_20260921_users-role-auto-changement).

const MANAGER_ROLE: ClientRole[] = ['traiteur_manager'];
const ROLES_ASSIGNABLES = new Set(['traiteur_commercial', 'traiteur_manager']);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUser(req, MANAGER_ROLE);
  if (auth.error) return auth.error;
  const { id } = await params;

  let body: { role?: string; actif?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};

  if (body.role !== undefined) {
    if (!ROLES_ASSIGNABLES.has(body.role))
      return NextResponse.json(
        {
          error:
            'Rôle invalide (seuls traiteur_commercial et traiteur_manager sont assignables)',
        },
        { status: 422 },
      );
    // Anti-auto-changement de rôle — symétrique de l'anti-auto-suspension
    // ci-dessous. CDC §06.04 §6 : « Modifier le rôle d'UN COLLABORATEUR » ; le
    // manager n'est pas son propre collaborateur. La garde qui COMPTE est en
    // base (volet 3 de `trg_users_block_role_escalation`, migration
    // 20260921160000) — un appel PostgREST direct ne passe pas par cette route.
    // Ce 403 n'est là que pour rendre le refus lisible depuis l'UI.
    if (id === auth.ctx.userId)
      return NextResponse.json(
        { error: 'Impossible de modifier votre propre rôle' },
        { status: 403 },
      );
    patch.role = body.role;
  }

  if (body.actif !== undefined) {
    if (typeof body.actif !== 'boolean')
      return NextResponse.json(
        { error: 'actif doit être un booléen' },
        { status: 422 },
      );
    // Anti-auto-suspension : un manager ne peut pas se désactiver lui-même.
    if (body.actif === false && id === auth.ctx.userId)
      return NextResponse.json(
        { error: 'Impossible de suspendre votre propre compte' },
        { status: 403 },
      );
    patch.actif = body.actif;
  }

  if (Object.keys(patch).length === 0)
    return NextResponse.json(
      { error: 'Aucun champ modifiable fourni (role, actif)' },
      { status: 400 },
    );

  const supabase = createSupabaseServerClient();
  // UPDATE via RLS (usr_manager_update, own-org). Le trigger anti-escalade
  // backstoppe toute tentative de promotion admin_savr.
  const { data, error } = await supabase
    .from('users')
    .update(patch)
    .eq('id', id)
    .select('id, prenom, nom, email, role, actif')
    .maybeSingle();

  if (error) return writeError(error, 'traiteur.equipe.update');
  if (!data)
    return NextResponse.json(
      { error: 'Utilisateur non trouvé ou hors de votre organisation' },
      { status: 404 },
    );

  return NextResponse.json({ data });
}
