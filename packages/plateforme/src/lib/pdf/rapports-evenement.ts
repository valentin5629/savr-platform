// Rapports CUMULÉS sur un événement (décision Val 2026-10-26), fabriqués au
// clic depuis la fiche événement, jamais stockés :
//  - Zéro Déchet : rapport de recyclage — page de synthèse du rapport d'une
//    collecte sur les chiffres cumulés (mêmes règles que le bilan consolidé),
//    avec ou sans radar au choix du demandeur, puis le détail des collectes ;
//  - Anti-Gaspi : rapport de don, RÉCAPITULATIF sans valeur fiscale qui renvoie
//    aux attestations numérotées de chaque collecte ; une collecte sans excédent
//    y figure à 0 repas.
//
// Cumul partiel : dès qu'une collecte du type a ses résultats, le rapport sort,
// sa couverture dite (« Cumul des N collectes réalisées, sur M »).
//
// Indépendant du rôle : la route de l'espace établit l'accès sous l'identité du
// demandeur (`lireEvenementVisible`) et passe les collectes qu'il voit.
//  - ZD : les mesures figées de CES collectes sont relues en service-role, comme
//    le rapport d'une collecte (payload-rapport) ;
//  - AG : relues SOUS L'IDENTITÉ du demandeur, par le chemin de la fiche
//    collecte (attribution par rôle — la vue v_attributions_gestionnaire pour
//    le gestionnaire —, attestation sous sa RLS) : le PDF n'imprime jamais un
//    repas, une association ou un numéro que l'écran ne lui montre pas.

import { NextResponse } from 'next/server';

import { logger } from '@savr/shared/src/logger/index.js';
import {
  createAdminSupabaseClient,
  type SupabaseClient,
} from '@savr/shared/src/supabase-client.js';
import { formatDateParis } from '@savr/shared/src/temps/index.js';

import type { createSupabaseServerClient } from '@/lib/api-auth.js';
import { messageErreur, serverError } from '@/lib/api-helpers.js';
import {
  attributionsAgOf,
  embedAttributionsAg,
  type AttributionsAgLues,
} from '@/lib/dashboards/attributions-ag.js';
import type { VersionRapport } from '@/lib/collectes/rapport-a-la-demande.js';
import {
  collecteRealisee,
  consoliderEvenement,
  couvertureBilan,
  poidsCollecte,
  repasCollecte,
  un,
  type CollecteAConsolider,
  type UnOuListe,
} from '@/lib/evenements-gestionnaire.js';
import { libelleTypeCollecte } from '@/lib/libelles/type-collecte.js';

import { convivesImprimes } from './convives-imprimes.js';
import {
  buildEquivalences,
  enTeteRapport,
  SELECT_EVENEMENT_RAPPORT,
  type EvenementRapportRow,
} from './payload-rapport.js';
import { generatePdf } from './railway-client.js';

export type TypeRapportEvenement = 'zero_dechet' | 'anti_gaspi';

const ZD = 'zero_dechet';
const SANS_EXCEDENT = 'realisee_sans_collecte';

const AUCUN_RESULTAT =
  'Aucune collecte de ce type n’a encore de résultat : le rapport n’est pas disponible.';
const FABRICATION_ECHEC =
  'La fabrication du rapport a échoué. Réessayez dans un instant.';

const refus = (message: string, status: number) =>
  NextResponse.json({ error: message }, { status });

type CollecteMesuree = Omit<CollecteAConsolider, 'collecte_flux'> & {
  id: string;
  date_collecte: string | null;
  heure_collecte: string | null;
  pax?: number | null;
  co2_induit_kg?: number | null;
  co2_net_kg?: number | null;
  energie_primaire_evitee_kwh?: number | null;
  co2_facteurs_snapshot?: Record<string, unknown> | null;
  collecte_flux?:
    | {
        poids_reel_kg: number | null;
        flux_dechets?: UnOuListe<{ code: string | null; nom: string | null }>;
      }[]
    | null;
  bordereaux_savr?: { numero: string | null; version: number }[] | null;
  attestations_don?:
    | {
        numero: string | null;
        version: number;
        pdf_url: string | null;
        eligible_at: string | null;
      }[]
    | null;
  attributions_lues?: AttributionsAgLues;
};

const SELECT_ZD = `id, type, statut, date_collecte, heure_collecte, pax,
  taux_recyclage, co2_evite_kg, co2_induit_kg, co2_net_kg,
  energie_primaire_evitee_kwh, co2_facteurs_snapshot,
  collecte_flux(poids_reel_kg, flux_dechets!flux_id(code, nom)),
  bordereaux_savr(numero, version)`;

