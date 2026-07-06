import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { sendEmail } from '@savr/shared/src/email/index.js';
import { requireUser, type ClientRole } from '@/lib/api-auth.js';

// Action ouverte au manager, au commercial ET à l'agence (§06.04 Bloc 4 AG,
// répliqué à l'identique pour l'agence — §06.11 l.36/l.44 « pack AG fondu dans
// l'onglet AG, identique au §06.04 », BL-P1-AGENCE-01). Endpoint partagé : le
// chemin /traiteur/… est cosmétique, l'action et le template sont identiques.
const PACK_RENOUVELLEMENT_ROLES: ClientRole[] = [
  'traiteur_manager',
  'traiteur_commercial',
  'agence',
];

// POST /api/v1/traiteur/pack-ag/renouvellement — demande de renouvellement de
// pack AG (§06.04 Bloc 4 AG). Envoie un email à l'Admin Savr.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireUser(req, PACK_RENOUVELLEMENT_ROLES);
  if (auth.error) return auth.error;
  const body = (await req.json().catch(() => ({}))) as {
    pack_souhaite?: string;
    message?: string;
  };

  const admin = createAdminSupabaseClient();
  const { data: org } = await admin
    .from('organisations')
    .select('nom')
    .eq('id', auth.ctx.organisationId)
    .maybeSingle();

  await sendEmail('admin_demande_renouvellement_pack', 'hello@gosavr.io', {
    organisation_nom: org?.nom ?? '',
    demandeur_nom: auth.ctx.userId,
    demandeur_email: '',
    pack_souhaite: body.pack_souhaite ?? '',
    message: body.message ?? '',
  });

  return NextResponse.json({ data: { demande: 'envoyee' } }, { status: 201 });
}
