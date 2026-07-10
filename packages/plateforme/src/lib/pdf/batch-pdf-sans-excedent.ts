// Batch J+1 6h — génère le rapport « Événement sans excédent alimentaire » (§12 §1.3-bis)
// pour les collectes AG terminées en `realisee_sans_collecte` (BL-P1-RPT-02).
//
// Décision Val 2026-07-07 : déclencheur = batch dédié nightly (aligné sur l'archi V1
// batch J+1 des autres PDFs), monté à côté de runBatchPdfJ1 / runBatchPdfJ1Ag. Le CDC
// §1.3-bis énonce « à réception du webhook (immédiat) » — l'archi V1 est batch → arbitré
// batch (cf. _Divergences M2.4_20260707_declencheur). La propriété clé « pas d'embargo
// H+24 » est conservée : disponible_a = genere_at (= now du batch), donc AUCUNE garde
// entrante .lte('realisee_at', now-24h) ici (contrairement à ZD/attestation).
//
// Persistance : ligne rapports_rse standard (pas de colonne discriminante — le type se
// déduit de collectes.statut) + job jobs_pdf → worker écrit shared.fichiers
// entity_type='plateforme.rapports_rse'. Idempotence : skip si rapports_rse existe déjà.

import type { SupabaseClient } from '@savr/shared/src/supabase-client.js';

import { resolveRapportLogo } from './logo-cascade.js';
import { makeLogoResolver } from './logo-inline.js';

export interface BatchSansExcedentResult {
  enqueued: number;
  already_done: number;
  errors: string[];
}

interface OrgRow {
  raison_sociale?: string | null;
  type?: string | null;
  logo_url: string | null;
}

interface CollecteSansExcedentRow {
  id: string;
  evenement_id: string;
  controle_acces_requis: boolean;
  aucun_repas_motif: string | null;
  evenements: {
    nom_evenement: string;
    date_evenement: string;
    pax: number | null;
    nom_client_organisateur: string | null;
    organisation_id: string;
    traiteur_operationnel_organisation_id: string | null;
    client_organisateur_organisation_id: string | null;
    logo_client_organisateur_url: string | null;
    organisations: OrgRow | null;
    traiteur_operationnel: OrgRow | null;
    client_organisateur: OrgRow | null;
    lieux: {
      nom: string;
      adresse_acces: string | null;
      code_postal: string | null;
      ville: string | null;
    } | null;
  } | null;
}

interface TourneeRow {
  heure_debut_reelle: string | null;
  chauffeur_nom: string | null;
  plaque_immatriculation: string | null;
}

