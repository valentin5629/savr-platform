-- pgTAP — benchmark_agregation_segments_ponderee_ecran_et_pdf (§06.04 + §12 §1.2).
-- ---------------------------------------------------------------------------
-- Scénario P1-critique `tests/11-12-dashboards-reporting-scenarios.md` (divergence
-- M3.1 2026-09-22, arbitrage Val option (a)) : sur deux segments parc du même flux
--   (0,30 kg/pax ; nb_collectes_segment = 5) et (0,40 kg/pax ; nb_collectes_segment = 15),
-- l'écran ET le PDF doivent rendre 0,375 — la moyenne PONDÉRÉE par le nombre de
-- collectes — et jamais 0,350, la moyenne simple que `f_rapport_benchmark_zd`
-- calculait avant `20260922120000`.
--
-- La fixture construit les deux segments avec deux types d'événement DÉDIÉS : le
-- parc est ainsi borné aux lignes de ce test, indépendamment du seed de la base
-- (aucune collecte préexistante ne porte ces types). Le troisième type (3 collectes)
-- sert la garde de k-anonymat.
--
-- Fixtures 100 % isolées (BEGIN…ROLLBACK) : identifiants et SIRET distincts de
-- r19b_gest04_benchmark_ponderee.test.sql, qui bâtit un parc voisin.
-- ---------------------------------------------------------------------------

BEGIN;
SELECT plan(8);

SET LOCAL role = 'postgres';

INSERT INTO plateforme.organisations (id, nom, raison_sociale, type, siret, actif, tarif_refacture_pax_zd)
VALUES ('bb000000-0000-0000-0000-0000000000a1'::uuid, 'Pondere Traiteur', 'Pondere SARL', 'traiteur', '88888888800001', true, 0);

INSERT INTO plateforme.users (id, organisation_id, email, prenom, nom, role, actif)
VALUES ('bb000000-0000-0000-0000-0000000000b1'::uuid, 'bb000000-0000-0000-0000-0000000000a1'::uuid,
        'chef@pondere.test', 'Chef', 'P', 'traiteur_manager', true);

INSERT INTO plateforme.entites_facturation
  (id, organisation_id, raison_sociale, siret, adresse_facturation, code_postal, ville)
VALUES ('bb000000-0000-0000-0000-0000000000f1'::uuid, 'bb000000-0000-0000-0000-0000000000a1'::uuid,
        'Pondere SARL', '88888888800001', '1 rue Pondere', '75001', 'Paris');

INSERT INTO plateforme.lieux (id, nom, adresse_acces, code_postal, ville, type_vehicule_max)
VALUES ('bb000000-0000-0000-0000-0000000000f0'::uuid, 'Pondere Lieu', '2 av Pondere', '75002', 'Paris', 'camionnette');

-- 3 types d'événement dédiés = 3 segments parc distincts sur le même flux et le
-- même bracket de taille (pax = 100 ⇒ 'XS' partout).
INSERT INTO plateforme.types_evenements (id, code, libelle, ordre_affichage, actif) VALUES
  ('bb000000-0000-0000-0000-0000000000d1'::uuid, 'PONDERE_A', 'Pondere A', 1, true),
  ('bb000000-0000-0000-0000-0000000000d2'::uuid, 'PONDERE_B', 'Pondere B', 2, true),
  ('bb000000-0000-0000-0000-0000000000d3'::uuid, 'PONDERE_C', 'Pondere C', 3, true);

-- ── Parc : segment A (5 collectes, 30 kg / 100 pax ⇒ 150/500 = 0,30)
--          segment B (15 collectes, 40 kg / 100 pax ⇒ 600/1500 = 0,40)
--          segment C (3 collectes  ⇒ sous le k-anonymat, jamais retourné)
INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id, entite_facturation_id,
  created_by, lieu_id, type_evenement_id, nom_evenement, date_evenement, pax,
  contact_principal_nom, contact_principal_telephone
)
SELECT
  s.evt_id,
  'bb000000-0000-0000-0000-0000000000a1'::uuid,
  'bb000000-0000-0000-0000-0000000000a1'::uuid,
  'bb000000-0000-0000-0000-0000000000f1'::uuid,
  'bb000000-0000-0000-0000-0000000000b1'::uuid,
  'bb000000-0000-0000-0000-0000000000f0'::uuid,
  s.type_id,
  'Evt ' || s.rang,
  DATE '2026-05-01' + s.rang,
  100,
  'Contact',
  '0600000000'
FROM (
  SELECT ('bb000000-0000-0000-0000-00000000e' || lpad(g::text, 3, '0'))::uuid AS evt_id,
         g AS rang,
         CASE WHEN g <= 5 THEN 'bb000000-0000-0000-0000-0000000000d1'::uuid
              WHEN g <= 20 THEN 'bb000000-0000-0000-0000-0000000000d2'::uuid
              ELSE 'bb000000-0000-0000-0000-0000000000d3'::uuid END AS type_id
  FROM generate_series(1, 23) g
) s;

