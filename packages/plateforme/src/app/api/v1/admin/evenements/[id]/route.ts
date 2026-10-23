import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { requireStaff } from '@/lib/api-auth.js';
import { serverError } from '@/lib/api-helpers.js';
import { validerChampsTexteLibre } from '@/lib/champs-texte-libre.js';
import { envoyerOrdresEvenementSansAttendre } from '@/lib/envoi-immediat.js';
import { CHAMPS_TYPE_CONTACTS_COLLECTE } from '@/lib/collectes/champs-editables.js';

// Envoi immédiat après la réponse : limite exigée de toute route qui le
// déclenche (cf. lib/envoi-immediat.ts).
export const maxDuration = 60;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const { id } = await params;
  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from('evenements')
    .select(
      `*, organisations!organisation_id(raison_sociale),
       lieux!lieu_id(nom, ville, adresse_acces),
       types_evenements!type_evenement_id(libelle),
       collectes(id, type, statut, date_collecte, statut_tms)`,
    )
    .eq('id', id)
    .single();

  if (error?.code === 'PGRST116') {
    return NextResponse.json(
      { error: 'Événement introuvable' },
      { status: 404 },
    );
  }
  if (error) return serverError(error, 'admin.evenements.get');

  return NextResponse.json(data);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireStaff(req);
  if (auth.error) return auth.error;

  const { id } = await params;
  const body = (await req.json()) as Record<string, unknown>;

  // Le pax n'est plus un champ de l'événement (décision Val 2026-10-20) : il est
  // porté par chaque collecte, et celui de l'événement en est calculé. Refusé
  // plutôt qu'ignoré, comme sur la route des programmateurs.
  if ('pax' in body) {
    return NextResponse.json(
      {
        error:
          'Le nombre de convives se modifie sur chaque collecte, pas sur l’événement.',
        champs_verrouilles: ['pax'],
      },
      { status: 422 },
    );
  }

  // Le type d'événement et les contacts se modifient sur chaque collecte (lot
  // B1, décision Val 2026-10-23) ; l'événement garde la copie de sa collecte
  // n°1, tenue par la base. Refusés plutôt qu'ignorés.
  const typeContacts = CHAMPS_TYPE_CONTACTS_COLLECTE.filter((f) => f in body);
  if (typeContacts.length > 0) {
    return NextResponse.json(
      {
        error:
          'Le type d’événement et les contacts se modifient sur chaque collecte, pas sur l’événement.',
        champs_verrouilles: typeContacts,
      },
      { status: 422 },
    );
  }

  const ALLOWED_FIELDS = [
    'nom_evenement',
    'date_evenement',
    'lieu_id',
    'nom_client_organisateur',
    'logo_client_organisateur_url',
    'client_organisateur_organisation_id',
    'reference_affaire',
    'notes_internes',
  ];
  const updates = Object.fromEntries(
    Object.entries(body).filter(([k]) => ALLOWED_FIELDS.includes(k)),
  );

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: 'Aucun champ modifiable fourni' },
      { status: 422 },
    );
  }

  // Bornes d'entrée du texte libre : `fn_modifier_evenement` écrit
  // `p_updates->>'champ'` tel quel.
  const texteValide = validerChampsTexteLibre(updates);
  if ('error' in texteValide) return texteValide.error;
  Object.assign(updates, texteValide.valeurs);

  // Écriture via fn_modifier_evenement (M1.1b / M1.5a). Depuis le lot B1
  // (2026-10-23), aucun champ de l'événement ne part au prestataire : la
  // fonction n'émet plus d'E2 (les contacts, transmis, sont portés par chaque
  // collecte).
  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase.rpc('fn_modifier_evenement', {
    p_id: id,
    p_updates: updates,
    p_champs_modifies: Object.keys(updates),
  });

  if (error?.code === 'P0002') {
    return NextResponse.json(
      { error: 'Événement introuvable' },
      { status: 404 },
    );
  }
  if (error) return serverError(error, 'admin.evenements.update');

  // Un ordre par collecte déjà commandée : ils partent sans attendre le passage
  // planifié (décision Val 2026-10-12).
  envoyerOrdresEvenementSansAttendre(id);

  return NextResponse.json(data);
}
