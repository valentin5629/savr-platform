// GET /api/v1/registre/:id — détail d'une collecte au registre (§06.03, 8 blocs).
// Snapshot lecture seule (producteur/transporteur/exutoire figés au bordereau).
// plaque_vehicule / chauffeur_nom NON exposés (audit DREAL seulement, §06.03).
// La visibilité est portée par la vue RLS-safe (collecte hors périmètre → 404).

import { NextRequest, NextResponse } from 'next/server';

import { type SupabaseClient } from '@savr/shared/src/supabase-client.js';

import { createSupabaseServerClient } from '@/lib/api-auth.js';
import { requireRegistreUser } from '@/lib/registre/guard.js';
import { FLUX_LABELS, FILIERE_LABELS } from '@/lib/registre/registre.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function unwrap(rel: unknown): Record<string, unknown> {
  if (Array.isArray(rel)) return (rel[0] ?? {}) as Record<string, unknown>;
  return (rel ?? {}) as Record<string, unknown>;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireRegistreUser(req);
  if (auth.error) return auth.error;

  const { id } = await params;
  const supabase = createSupabaseServerClient() as unknown as SupabaseClient;

  // 1. Ligne registre (porte la visibilité : 404 si hors périmètre / non ZD cloturee).
  const { data: row } = await supabase
    .from('v_registre_dechets')
    .select('*')
    .eq('collecte_id', id)
    .maybeSingle();
  if (!row) {
    return NextResponse.json(
      { error: 'Collecte introuvable' },
      { status: 404 },
    );
  }

  // 2. Bordereau (snapshots producteur / transporteur / exutoire).
  const { data: bordereau } = await supabase
    .from('bordereaux_savr')
    .select(
      'id, numero, statut, date_emission, version, producteur_raison_sociale, producteur_siret, producteur_adresse, transporteur_nom, transporteur_siret, exutoire_nom, exutoire_siret, exutoire_adresse',
    )
    .eq('collecte_id', id)
    .maybeSingle();

  // 3. Détail des flux (bloc 6).
  const { data: fluxRows } = await supabase
    .from('collecte_flux')
    .select(
      'poids_reel_kg, flux_dechets!flux_id(code, nom, filiere_valorisation)',
    )
    .eq('collecte_id', id);
  const flux = ((fluxRows ?? []) as Record<string, unknown>[]).map((f) => {
    const fd = unwrap(f.flux_dechets);
    const code = (fd.code as string) ?? '';
    return {
      code,
      libelle: FLUX_LABELS[code] ?? (fd.nom as string) ?? code,
      filiere:
        FILIERE_LABELS[fd.filiere_valorisation as string] ??
        (fd.filiere_valorisation as string) ??
        '',
      poids_kg: Number(f.poids_reel_kg ?? 0),
    };
  });

  // 4. Données événement / lieu (bloc 1 + 3). Pax et type d'événement : ceux de
  // LA collecte (lot C1 : décisions Val C3 du 2026-10-22 et C4 du 2026-10-20),
  // comme la ligne du registre.
  const { data: collecte } = await supabase
    .from('collectes')
    .select(
      'heure_collecte, pax, type_evenement:types_evenements!type_evenement_id(libelle), evenements!evenement_id(nom_evenement, date_evenement, nom_client_organisateur, lieux!lieu_id(nom, adresse_acces, code_postal, ville))',
    )
    .eq('id', id)
    .maybeSingle();
  const ligneCollecte = collecte as Record<string, unknown> | null;
  const evt = unwrap(ligneCollecte?.evenements);
  const lieu = unwrap(evt.lieux);
  const typeEvt = unwrap(ligneCollecte?.type_evenement);

  // 8. Historique (audit_log) — staff seulement (RLS), vide pour les clients.
  const auditIds = [id, (bordereau as { id?: string } | null)?.id].filter(
    (v): v is string => !!v,
  );
  const { data: audit } = await supabase
    .from('audit_log')
    .select('action, table_name, created_at, role')
    .in('record_id', auditIds)
    .order('created_at', { ascending: true });

  return NextResponse.json({
    collecte_id: id,
    evenement: {
      nom: evt.nom_evenement ?? null,
      date: evt.date_evenement ?? null,
      heure:
        (collecte as { heure_collecte?: string } | null)?.heure_collecte ??
        null,
      pax: (ligneCollecte?.pax as number | null | undefined) ?? null,
      type_evenement: typeEvt.libelle ?? null,
      client_organisateur: evt.nom_client_organisateur ?? null,
    },
    producteur: {
      raison_sociale:
        (bordereau as Record<string, unknown> | null)
          ?.producteur_raison_sociale ?? row.traiteur_raison_sociale,
      siret:
        (bordereau as Record<string, unknown> | null)?.producteur_siret ?? null,
      adresse:
        (bordereau as Record<string, unknown> | null)?.producteur_adresse ??
        null,
    },
    lieu: {
      nom: lieu.nom ?? row.lieu_nom,
      adresse: lieu.adresse_acces ?? row.lieu_adresse,
      code_postal: lieu.code_postal ?? null,
      ville: lieu.ville ?? null,
    },
    transporteur: {
      nom:
        (bordereau as Record<string, unknown> | null)?.transporteur_nom ??
        row.transporteur_nom,
      siret:
        (bordereau as Record<string, unknown> | null)?.transporteur_siret ??
        null,
    },
    exutoire: {
      nom:
        (bordereau as Record<string, unknown> | null)?.exutoire_nom ??
        row.exutoire_nom,
      siret:
        (bordereau as Record<string, unknown> | null)?.exutoire_siret ?? null,
      adresse:
        (bordereau as Record<string, unknown> | null)?.exutoire_adresse ?? null,
    },
    flux,
    poids_total_kg: row.poids_total_kg,
    documents: {
      bordereau_id: (bordereau as { id?: string } | null)?.id ?? null,
      numero: (bordereau as Record<string, unknown> | null)?.numero ?? null,
      statut: (bordereau as Record<string, unknown> | null)?.statut ?? null,
      date_emission:
        (bordereau as Record<string, unknown> | null)?.date_emission ?? null,
      version: (bordereau as Record<string, unknown> | null)?.version ?? null,
    },
    historique: (audit ?? []) as unknown[],
    historique_partiel: row.historique_partiel ?? false,
  });
}