INSERT INTO plateforme.collectes
  (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, dirty_tms, annulee_cote_savr)
SELECT
  ('bb000000-0000-0000-0000-00000000c' || lpad(g::text, 3, '0'))::uuid,
  ('bb000000-0000-0000-0000-00000000e' || lpad(g::text, 3, '0'))::uuid,
  'zero_dechet', 'cloturee', 'non_envoye',
  DATE '2026-05-01' + g, '20:00', false, false
FROM generate_series(1, 23) g;

INSERT INTO plateforme.collecte_flux (collecte_id, flux_id, poids_reel_kg)
SELECT
  ('bb000000-0000-0000-0000-00000000c' || lpad(g::text, 3, '0'))::uuid,
  (SELECT id FROM plateforme.flux_dechets WHERE code = 'biodechet'),
  (CASE WHEN g <= 5 THEN 30 WHEN g <= 20 THEN 40 ELSE 99 END)::decimal
FROM generate_series(1, 23) g;

-- ── Collecte CIBLE du rapport : statut 'realisee' (batch J+1, avant clôture H+24)
--    ⇒ hors parc (f_benchmark_kg_pax_zd ne lit que les 'cloturee'), les segments
--    gardent donc exactement 5 / 15 / 3 collectes.
INSERT INTO plateforme.evenements (
  id, organisation_id, traiteur_operationnel_organisation_id, entite_facturation_id,
  created_by, lieu_id, type_evenement_id, nom_evenement, date_evenement, pax,
  contact_principal_nom, contact_principal_telephone
) VALUES (
  'bb000000-0000-0000-0000-0000000000e9'::uuid, 'bb000000-0000-0000-0000-0000000000a1'::uuid,
  'bb000000-0000-0000-0000-0000000000a1'::uuid, 'bb000000-0000-0000-0000-0000000000f1'::uuid,
  'bb000000-0000-0000-0000-0000000000b1'::uuid, 'bb000000-0000-0000-0000-0000000000f0'::uuid,
  'bb000000-0000-0000-0000-0000000000d1'::uuid, 'Evt cible', '2026-06-01', 100, 'Contact', '0600000099'
);

INSERT INTO plateforme.collectes
  (id, evenement_id, type, statut, statut_tms, date_collecte, heure_collecte, dirty_tms, annulee_cote_savr)
VALUES ('bb000000-0000-0000-0000-0000000000c9'::uuid, 'bb000000-0000-0000-0000-0000000000e9'::uuid,
        'zero_dechet', 'realisee', 'non_envoye', '2026-06-01', '20:00', false, false);

INSERT INTO plateforme.collecte_flux (collecte_id, flux_id, poids_reel_kg)
VALUES ('bb000000-0000-0000-0000-0000000000c9'::uuid,
        (SELECT id FROM plateforme.flux_dechets WHERE code = 'biodechet'), 25::decimal);

-- ════════════════════════════════════════════════════════════════════════════
-- Assertions — chemin PDF (f_rapport_benchmark_zd)
-- ════════════════════════════════════════════════════════════════════════════

-- 1. Deux segments (types A + B) ⇒ moyenne PONDÉRÉE = (0,30×5 + 0,40×15)/20 = 0,375.
SELECT is(
  (SELECT round(benchmark_kg_pax, 6) FROM plateforme.f_rapport_benchmark_zd(
     p_collecte_id        => 'bb000000-0000-0000-0000-0000000000c9'::uuid,
     p_type_evenement_ids => ARRAY['bb000000-0000-0000-0000-0000000000d1'::uuid,
                                   'bb000000-0000-0000-0000-0000000000d2'::uuid])
    WHERE flux_code = 'biodechet'),
  round(0.375, 6),
  'BENCH-PDF-1 : 2 segments (0,30 n=5 / 0,40 n=15) ⇒ point parc PDF = 0,375 (pondérée)'
);

-- 2. Non-vacuité du cas : les DEUX segments ont bien été agrégés (5 + 15 = 20).
--    Sans cette assertion, un 0,375 obtenu sur un seul segment passerait pour un succès.
SELECT is(
  (SELECT nb_collectes_segment FROM plateforme.f_rapport_benchmark_zd(
     p_collecte_id        => 'bb000000-0000-0000-0000-0000000000c9'::uuid,
     p_type_evenement_ids => ARRAY['bb000000-0000-0000-0000-0000000000d1'::uuid,
                                   'bb000000-0000-0000-0000-0000000000d2'::uuid])
    WHERE flux_code = 'biodechet'),
  20,
  'BENCH-PDF-2 : les 2 segments sont bien agrégés (nb_collectes_segment = 5 + 15)'
);