/** Collectes AG, lues sous l'identité du demandeur (cf. en-tête). */
const selectAg = (role: string) =>
  `id, type, statut, date_collecte, heure_collecte, taux_recyclage, co2_evite_kg,
  ${embedAttributionsAg(role).replace(/^attributions_antgaspi/, 'attributions_lues')},
  attestations_don(numero, version, pdf_url, eligible_at)`;

const dateFr = (v: string | null | undefined) => (v ? formatDateParis(v) : '');

/** Σ d'une valeur figée ; null si aucune collecte ne la porte. */
function somme(
  collectes: CollecteMesuree[],
  valeur: (c: CollecteMesuree) => number | null | undefined,
): number | null {
  let total: number | null = null;
  for (const c of collectes) {
    const v = valeur(c);
    if (v == null || !Number.isFinite(Number(v))) continue;
    total = (total ?? 0) + Number(v);
  }
  return total;
}

/** Dernière version d'une ligne versionnée (bordereau, attestation). */
function derniere<T extends { version: number }>(
  lignes: T[] | null | undefined,
): T | null {
  return [...(lignes ?? [])].sort((a, b) => b.version - a.version)[0] ?? null;
}

/** Attribution aplatie au format du bilan consolidé (association à plat). */
function aplatir(c: CollecteMesuree): CollecteMesuree {
  const a = attributionsAgOf(c.attributions_lues)[0];
  if (!a) return c;
  const asso = un(a.associations);
  return {
    ...c,
    attributions_antgaspi: {
      volume_repas_realise: a.volume_repas_realise,
      association_id: a.association_id,
      association_nom: asso?.nom ?? null,
      association_ville: asso?.ville ?? null,
    },
  };
}

function payloadZd(
  collectes: CollecteMesuree[],
  pax: number | null,
): Record<string, unknown> {
  const b = consoliderEvenement(collectes);
  const noms = new Map<string, string>();
  for (const c of collectes)
    for (const f of c.collecte_flux ?? []) {
      const ref = un(f.flux_dechets);
      if (ref?.code && f.poids_reel_kg != null)
        noms.set(ref.code, ref.nom ?? ref.code);
    }
  const flux = [...noms].map(([code, nom]) => ({
    nom,
    code,
    poids_kg: b.flux_kg[code as keyof typeof b.flux_kg] ?? 0,
  }));
  const co2Evite = somme(collectes, (c) => c.co2_evite_kg);
  const energie = somme(collectes, (c) => c.energie_primaire_evitee_kwh);
  // Facteurs d'équivalence de la collecte la plus récente (ils ne changent qu'à
  // une mise à jour du référentiel ADEME).
  const snapshot =
    [...collectes].reverse().find((c) => c.co2_facteurs_snapshot)
      ?.co2_facteurs_snapshot ?? null;
  return {
    nb_pax: convivesImprimes(pax),
    taux_recyclage: b.taux_recyclage,
    flux,
    poids_total_kg: b.tonnage_zd_kg ?? 0,
    co2_evite_kg: co2Evite,
    co2_induit_kg: somme(collectes, (c) => c.co2_induit_kg),
    co2_net_kg: somme(collectes, (c) => c.co2_net_kg),
    energie_primaire_evitee_kwh: energie,
    equivalences: buildEquivalences(co2Evite, energie, snapshot),
    options: { benchmark: false },
    collectes: collectes.map((c) => ({
      date_collecte: dateFr(c.date_collecte),
      nb_pax: convivesImprimes(c.pax ?? null),
      poids_kg: poidsCollecte(c),
      taux_recyclage: c.taux_recyclage,
      co2_evite_kg: c.co2_evite_kg,
      bordereau_numero: derniere(c.bordereaux_savr)?.numero ?? null,
    })),
  };
}

function payloadAg(
  collectes: CollecteMesuree[],
  pax: number | null,
): Record<string, unknown> {
  const b = consoliderEvenement(collectes);
  const maintenant = Date.now();
  return {
    nb_pax: convivesImprimes(pax),
    repas_donnes: b.repas_donnes ?? 0,
    co2_evite_kg: b.co2_evite_ag_kg,
    associations: b.associations.map((a) => ({
      nom: a.nom,
      ville: a.ville,
      repas: a.repas,
    })),
    collectes: collectes.map((c) => {
      const sansExcedent = c.statut === SANS_EXCEDENT;
      // Numéro imprimé seulement pour une attestation téléchargeable (fabriquée,
      // embargo passé) : la même règle que la ligne « Rapport de don » de la fiche.
      const att = sansExcedent ? null : derniere(c.attestations_don);
      const emise =
        att?.numero &&
        att.pdf_url &&
        att.eligible_at &&
        new Date(att.eligible_at).getTime() <= maintenant;
      return {
        date_collecte: dateFr(c.date_collecte),
        sans_excedent: sansExcedent,
        association_nom: un(c.attributions_antgaspi)?.association_nom ?? null,
        repas: repasCollecte(c),
        attestation_numero: emise ? att.numero : null,
      };
    }),
  };
}

