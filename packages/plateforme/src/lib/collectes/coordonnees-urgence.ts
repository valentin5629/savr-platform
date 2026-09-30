import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@savr/shared/src/supabase-client.js';
import { formatDateParis } from '@savr/shared/src/temps/index.js';
import { createSupabaseServerClient } from '@/lib/api-auth.js';
import { serverError, writeError } from '@/lib/api-helpers.js';
import {
  CODE_ALERTE_COORDONNEES_URGENCE,
  STATUTS_LOGISTIQUE,
  coordonneesCompletes,
  type TourneeFiche,
} from './fiche-client-types.js';

// « Demander les coordonnées en urgence » (§06.04 Fiche collecte, onglet
// Logistique — décision Val 2026-09-29, Q3) — commun aux routes
// POST /api/v1/{traiteur,agence,gestionnaire}/collectes/[id]/coordonnees-urgence.
//
//  · alerte in-app Ops SEULE (alertes_admin) : ni email, ni Slack ;
//  · la visibilité de la collecte est vérifiée sous la RLS de l'UTILISATEUR
//    AVANT l'écriture service-role (alertes_admin est fermée aux clients) ;
//  · aucun texte libre n'est lu dans la requête : titre et message sont
//    construits ici ;
//  · 1 demande OUVERTE par collecte : garantie par l'index unique partiel
//    uniq_alerte_coordonnees_urgence_ouverte — on insère sans lecture
//    préalable et une violation d'unicité (double clic, 2e onglet, 2e
//    utilisateur) vaut « demande déjà envoyée », réponse identique. Une fois
//    l'alerte clôturée, une nouvelle demande en ouvre une nouvelle (D10,
//    arbitrage Val 2026-09-30, migration 20260930140000) ;
//  · clôture automatique à réception des coordonnées : trigger SQL (migration
//    20260929160000), qui applique la règle de `coordonneesCompletes`.

function one<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export async function repondreDemandeCoordonneesUrgence(
  id: string,
  evenementLog: string,
): Promise<NextResponse> {
  const rls = createSupabaseServerClient();
  const { data, error } = await rls
    .from('collectes')
    .select(
      `id, statut, date_collecte, heure_collecte,
       evenement:evenements!inner(lieu:lieux!lieu_id(nom))`,
    )
    .eq('id', id)
    .maybeSingle();
  if (error) return serverError(error, evenementLog);
  if (!data)
    return NextResponse.json(
      { error: 'Collecte introuvable' },
      { status: 404 },
    );

  const c = data as unknown as {
    id: string;
    statut: string;
    date_collecte: string;
    heure_collecte: string | null;
    evenement:
      | { lieu: { nom: string } | { nom: string }[] | null }
      | { lieu: { nom: string } | { nom: string }[] | null }[]
      | null;
  };

  if (!STATUTS_LOGISTIQUE.includes(c.statut)) {
    return NextResponse.json(
      { error: 'La demande n’est plus possible pour cette collecte.' },
      { status: 409 },
    );
  }

  const admin = createAdminSupabaseClient();
  const { data: liens, error: liensErr } = await admin
    .from('collecte_tournees')
    .select(
      'tournee:tournees(plaque_immatriculation, chauffeur_nom, chauffeur_telephone, type_vehicule)',
    )
    .eq('collecte_id', id);
  if (liensErr) return serverError(liensErr, evenementLog);
  const tournees = (
    (liens ?? []) as Array<{ tournee: TourneeFiche | TourneeFiche[] | null }>
  )
    .map((l) => one(l.tournee))
    .filter((t): t is TourneeFiche => Boolean(t));
  if (coordonneesCompletes(tournees)) {
    return NextResponse.json(
      { error: 'Les coordonnées du chauffeur sont déjà disponibles.' },
      { status: 409 },
    );
  }

  const lieu = one(one(c.evenement)?.lieu ?? null)?.nom ?? 'lieu inconnu';
  const heure = c.heure_collecte?.slice(0, 5);
  const { error: insErr } = await admin.from('alertes_admin').insert({
    code: CODE_ALERTE_COORDONNEES_URGENCE,
    titre: 'Coordonnées du chauffeur demandées en urgence',
    message:
      `Le client demande le nom, la plaque et le téléphone du chauffeur pour ` +
      `la collecte du ${formatDateParis(c.date_collecte)}` +
      `${heure ? ` à ${heure}` : ''} — ${lieu}.`,
    entity_type: 'collecte',
    entity_id: id,
  });
  // 23505 = index unique : une demande est déjà ouverte → même réponse
  // (idempotent).
  if (insErr && insErr.code !== '23505')
    return writeError(insErr, evenementLog);

  return NextResponse.json({ data: { demandee: true } });
}