-- 3. Refus explicite de la moyenne SIMPLE (0,350) — comportement PDF avant 2026-09-22.
SELECT isnt(
  (SELECT round(benchmark_kg_pax, 6) FROM plateforme.f_rapport_benchmark_zd(
     p_collecte_id        => 'bb000000-0000-0000-0000-0000000000c9'::uuid,
     p_type_evenement_ids => ARRAY['bb000000-0000-0000-0000-0000000000d1'::uuid,
                                   'bb000000-0000-0000-0000-0000000000d2'::uuid])
    WHERE flux_code = 'biodechet'),
  round(0.350, 6),
  'BENCH-PDF-3 : jamais 0,350 — la moyenne simple des segments est écartée'
);

-- 4. Chemin nominal (1 seul segment) inchangé par la migration : 150/500 = 0,30.
SELECT is(
  (SELECT round(benchmark_kg_pax, 6) FROM plateforme.f_rapport_benchmark_zd(
     p_collecte_id        => 'bb000000-0000-0000-0000-0000000000c9'::uuid,
     p_type_evenement_ids => ARRAY['bb000000-0000-0000-0000-0000000000d1'::uuid])
    WHERE flux_code = 'biodechet'),
  round(0.30, 6),
  'BENCH-PDF-4 : segment unique ⇒ 0,30 (pondération sans effet sur le cas nominal)'
);

-- 5. k-anonymat : le segment C (3 collectes, 0,99 kg/pax) reste masqué — il ne
--    déplace donc pas le point parc et n'entre pas au dénominateur.
SELECT is(
  (SELECT nb_collectes_segment FROM plateforme.f_rapport_benchmark_zd(
     p_collecte_id        => 'bb000000-0000-0000-0000-0000000000c9'::uuid,
     p_type_evenement_ids => ARRAY['bb000000-0000-0000-0000-0000000000d1'::uuid,
                                   'bb000000-0000-0000-0000-0000000000d3'::uuid])
    WHERE flux_code = 'biodechet'),
  5,
  'BENCH-PDF-5 : k-anonymat — le segment de 3 collectes n''est ni compté ni pondéré'
);

-- 6. Aucun segment au-dessus du seuil ⇒ point parc NULL + compteur 0 (« Données
--    insuffisantes »), équivalent du `den > 0` de la règle écran.
SELECT ok(
  (SELECT benchmark_kg_pax IS NULL AND nb_collectes_segment = 0
     FROM plateforme.f_rapport_benchmark_zd(
       p_collecte_id        => 'bb000000-0000-0000-0000-0000000000c9'::uuid,
       p_type_evenement_ids => ARRAY['bb000000-0000-0000-0000-0000000000d3'::uuid])
    WHERE flux_code = 'biodechet'),
  'BENCH-PDF-6 : aucun segment ≥ 5 ⇒ benchmark NULL et compteur 0 (données insuffisantes)'
);

-- 7. Parité écran/PDF : la règle de l'écran (`aggregateBenchmarkPerFlux` =
--    Σ(kg × n) / Σn appliquée aux lignes de f_benchmark_kg_pax_zd) donne la MÊME
--    valeur que le PDF sur le même segment. C'est l'égalité qu'exige le §06.04.
SELECT is(
  (SELECT round(SUM(pb.kg_par_pax_moyen * pb.nb_collectes_segment)
                / NULLIF(SUM(pb.nb_collectes_segment), 0), 6)
     FROM plateforme.f_benchmark_kg_pax_zd(
            p_flux_id                => (SELECT id FROM plateforme.flux_dechets WHERE code = 'biodechet'),
            p_type_evenement_ids     => ARRAY['bb000000-0000-0000-0000-0000000000d1'::uuid,
                                              'bb000000-0000-0000-0000-0000000000d2'::uuid],
            p_taille_evenement_codes => ARRAY['XS']) pb),
  (SELECT round(benchmark_kg_pax, 6) FROM plateforme.f_rapport_benchmark_zd(
     p_collecte_id        => 'bb000000-0000-0000-0000-0000000000c9'::uuid,
     p_type_evenement_ids => ARRAY['bb000000-0000-0000-0000-0000000000d1'::uuid,
                                   'bb000000-0000-0000-0000-0000000000d2'::uuid])
    WHERE flux_code = 'biodechet'),
  'BENCH-PDF-7 : règle écran et chemin PDF rendent la même valeur (§06.04 « même graphe »)'
);

-- 8. Non-régression du reste du tuple : la valeur propre de la collecte cible
--    (25 kg / 100 pax) est inchangée par la refonte de l'agrégation parc.
SELECT is(
  (SELECT round(collecte_kg_pax, 6) FROM plateforme.f_rapport_benchmark_zd(
     p_collecte_id        => 'bb000000-0000-0000-0000-0000000000c9'::uuid,
     p_type_evenement_ids => ARRAY['bb000000-0000-0000-0000-0000000000d1'::uuid,
                                   'bb000000-0000-0000-0000-0000000000d2'::uuid])
    WHERE flux_code = 'biodechet'),
  round(0.25, 6),
  'BENCH-PDF-8 : collecte_kg_pax (25/100) inchangé — seule l''agrégation parc bouge'
);

SELECT * FROM finish();
ROLLBACK;