export async function runBatchSansExcedent(
  supabase: SupabaseClient,
): Promise<BatchSansExcedentResult> {
  const result: BatchSansExcedentResult = {
    enqueued: 0,
    already_done: 0,
    errors: [],
  };

  // 1. Collectes AG en realisee_sans_collecte — PAS d'embargo H+24 (§1.3-bis) : aucune
  //    garde .lte('realisee_at', …). L'unique transition vers ce statut en V1 provient
  //    de l'adapter logistique (course vide AG, cf. packages/adapters/).
  const { data: collectes, error: selErr } = await supabase
    .from('collectes')
    .select(
      `
      id, evenement_id, controle_acces_requis, aucun_repas_motif,
      evenements (
        nom_evenement, date_evenement, pax, nom_client_organisateur,
        organisation_id, traiteur_operationnel_organisation_id,
        client_organisateur_organisation_id, logo_client_organisateur_url,
        organisations ( raison_sociale, type, logo_url ),
        traiteur_operationnel:organisations!traiteur_operationnel_organisation_id ( raison_sociale, logo_url ),
        client_organisateur:organisations!client_organisateur_organisation_id ( logo_url ),
        lieux ( nom, adresse_acces, code_postal, ville )
      )
    `,
    )
    .eq('type', 'anti_gaspi')
    .eq('statut', 'realisee_sans_collecte')
    .not('evenement_id', 'is', null);

  if (selErr) {
    result.errors.push(`Sélection collectes sans-excédent : ${selErr.message}`);
    return result;
  }

  if (!collectes?.length) return result;

  // 2. Idempotence : exclure les collectes ayant déjà une ligne rapports_rse. Une
  //    collecte AG realisee_sans_collecte n'a de rapports_rse que via CE batch (ZD et
  //    attestation ne traitent que cloturee) → l'existence suffit comme garde.
  const collecteIds = (collectes as unknown as CollecteSansExcedentRow[]).map(
    (c) => c.id,
  );
  const { data: existingRapports } = await supabase
    .from('rapports_rse')
    .select('collecte_id')
    .in('collecte_id', collecteIds);

  const doneIds = new Set(
    ((existingRapports ?? []) as { collecte_id: string }[]).map(
      (r) => r.collecte_id,
    ),
  );

  const toProcess = (collectes as unknown as CollecteSansExcedentRow[]).filter(
    (c) => !doneIds.has(c.id),
  );
  result.already_done = collectes.length - toProcess.length;

  if (!toProcess.length) return result;

  // Inline logo mémoïsé (BL-P3-05) — data URI, clé R2 non rendue par le renderer.
  const resolveLogoUri = makeLogoResolver();

  for (const collecte of toProcess) {
    try {
      const ev = collecte.evenements;
      if (!ev) throw new Error('événement manquant');
      const lieu = ev.lieux;
      const adresseLieu = lieu
        ? [lieu.adresse_acces, lieu.code_postal, lieu.ville]
            .filter(Boolean)
            .join(' ')
        : '';
      // Traiteur = opérationnel si désigné, sinon organisation programmatrice.
      const traiteurNom =
        (ev.traiteur_operationnel ?? ev.organisations)?.raison_sociale ?? '';

      // 3. Tournée (bloc Constat) via collecte_tournees → tournees. AG sans-excédent =
      //    1 tournée en principe ; on prend le rang le plus bas si plusieurs.
      const { data: cts } = await supabase
        .from('collecte_tournees')
        .select(
          'rang, tournee:tournees(heure_debut_reelle, chauffeur_nom, plaque_immatriculation)',
        )
        .eq('collecte_id', collecte.id)
        .order('rang', { ascending: true });

      const tournee: TourneeRow | null =
        (
          (cts ?? []) as Array<{
            tournee: TourneeRow | TourneeRow[] | null;
          }>
        )
          .map((r) => (Array.isArray(r.tournee) ? r.tournee[0] : r.tournee))
          .find((t): t is TourneeRow => Boolean(t)) ?? null;

      const presentationDatetime = tournee?.heure_debut_reelle
        ? new Date(tournee.heure_debut_reelle).toLocaleString('fr-FR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
        : null;

      // Plaque véhicule masquée si controle_acces_requis = false (§1.3-bis).
      const plaque = collecte.controle_acces_requis
        ? (tournee?.plaque_immatriculation ?? null)
        : null;

      // 4. Référence facture (si déjà émise) — bloc Conséquences. Une facture brouillon
      //    (pas encore émise) ne porte pas de référence à afficher.
      const { data: factureLinks } = await supabase
        .from('factures_collectes')
        .select('facture:factures(numero_facture, statut)')
        .eq('collecte_id', collecte.id);

      type FactureInfo = { numero_facture: string | null; statut: string };
      const referenceFacture =
        (
          (factureLinks ?? []) as Array<{
            facture: FactureInfo | FactureInfo[] | null;
          }>
        )
          .map((r) => (Array.isArray(r.facture) ? r.facture[0] : r.facture))
          .find(
            (f): f is FactureInfo =>
              Boolean(f?.numero_facture) && f?.statut !== 'brouillon',
          )?.numero_facture ?? null;

      // 5. Cascade logo client §12 §1.2 (BL-P2-19 — cohérence AG).
      const logo = resolveRapportLogo({
        programmateur: ev.organisations,
        client_organisateur: ev.client_organisateur,
        evenement_logo_client_url: ev.logo_client_organisateur_url,
        traiteur_operationnel: ev.traiteur_operationnel ?? ev.organisations,
      });

      const payload = {
        nom_evenement: ev.nom_evenement,
        date_evenement: new Date(ev.date_evenement).toLocaleDateString('fr-FR'),
        lieu_nom: lieu?.nom ?? '',
        lieu_adresse: adresseLieu,
        traiteur_nom: traiteurNom,
        nb_pax: ev.pax,
        client_organisateur_nom: ev.nom_client_organisateur,
        logo_url: (await resolveLogoUri(logo.logo_url)) ?? null,
        presentation_datetime: presentationDatetime,
        chauffeur_nom: tournee?.chauffeur_nom ?? null,
        plaque_immatriculation: plaque,
        motif: collecte.aucun_repas_motif,
        reference_facture: referenceFacture,
      };

      // 6. Ligne rapports_rse standard — disponible_a = genere_at (pas d'embargo H+24).
      //    genere_at reste null jusqu'au rendu par le worker : la disponibilité effective
      //    = présence du PDF (genere_at) sans fenêtre H+24 (disponible_a immédiate).
      const { data: rapportRow, error: rseErr } = await supabase
        .from('rapports_rse')
        .insert({
          collecte_id: collecte.id,
          evenement_id: collecte.evenement_id,
          version: 1,
          disponible_a: new Date().toISOString(),
          genere_par: 'automatique',
          filtres_benchmark: {},
        })
        .select('id')
        .single();

      if (rseErr || !rapportRow) {
        throw new Error(`INSERT rapports_rse : ${rseErr?.message}`);
      }

      // 7. Enqueuer le job PDF (worker générique sur entity_type='rapports_rse').
      await supabase.from('jobs_pdf').insert({
        type_document: 'rapport-evenement-sans-excedent',
        entity_type: 'rapports_rse',
        entity_id: (rapportRow as { id: string }).id,
        payload,
        statut: 'pending',
        attempts: 0,
      });

      result.enqueued++;
    } catch (err) {
      result.errors.push(
        `collecte sans-excédent ${collecte.id}: ${String(err)}`,
      );
    }
  }

  return result;
}
