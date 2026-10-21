// Plafond métier du nombre de convives d'une collecte (décision Val 2026-10-21).
// La même borne est posée en base : contrainte `collectes_pax_bornes`, gardes de
// `fn_creer_collecte` et `fn_modifier_collecte`. Sans dépendance serveur : le
// formulaire (client) et les routes (serveur) la partagent.
export const PAX_COLLECTE_MAX = 100_000;
