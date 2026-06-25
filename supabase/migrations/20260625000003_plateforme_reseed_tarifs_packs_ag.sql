-- R8 / BL-P1-FACT-04 — Re-seed tarifs_packs_ag aux valeurs canoniques CDC
-- ============================================================================
-- Le seed bloc8 (20260611171642) a inséré des valeurs placeholder FAUSSES
-- (nb_collectes 5/10/20/50 ; prix_ht 700/1300/2400/5500), puis l'align M2.1b
-- (20260615200000) a dérivé `credits` / `prix_unitaire_ht` / `montant_total_ht`
-- ET `type_pack` à partir de ces valeurs fausses → les 4 lignes de référence
-- AG sont incorrectes sur le nombre de collectes ET sur les prix.
--
-- Valeurs cibles (source de vérité) :
--   05 - Règles métier §3 « Packs Anti-Gaspi » (grille tarifaire de référence V1)
--   04 - Data Model, table `tarifs_packs_ag` (« Valeurs V1 de référence »)
--
--   type_pack | credits | prix_unitaire_ht | montant_total_ht | mensualisable | nb_mensualites
--   ----------|---------|------------------|------------------|---------------|----------------
--   unitaire  |       1 |           590.00 |           590.00 | false         | null
--   pack_10   |      10 |           500.00 |          5000.00 | false         | null
--   pack_30   |      30 |           460.00 |         13800.00 | true          | 3
--   pack_60   |      60 |           390.00 |         23400.00 | true          | 6
--
-- Idempotent : UPDATE par `type_pack` sur la ligne active (valide_jusqu_au IS NULL).
-- Les 4 type_pack existent depuis la dérivation de l'align M2.1b (toute base ayant
-- exécuté la chaîne de migrations les possède). FK-safe vs packs_antgaspi.tarif_pack_id
-- (UPDATE de valeurs, pas de DELETE). Les colonnes legacy V1 encore présentes et NOT NULL
-- (`nb_collectes`, `prix_ht`) sont maintenues cohérentes (nb_collectes=credits,
-- prix_ht=prix_unitaire_ht — c'est exactement le mapping d'origine de l'align M2.1b).
-- ============================================================================

UPDATE plateforme.tarifs_packs_ag AS t
SET
  credits          = v.credits,
  prix_unitaire_ht = v.prix_unitaire_ht,
  montant_total_ht = v.montant_total_ht,
  mensualisable    = v.mensualisable,
  nb_mensualites   = v.nb_mensualites,
  -- colonnes legacy V1 (NOT NULL) maintenues cohérentes
  nb_collectes     = v.credits,
  prix_ht          = v.prix_unitaire_ht
FROM (
  VALUES
    ('unitaire'::text, 1,  590.00::numeric, 590.00::numeric,   false, NULL::integer),
    ('pack_10',        10, 500.00,          5000.00,           false, NULL),
    ('pack_30',        30, 460.00,          13800.00,          true,  3),
    ('pack_60',        60, 390.00,          23400.00,          true,  6)
) AS v(type_pack, credits, prix_unitaire_ht, montant_total_ht, mensualisable, nb_mensualites)
WHERE t.type_pack = v.type_pack
  AND t.valide_jusqu_au IS NULL;