/**
 * Fabrique le rapport cumulé du type demandé. `collectes` = les collectes de
 * l'événement que le demandeur voit (annulées comprises, pour la couverture).
 */
export async function fabriquerRapportEvenement(params: {
  evenementId: string;
  type: TypeRapportEvenement;
  collectes: readonly { id: string; type: string; statut: string }[];
  version: VersionRapport;
  /** Client et rôle du demandeur : lecture des collectes AG (cf. en-tête). */
  rls: ReturnType<typeof createSupabaseServerClient>;
  role: string;
  evenementLog: string;
}): Promise<NextResponse> {
  const { evenementId, type, collectes, version, rls, role, evenementLog } =
    params;
  const duType = collectes.filter((c) => c.type === type);
  const realisees = duType.filter(collecteRealisee);
  if (realisees.length === 0) return refus(AUCUN_RESULTAT, 409);

  const admin: SupabaseClient = createAdminSupabaseClient();
  const [evRes, colRes] = await Promise.all([
    admin
      .from('evenements')
      .select(`pax, ${SELECT_EVENEMENT_RAPPORT}`)
      .eq('id', evenementId)
      .maybeSingle(),
    (type === ZD
      ? admin.from('collectes').select(SELECT_ZD)
      : rls.from('collectes').select(selectAg(role))
    ).in(
      'id',
      realisees.map((c) => c.id),
    ),
  ]);
  if (evRes.error) return serverError(evRes.error, evenementLog);
  if (colRes.error) return serverError(colRes.error, evenementLog);
  const ev = evRes.data as unknown as
    | (EvenementRapportRow & { pax: number | null })
    | null;
  if (!ev) return refus('Événement introuvable', 404);

  // Relues : seules celles qui ont encore un résultat comptent (une collecte qui
  // en change entre les deux lectures n'est pas imprimée).
  const mesurees = ((colRes.data ?? []) as unknown as CollecteMesuree[])
    .map(aplatir)
    .filter((c) => c.type === type && collecteRealisee(c))
    .sort(
      (a, b) =>
        (a.date_collecte ?? '').localeCompare(b.date_collecte ?? '') ||
        (a.heure_collecte ?? '').localeCompare(b.heure_collecte ?? '') ||
        a.id.localeCompare(b.id),
    );
  if (mesurees.length === 0) return refus(AUCUN_RESULTAT, 409);

  const deuxTypes = new Set(collectes.map((c) => c.type)).size > 1;
  const enTete = await enTeteRapport(ev);
  const payload: Record<string, unknown> = {
    ...enTete.champs,
    couverture: couvertureBilan(
      mesurees.length,
      duType.length,
      deuxTypes ? libelleTypeCollecte(type) : '',
    ),
    ...(type === ZD
      ? payloadZd(mesurees, ev.pax)
      : payloadAg(mesurees, ev.pax)),
  };
  if (type === ZD && version.avecRadar) {
    payload.options = { benchmark: true };
    payload.benchmark_flux = version.radar.benchmark_flux;
    payload.benchmark_legende = version.radar.benchmark_legende;
  }

  const document =
    type === ZD ? 'rapport-recyclage-evenement' : 'rapport-don-evenement';
  let pdf: Buffer;
  try {
    pdf = (await generatePdf(document, payload)).pdfBuffer;
  } catch (e) {
    logger.error('pdf.rapport_evenement.echec', {
      evenement_id: evenementId,
      type_document: document,
      error: messageErreur(e),
    });
    return refus(FABRICATION_ECHEC, 502);
  }

  const date = /^\d{4}-\d{2}-\d{2}/.exec(ev.date_evenement ?? '')?.[0];
  const nom = `${type === ZD ? 'rapport-recyclage' : 'rapport-de-don'}-evenement-${date ?? evenementId.slice(0, 8)}.pdf`;
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(pdf.length),
      'Content-Disposition': `attachment; filename="${nom}"`,
      'Cache-Control': 'no-store',
    },
  });
}
