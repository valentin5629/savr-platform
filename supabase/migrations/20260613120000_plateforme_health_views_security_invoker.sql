-- Activer security_invoker sur les vues ops qui lisent des tables avec RLS.
-- Par défaut, une vue s'exécute avec les droits de son propriétaire (DEFINER)
-- et bypass la RLS des tables sous-jacentes. security_invoker = true force
-- l'évaluation des policies RLS avec les droits de l'appelant.
-- Les GRANTs restent limités à service_role, ce qui est la première ligne de défense ;
-- security_invoker est la seconde (garde si un GRANT authenticated était ajouté par erreur).
ALTER VIEW plateforme.v_ops_outbox SET (security_invoker = true);
ALTER VIEW plateforme.v_ops_jobs_pdf SET (security_invoker = true);
ALTER VIEW plateforme.v_ops_factures_bloquees SET (security_invoker = true);
-- v_ops_integrations et v_ops_batchs sont des placeholders (constantes, pas de tables sous-jacentes)
-- security_invoker sans intérêt là, on ne les touche pas.
